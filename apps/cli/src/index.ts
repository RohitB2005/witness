// witness scan <url> — CLI shell around @witness/engine (SPEC FR-15).
// witness suppress <fingerprint> --origin <url> --reason <text> — "Not a bug" (FR-12).
// Exit codes: 0 Ready · 1 Ready with caveats · 2 Not ready · 3 scan error.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  BUDGETS,
  ConfigError,
  JsonRunStore,
  LlmConfigError,
  SecretVault,
  createModels,
  llmSettingsFromEnv,
  resolveScanConfig,
  runScan,
  writeRunExports,
  type ExportFormat,
  type Models,
  type RunResult,
  type ScanInput,
  type WitnessEvent,
} from "@witness/engine";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXIT = { ready: 0, caveats: 1, not_ready: 2, error: 3 } as const;

const USAGE = `Usage: witness scan <url> [options]
       witness suppress <fingerprint> --origin <url> --reason <text>
       witness export <run id or folder> [--format md,json,html]   rewrite a finished run's reports and tests

  --mode staging|production   production blocks every write request except the login (default: staging for
                              localhost / *.local / *.test, production otherwise)
  --budget quick|standard|deep  (default: standard)
  --user <email or username>  log in with this account…
  --password-env <VAR>        …using the password in this environment variable (never pass it as an argument)
  --hint <text>               what the app is for (≤ 200 chars)
  --requirements <file>       a .md or .txt file with what the app must do (≤ 5,000 characters): each
                              acceptance criterion is checked and reported under Requirements coverage
  --out <dir>                 also copy the reports into this folder
  --format md,json,html       report formats (default: md,json,html); regression tests always go to tests/
  --pipeline deterministic|ai-no-verify|full|full-no-skeptic   (default: full)
  --llm-cache off|rw|replay   (default: rw)

Exit codes: 0 ready, 1 ready with caveats, 2 not ready, 3 scan error.`;

async function main(argv: string[]): Promise<number> {
  const envFile = path.join(REPO_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      mode: { type: "string" },
      budget: { type: "string" },
      user: { type: "string" },
      "password-env": { type: "string" },
      hint: { type: "string" },
      requirements: { type: "string" },
      out: { type: "string" },
      format: { type: "string" },
      pipeline: { type: "string" },
      "llm-cache": { type: "string" },
      origin: { type: "string" },
      reason: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, url] = positionals;
  if (command === "suppress" && url && !values.help)
    return suppress(url, values.origin, values.reason);
  if (command === "export" && url && !values.help) return reexport(url, values.format);
  if (values.help || command !== "scan" || !url) {
    console.log(USAGE);
    return values.help ? 0 : EXIT.error;
  }
  keepAwake();

  const vault = new SecretVault();
  let credentials: ScanInput["credentials"];
  if (values.user) {
    const envName = values["password-env"];
    const password = envName ? process.env[envName] : undefined;
    if (!envName || !password) {
      console.error(
        `--user needs --password-env <VAR> naming an environment variable that holds the password${envName ? ` (${envName} is empty or unset)` : ""}.`,
      );
      return EXIT.error;
    }
    vault.set("password", password);
    credentials = { username: values.user, passwordRef: "password" };
  }

  let requirements: string | undefined;
  if (values.requirements) {
    const file = path.resolve(values.requirements);
    if (!/\.(md|markdown|txt)$/i.test(file) || !existsSync(file)) {
      console.error(
        `--requirements needs an existing .md or .txt file (got ${values.requirements}).`,
      );
      return EXIT.error;
    }
    requirements = readFileSync(file, "utf8");
  }

  let config;
  try {
    config = resolveScanConfig({
      url,
      mode: values.mode as ScanInput["mode"],
      budget: values.budget as ScanInput["budget"],
      credentials,
      hint: values.hint,
      requirements,
      pipeline: values.pipeline as ScanInput["pipeline"],
      llmCache: values["llm-cache"] as ScanInput["llmCache"],
    });
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : String(err));
    return EXIT.error;
  }
  const formats = new Set(
    (values.format ?? "md,json,html").split(",").map((f) => f.trim() as ExportFormat),
  );

  const runsDir = path.resolve(REPO_ROOT, process.env.WITNESS_RUNS_DIR ?? "runs");
  const store = new JsonRunStore({
    runsDir,
    dataDir: path.join(REPO_ROOT, "data"),
    redact: (t) => vault.redact(t),
  });

  console.log(`Witness — scanning ${config.url} (${config.mode} mode, ${config.budget} budget)`);
  if (config.mode === "production")
    console.log("Production mode: write requests are blocked except the login.");
  // LLM models for the AI stages (the deterministic pipeline doesn't need any).
  let models: Models | undefined;
  let modelsUnavailable: string | undefined;
  let maxCostUsd: number | undefined;
  if (config.pipeline !== "deterministic") {
    try {
      const settings = llmSettingsFromEnv(process.env, path.join(REPO_ROOT, ".witness-cache"));
      models = createModels(settings);
      maxCostUsd = settings.maxCostUsd;
      console.log(
        `AI: planner/edge ${settings.smartModel}, explorer ${settings.fastModel}; cache ${config.llmCache}; spend cap US$${Math.min(BUDGETS[config.budget].llmUsd, maxCostUsd ?? Infinity).toFixed(2)}`,
      );
    } catch (err) {
      modelsUnavailable = err instanceof LlmConfigError ? err.message : String(err);
    }
  }
  const result = await runScan(config, {
    store,
    vault,
    sink: printer(),
    models,
    modelsUnavailable,
    maxCostUsd,
    llmCacheDir: path.join(REPO_ROOT, ".witness-cache"),
  });

  const exported = await writeRunExports(store, result, {
    formats,
    redact: (t) => vault.redact(t),
    outDir: values.out,
  });
  const written = exported.written.filter((f) => !f.includes(`${path.sep}tests${path.sep}`));
  if (exported.tests)
    written.push(
      `${path.join(store.runDir(result.runId), "tests")} (${exported.tests} regression tests)`,
    );
  printSummary(result, written);
  if (result.error) return EXIT.error;
  return EXIT[result.verdict.level];
}

