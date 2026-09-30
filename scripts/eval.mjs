// pnpm eval --exp <E1|E2|E4|E5|E6|DEMO> [options] (EVALUATION.md §2): runs one experiment's scans through
// the CLI, one after another, and appends each finished run to <out>/runs.jsonl for `pnpm eval:score`.
//
// Bench experiments expect the production bench on BENCH_PORT (pnpm bench:build && pnpm bench:serve, or
// pnpm demo:up). Before each bench run the bench's data is reset and its bug flags are set, so every run
// starts from the same app. Paid runs: this script prints what it will run before starting.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT, loadEnv } from "./env.mjs";

loadEnv();
const USAGE = `Usage: pnpm eval --exp E1|E2|E4|E5|E6|DEMO [options]
  --runs <n>          runs of the experiment (defaults: E1 3, E2 2, others 1)
  --first-cache <m>   --llm-cache for the first run (default off); later runs always use off, so runs are
                      independent. E1 --first-cache rw makes that run the offline-replay rehearsal (D86)
  --pipeline <p>      deterministic|ai-no-verify|full|full-no-skeptic (default full; A0 = deterministic)
  --budget <b>        override the experiment's budget preset
  --url <url>         E6 only: the app to scan (production mode, not logged in)
  --out <dir>         results folder (default eval/results/<exp>-<date>); runs.jsonl is appended to
  --dry-run           print the plan and stop

  E1   bench, every flag on as in pnpm demo:up (the C01 injection canary included), Standard, test
       account, bench/SCOPE.md
  E2   bench, no seeded bugs (decoys stay), same settings
  E4   bench, every bug but WITHOUT the C01 canary, same settings (compare with E1; DEVLOG D90)
  DEMO bench, every bug on, the demo budget (2 journeys, 5 min), same settings
  E5   SauceDemo, staging, one run per account: problem_user and error_user
  E6   --url, production (read-only) mode, not logged in, Standard`;

