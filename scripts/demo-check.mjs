// Pre-flight for the demo (docs/DEMO_RUNBOOK.md §1). P0 stub: checks what exists so far and says
// plainly which checks arrive in later phases. Exit code 1 if any required check fails.
import { existsSync, statfsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { REPO_ROOT, loadEnv } from "./env.mjs";

loadEnv();

const results = [];
const record = (status, name, detail) => results.push({ status, name, detail });

// Node version
const major = Number(process.versions.node.split(".")[0]);
record(major >= 22 ? "OK" : "FAIL", "Node.js 22+", `found ${process.versions.node}`);

// Dependencies installed
const installed = existsSync(path.join(REPO_ROOT, "node_modules"));
record(
  installed ? "OK" : "FAIL",
  "Dependencies installed",
  installed ? "node_modules present" : "run `pnpm install`",
);

// Playwright Chromium
try {
  const require = createRequire(path.join(REPO_ROOT, "bench", "app", "package.json"));
  const { chromium } = require("@playwright/test"); // require(): works with Windows paths, unlike import()
  const exe = chromium.executablePath();
  record(
    existsSync(exe) ? "OK" : "FAIL",
    "Playwright Chromium",
    existsSync(exe) ? exe : "run `pnpm --filter @witness/bench exec playwright install chromium`",
  );
} catch (error) {
  record("FAIL", "Playwright Chromium", `Playwright not resolvable: ${error.message}`);
}

// Free disk space
try {
  const fs = statfsSync(REPO_ROOT);
  const freeGb = (fs.bavail * fs.bsize) / 1024 ** 3;
  record(freeGb >= 1 ? "OK" : "FAIL", "Free disk space ≥ 1 GB", `${freeGb.toFixed(1)} GB free`);
} catch {
  record("WARN", "Free disk space", "couldn't read disk stats");
}

// Bench reachable
const benchUrl = `http://localhost:${process.env.BENCH_PORT ?? 5180}`;
try {
  const res = await fetch(`${benchUrl}/__bench/bugs`, { signal: AbortSignal.timeout(2000) });
  const { active } = await res.json();
  record(
    "OK",
    "Bench reachable",
    `${benchUrl} — bugs: ${active.length === 0 ? "none" : active.join(",")}`,
  );
} catch {
  record("WARN", "Bench reachable", `nothing on ${benchUrl} (start it with \`pnpm bench:serve\`)`);
}

// LLM key: required from P2
const provider = process.env.WITNESS_LLM_PROVIDER ?? "openrouter";
const keyVar = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
record(
  process.env[keyVar] ? "OK" : "WARN",
  `LLM API key (${keyVar})`,
  process.env[keyVar] ? "set" : "not set — needed from P2 (AI stages)",
);

// Checks that arrive with later phases
record("TODO", "LLM provider reachable", "added in P2 with the LLM gateway");
record("TODO", "Rehearsal LLM cache present", "added in P4 with demo:replay");

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results)
  console.log(`[${r.status.padEnd(4)}] ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(
  failed === 0
    ? "\nDemo check passed (warnings and TODOs listed above)."
    : `\nDemo check FAILED: ${failed} required check(s).`,
);
process.exit(failed === 0 ? 0 : 1);
