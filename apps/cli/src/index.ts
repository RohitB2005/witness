// witness scan <url> — CLI shell around @witness/engine (SPEC FR-15).
// Exit codes: 0 Ready · 1 Ready with caveats · 2 Not ready · 3 scan error.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
  renderMarkdown,
  resolveScanConfig,
  runScan,
  type Models,
  type RunResult,
  type ScanInput,
  type WitnessEvent,
} from "@witness/engine";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXIT = { ready: 0, caveats: 1, not_ready: 2, error: 3 } as const;

const USAGE = `Usage: witness scan <url> [options]

  --mode staging|production   production blocks every write request except the login (default: staging for
                              localhost / *.local / *.test, production otherwise)
  --budget quick|standard|deep  (default: standard)
  --user <email or username>  log in with this account…
  --password-env <VAR>        …using the password in this environment variable (never pass it as an argument)
  --hint <text>               what the app is for (≤ 200 chars)
  --out <dir>                 also copy the reports into this folder
  --format md,json            report formats (default: md,json; html arrives in P3)
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
      out: { type: "string" },
      format: { type: "string" },
      pipeline: { type: "string" },
      "llm-cache": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, url] = positionals;
  if (values.help || command !== "scan" || !url) {
    console.log(USAGE);
    return values.help ? 0 : EXIT.error;
  }

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

  let config;
  try {
    config = resolveScanConfig({
      url,
      mode: values.mode as ScanInput["mode"],
      budget: values.budget as ScanInput["budget"],
      credentials,
      hint: values.hint,
      pipeline: values.pipeline as ScanInput["pipeline"],
      llmCache: values["llm-cache"] as ScanInput["llmCache"],
    });
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : String(err));
    return EXIT.error;
  }
  const formats = new Set((values.format ?? "md,json").split(",").map((f) => f.trim()));
  if (formats.has("html")) console.warn("HTML export arrives in P3; writing md/json only.");

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

  const runDir = store.runDir(result.runId);
  const written: string[] = [];
  const md = renderMarkdown(result);
  if (formats.has("md"))
    written.push(await write(path.join(runDir, "report.md"), vault.redact(md)));
  if (formats.has("json")) {
    written.push(
      await write(path.join(runDir, "report.json"), vault.redact(JSON.stringify(result, null, 2))),
    );
  }
  if (values.out) {
    const outDir = path.resolve(values.out);
    await mkdir(outDir, { recursive: true });
    if (formats.has("md"))
      written.push(await write(path.join(outDir, "report.md"), vault.redact(md)));
    if (formats.has("json")) {
      written.push(
        await write(
          path.join(outDir, "report.json"),
          vault.redact(JSON.stringify(result, null, 2)),
        ),
      );
    }
  }
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
  const done = r.journeys.filter((j) => j.status === "completed").length;
  console.log(
    `${r.stats.pages} pages · ${r.journeys.length ? `${done}/${r.journeys.length} journeys completed · ` : ""}${bugs.length} bugs · ${imps.length} improvements · ${(r.stats.durationMs / 1000).toFixed(0)} s · ${r.stats.llmCalls} LLM calls, US$${r.stats.costUsd.toFixed(3)}`,
  );
  if (r.aiStagesSkipped) console.log(`Note: ${r.aiStagesSkipped}`);
  for (const f of bugs) console.log(`  [${f.severity}/${f.tier}] ${f.title}`);
  for (const w of written) console.log(`Report: ${path.relative(process.cwd(), w)}`);
}

async function write(file: string, content: string): Promise<string> {
  await writeFile(file, content);
  return file;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(EXIT.error);
  },
);
