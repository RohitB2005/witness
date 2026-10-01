// pnpm demo:up (DEMO_RUNBOOK §1): builds and starts the bench with every seeded bug on (port 5180) and the
// Witness server with the built dashboard (port 4317), then prints both URLs. Ctrl+C stops both.
import path from "node:path";
import { REPO_ROOT, loadEnv } from "./env.mjs";
import { run, start, stopAll, waitFor } from "./procs.mjs";

loadEnv();
const benchPort = process.env.BENCH_PORT ?? "5180";
const port = process.env.WITNESS_PORT ?? "4317";

console.log("Building the dashboard and the bench…");
for (const [what, cwd] of [
  ["dashboard", path.join(REPO_ROOT, "apps", "web")],
  ["bench", path.join(REPO_ROOT, "bench", "app")],
]) {
  if ((await run("vite", ["build", "--logLevel", "warn"], { cwd })) !== 0) {
    console.error(`Building the ${what} failed.`);
    process.exit(1);
  }
}

start("bench", "tsx", [path.join("bench", "app", "scripts", "serve.ts"), "--port", benchPort], {
  env: { BENCH_BUGS: process.env.DEMO_BENCH_BUGS ?? "all" },
});
const bench = `http://localhost:${benchPort}`;
// --demo: the server offers the demo settings (bench URL, Staging, Demo budget, .env's test account,
// bench/SCOPE.md) to New scan; the password stays in the server (DEMO_RUNBOOK §4).
start("witness", "tsx", [path.join("apps", "server", "src", "index.ts"), "--demo", bench], {
  env: { WITNESS_PORT: port },
});

const [benchUp, witnessUp] = await Promise.all([
  waitFor(`http://localhost:${benchPort}/__bench/bugs`),
  waitFor(`http://127.0.0.1:${port}/api/health`),
]);
if (!benchUp || !witnessUp) {
  console.error(`Didn't start: ${!benchUp ? "bench " : ""}${!witnessUp ? "witness" : ""}`);
  stopAll(1);
} else {
  // The link fills New scan from GET /api/demo: demo preset (D88), test account, requirements.
  console.log(`
Ready.
  Bench (all seeded bugs on):  ${bench}
  Witness dashboard:           http://localhost:${port}
  New scan, demo settings:     http://localhost:${port}/?demo=1
Ctrl+C stops both.`);
}