function printer(): (e: WitnessEvent) => void {
  return (e) => {
    switch (e.t) {
      case "phase":
        if (e.phase !== "done") console.log(`\n== ${e.phase} ==`);
        break;
      case "page":
        console.log(
          `  page  ${e.state.routePattern}  ${e.state.title ? `"${e.state.title}"` : ""}`,
        );
        break;
      case "plan":
        for (const j of e.journeys) {
          console.log(`  plan  [${j.priority}] ${j.title} (${j.expectations.length} expectations)`);
        }
        break;
      case "journey":
        if (e.status !== "running") console.log(`  journey ${e.journeyId}: ${e.status}`);
        break;
      case "step":
        console.log(
          `    ${e.step.ok ? "·" : "✗"} ${e.step.kind === "edge" ? "[edge] " : ""}${e.step.description}`,
        );
        break;
      case "candidate":
        console.log(`    ! candidate: ${e.candidate.summary}`);
        break;
      case "detector":
        console.log(`    ! ${e.detectorId}: ${e.summary}`);
        break;
      case "log":
        if (e.level !== "info" || /^Logged in/.test(e.message))
          console.log(`  [${e.level}] ${e.message}`);
        break;
      case "error":
        console.error(`  [error] ${e.message}`);
        break;
    }
  };
}

function printSummary(r: RunResult, written: string[]): void {
  const bugs = r.findings.filter((f) => f.kind === "bug" && f.tier !== "discarded");
  const imps = r.findings.filter((f) => f.kind === "improvement");
  const label = { ready: "READY", caveats: "READY WITH CAVEATS", not_ready: "NOT READY" }[
    r.verdict.level
  ];
  console.log(`\n${label} — ${r.verdict.reason}`);
  const user = r.journeys.filter((j) => !j.automatic);
  const done = user.filter((j) => j.status === "completed").length;
  const auto = r.journeys.length - user.length;
  console.log(
    `${r.stats.pages} pages · ${user.length ? `${done}/${user.length} journeys completed · ` : ""}${auto ? `${auto} automatic checks · ` : ""}${bugs.length} bugs · ${imps.length} improvements · ${(r.stats.durationMs / 1000).toFixed(0)} s · ${r.stats.llmCalls} LLM calls, US$${r.stats.costUsd.toFixed(3)}`,
  );
  if (r.aiStagesSkipped) console.log(`Note: ${r.aiStagesSkipped}`);
  for (const n of r.notes ?? []) console.log(`Note: ${n}`);
  for (const f of bugs) console.log(`  [${f.severity}/${f.tier}] ${f.title}`);
  for (const w of written) console.log(`Report: ${path.relative(process.cwd(), w)}`);
}

/** Rewrites a finished run's exports (reports and regression tests) from its run.json. No scan, no LLM. */
async function reexport(run: string, format?: string): Promise<number> {
  const runsDir = path.resolve(REPO_ROOT, process.env.WITNESS_RUNS_DIR ?? "runs");
  const store = new JsonRunStore({ runsDir, dataDir: path.join(REPO_ROOT, "data") });
  const runId = path.basename(path.resolve(run));
  const result = await store.getResult(runId);
  if (!result) {
    console.error(`No finished run ${runId} in ${runsDir}.`);
    return EXIT.error;
  }
  const formats = new Set(
    (format ?? "md,json,html").split(",").map((f) => f.trim() as ExportFormat),
  );
  const out = await writeRunExports(store, result, { formats, redact: (t) => t });
  console.log(`Rewrote ${out.written.length} files for ${runId} (${out.tests} regression tests).`);
  for (const s of out.testsSkipped) console.log(`  no test for ${s.findingId}: ${s.reason}`);
  return 0;
}

/** FR-12: record "Not a bug" for a finding's fingerprint on an origin; later runs discard it. */
async function suppress(fingerprint: string, origin?: string, reason?: string): Promise<number> {
  if (!/^fp_[0-9a-f]{16}$/.test(fingerprint) || !origin || !reason?.trim()) {
    console.error("Usage: witness suppress <fp_…> --origin <url> --reason <text>");
    return EXIT.error;
  }
  const store = new JsonRunStore({
    runsDir: path.resolve(REPO_ROOT, process.env.WITNESS_RUNS_DIR ?? "runs"),
    dataDir: path.join(REPO_ROOT, "data"),
  });
  const o = new URL(origin).origin;
  await store.addSuppression({
    origin: o,
    fingerprint,
    reason: reason.trim().slice(0, 300),
    createdAt: new Date().toISOString(),
  });
  console.log(`Suppressed ${fingerprint} on ${o}. Later scans list it under Discarded.`);
  return 0;
}

/**
 * macOS: keep the Mac awake while this process runs (P2 lost a run to sleep; D46). `caffeinate -w` exits
 * with us. Elsewhere, or with WITNESS_NO_CAFFEINATE=1, it does nothing. Closing the lid on battery can
 * still sleep the Mac; that's outside what caffeinate can stop.
 */
function keepAwake(): void {
  if (process.platform !== "darwin" || process.env.WITNESS_NO_CAFFEINATE === "1") return;
  try {
    const child = spawn("caffeinate", ["-i", "-m", "-s", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // No caffeinate: the scan runs anyway.
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(EXIT.error);
  },
);
