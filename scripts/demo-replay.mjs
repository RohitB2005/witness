// pnpm demo:replay <run id> (DEMO_RUNBOOK §1, §6): scans the same app again with the same settings, but
// every AI answer comes from the response cache (--llm-cache replay), so it works with no internet. The
// app itself is tested for real; only the AI's answers are replayed. Where the app behaves differently
// from the recorded run, the cache has no answer and Witness says the AI stages were skipped.
//
// With the Witness server running (pnpm demo:up), the replay starts there, so it shows in the dashboard,
// labelled "AI answers replayed from cache". Otherwise it runs in this terminal through the CLI.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadEnv } from "./env.mjs";
import { run } from "./procs.mjs";

loadEnv();
const runId = process.argv[2];
if (!runId || !/^run_[0-9]{8}-[0-9]{6}_[a-z0-9]{4}$/.test(runId)) {
  console.error(
    "Usage: pnpm demo:replay <run id>   (e.g. run_20260928-091400_ab12; see the History page)",
  );
  process.exit(1);
}
const file = path.join(REPO_ROOT, "runs", runId, "run.json");
if (!existsSync(file)) {
  console.error(`No finished run ${runId} in runs/.`);
  process.exit(1);
}
const { config } = JSON.parse(readFileSync(file, "utf8"));
const user = config.loggedInAs;
const password = process.env.WITNESS_TEST_PASSWORD ?? process.env.BENCH_TEST_PASSWORD;
if (user && !password) {
  console.error(
    `That run logged in as ${user}. Set BENCH_TEST_PASSWORD (or WITNESS_TEST_PASSWORD) in .env.`,
  );
  process.exit(1);
}

// The replay only matches the cache where the app looks as it did, so the bench starts from its seed data.
const benchPort = process.env.BENCH_PORT ?? "5180";
if (
  new URL(config.url).port === benchPort &&
  /^(localhost|127\.0\.0\.1)$/.test(new URL(config.url).hostname)
) {
  const reset = await fetch(`http://localhost:${benchPort}/__bench/reset`, {
    method: "POST",
  }).catch(() => undefined);
  console.log(
    reset?.ok
      ? "Bench data reset to the seed (as for the recorded run)."
      : "Couldn't reset the bench's data; the replay may miss the cache where the data differs.",
  );
}

const port = process.env.WITNESS_PORT ?? "4317";
const server = `http://127.0.0.1:${port}`;
let serverUp;
try {
  serverUp = (await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok;
} catch {
  serverUp = false;
}

console.log(
  `Replaying ${runId}: ${config.url} (${config.mode}, ${config.budget}) with AI answers from the cache.`,
);
if (serverUp) {
  const res = await fetch(`${server}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: config.url,
      mode: config.mode,
      budget: config.budget,
      ...(user ? { username: user, password } : {}),
      ...(config.hint ? { hint: config.hint } : {}),
      ...(config.requirements ? { requirements: config.requirements } : {}),
      confirmStagingOnNonLocal: true,
      llmCache: "replay",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`The Witness server refused: ${data.error}`);
    process.exit(1);
  }
  console.log(`Started in the dashboard: http://localhost:${port}/runs/${data.runId}/live`);
  process.exit(0);
}

const args = [
  path.join("apps", "cli", "src", "index.ts"),
  "scan",
  config.url,
  "--mode",
  config.mode,
  "--budget",
  config.budget,
  "--pipeline",
  config.pipeline,
  "--llm-cache",
  "replay",
];
if (user)
  args.push(
    "--user",
    user,
    "--password-env",
    process.env.WITNESS_TEST_PASSWORD ? "WITNESS_TEST_PASSWORD" : "BENCH_TEST_PASSWORD",
  );
if (config.hint) args.push("--hint", config.hint);
let reqFile;
if (config.requirements) {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  reqFile = path.join(mkdtempSync(path.join(tmpdir(), "witness-replay-")), "requirements.md");
  writeFileSync(reqFile, config.requirements);
  args.push("--requirements", reqFile);
}
process.exit(await run("tsx", args));