const { values } = parseArgs({
  options: {
    exp: { type: "string" },
    runs: { type: "string" },
    "first-cache": { type: "string", default: "off" },
    pipeline: { type: "string", default: "full" },
    budget: { type: "string" },
    url: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
const exp = values.exp?.toUpperCase();
if (values.help || !exp || !["E1", "E2", "E4", "E5", "E6", "DEMO"].includes(exp)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const benchPort = process.env.BENCH_PORT ?? "5180";
const benchUrl = `http://localhost:${benchPort}`;
const scope = path.join("bench", "SCOPE.md");
const bench = (bugs, budget) => ({
  url: benchUrl,
  bench: bugs,
  clean: bugs === "none",
  mode: "staging",
  budget,
  user: process.env.BENCH_TEST_EMAIL,
  passwordEnv: "BENCH_TEST_PASSWORD",
  requirements: scope,
});

/** One entry per scan: what to run and how to label it in runs.jsonl. */
function plan() {
  const n = (d) => Number(values.runs ?? d);
  const budget = values.budget;
  const repeat = (count, make) => Array.from({ length: count }, (_, i) => make(i));
  switch (exp) {
    case "E1":
      return repeat(n(3), () => bench("all", budget ?? "standard"));
    case "E2":
      return repeat(n(2), () => bench("none", budget ?? "standard"));
    case "E4":
      return repeat(n(1), () => bench("all,-C01", budget ?? "standard"));
    case "DEMO":
      return repeat(n(1), () => bench("all", budget ?? "demo"));
    case "E5": {
      const url = process.env.SAUCEDEMO_URL ?? "https://www.saucedemo.com";
      return ["problem_user", "error_user"].map((user) => ({
        url,
        mode: "staging",
        budget: budget ?? "standard",
        user,
        passwordEnv: "SAUCEDEMO_PASSWORD", // staging: a public site built for test practice (EVALUATION.md E5)
      }));
    }
    case "E6":
      if (!values.url) {
        console.error("E6 needs --url <the app's address>.");
        process.exit(1);
      }
      return repeat(n(1), () => ({
        url: values.url,
        mode: "production",
        budget: budget ?? "standard",
      }));
  }
}

const runs = plan();
const date = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const out = path.resolve(
  REPO_ROOT,
  values.out ?? path.join("eval", "results", `${exp.toLowerCase()}-${date}`),
);

console.log(
  `Experiment ${exp}: ${runs.length} run${runs.length === 1 ? "" : "s"} → ${path.relative(REPO_ROOT, out)}/runs.jsonl`,
);
runs.forEach((r, i) =>
  console.log(
    `  ${i + 1}. ${r.url} · ${r.mode} · ${r.budget} · ${values.pipeline}${r.bench ? ` · bugs ${r.bench}` : ""}${r.user ? ` · as ${r.user}` : ""}${r.requirements ? " · SCOPE.md" : ""} · cache ${i === 0 ? values["first-cache"] : "off"}`,
  ),
);
if (values["dry-run"]) process.exit(0);
mkdirSync(out, { recursive: true });

async function setBench(bugs) {
  const base = `http://localhost:${benchPort}/__bench`;
  const post = (p, body) =>
    fetch(`${base}/${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  const reset = await post("reset").catch(() => undefined);
  if (!reset?.ok)
    throw new Error(`The bench isn't answering on ${benchUrl}. Start it with pnpm bench:serve.`);
  // "all" is the bench's own meaning (every flag, C01 included, as pnpm demo:up); "all,-C01" drops one.
  const [head, ...rest] = bugs.split(",");
  let set = [];
  if (head === "all") set = (await (await fetch(`${base}/bugs`)).json()).all;
  else if (head !== "none") set = [head];
  for (const id of rest)
    set = id.startsWith("-") ? set.filter((x) => x !== id.slice(1)) : [...set, id];
  const res = await post("bugs", { set });
  if (!res.ok) throw new Error(`The bench refused the bug flags: ${await res.text()}`);
  const { active } = await res.json();
  console.log(
    `Bench: data reset; ${active.length} flag${active.length === 1 ? "" : "s"} on${active.length ? ` (${active.join(", ")})` : ""}.`,
  );
}

function scan(r, cache) {
  const args = [
    path.join("apps", "cli", "src", "index.ts"),
    "scan",
    r.url,
    "--mode",
    r.mode,
    "--budget",
    r.budget,
  ];
  args.push("--pipeline", values.pipeline, "--llm-cache", cache);
  if (r.user) args.push("--user", r.user, "--password-env", r.passwordEnv);
  if (r.requirements) args.push("--requirements", r.requirements);
  const tsx = path.join(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  return new Promise((resolve) => {
    let runDir;
    const child = spawn(tsx, args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    child.stdout.on("data", (d) => {
      process.stdout.write(d);
      const m = /Report: (runs[\\/]run_[0-9]{8}-[0-9]{6}_[a-z0-9]{4})/.exec(String(d));
      if (m) runDir ??= m[1].replace(/\\/g, "/");
    });
    child.on("exit", (code) => resolve({ code, runDir }));
  });
}

let failed = 0;
for (const [i, r] of runs.entries()) {
  const cache = i === 0 ? values["first-cache"] : "off";
  console.log(`\n=== ${exp} run ${i + 1} of ${runs.length} ===`);
  if (r.bench) await setBench(r.bench);
  const started = Date.now();
  const { code, runDir } = await scan(r, cache);
  if (!runDir || !existsSync(path.join(REPO_ROOT, runDir, "run.json"))) {
    console.error(`Run ${i + 1} produced no run folder (exit ${code}); not recorded.`);
    failed++;
    continue;
  }
  const line = {
    runDir,
    clean: !!r.clean,
    exp,
    pipeline: values.pipeline,
    budget: r.budget,
    llmCache: cache,
    ...(r.bench ? { benchBugs: r.bench } : {}),
    ...(r.user ? { user: r.user } : {}),
    wallSeconds: Math.round((Date.now() - started) / 1000),
  };
  appendFileSync(path.join(out, "runs.jsonl"), JSON.stringify(line) + "\n");
  console.log(`Recorded ${runDir} (exit ${code}).`);
}
console.log(
  `\nDone: ${runs.length - failed} of ${runs.length} runs recorded in ${path.relative(REPO_ROOT, out)}/runs.jsonl.`,
);
process.exit(failed ? 1 : 0);
