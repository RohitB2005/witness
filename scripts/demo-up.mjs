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
start("witness", "tsx", [path.join("apps", "server", "src", "index.ts")], {
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
  const bench = `http://localhost:${benchPort}`;
  // The live demo uses the demo preset: 2 journeys, 5-minute cap (Rohit, 30 Sep; DEVLOG D88).
  const q = new URLSearchParams({ url: bench, mode: "staging", budget: "demo" });
  if (process.env.BENCH_TEST_EMAIL) q.set("user", process.env.BENCH_TEST_EMAIL);
  console.log(`
Ready.
  Bench (all seeded bugs on):  ${bench}
  Witness dashboard:           http://localhost:${port}
  New scan, pre-filled:        http://localhost:${port}/?${q}
Ctrl+C stops both.`);
}
