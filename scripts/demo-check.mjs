// Pre-flight for the demo (docs/DEMO_RUNBOOK.md §1, §4). Exit code 1 if any required check fails.
// Usage: pnpm demo:check [rehearsal run id]   (or set WITNESS_REHEARSAL_RUN)
import { existsSync, readFileSync, readdirSync, statfsSync } from "node:fs";
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
  process.env[keyVar] ? "set" : "not set — the AI stages need it (or use pnpm demo:replay)",
);

// LLM provider reachable, and the account balance (D48: say when it drops below $2)
if (provider === "openrouter" && process.env[keyVar]) {
  const auth = { Authorization: `Bearer ${process.env[keyVar]}` };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: auth,
      signal: AbortSignal.timeout(4000),
    });
    record(
      res.ok ? "OK" : "FAIL",
      "LLM provider reachable",
      res.ok ? "OpenRouter answered" : `OpenRouter said ${res.status}`,
    );
    const credits = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: auth,
      signal: AbortSignal.timeout(4000),
    })
      .then((r) => r.json())
      .catch(() => undefined);
    if (credits?.data) {
      const left = credits.data.total_credits - credits.data.total_usage;
      record(
        left >= 2 ? "OK" : "WARN",
        "AI credit balance",
        `$${left.toFixed(2)} left (used $${credits.data.total_usage.toFixed(2)})${left < 2 ? " — below $2: top up before the demo" : ""}`,
      );
    }
  } catch {
    record(
      "WARN",
      "LLM provider reachable",
      "no answer from OpenRouter (offline? use pnpm demo:replay)",
    );
  }
} else if (process.env[keyVar]) {
  record("WARN", "LLM provider reachable", `not checked for ${provider}`);
}

// Witness server and dashboard
const port = process.env.WITNESS_PORT ?? 4317;
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(2000),
  });
  const health = await res.json();
  record(
    "OK",
    "Witness server",
    `http://localhost:${port}${health.live ? ` — a scan is running now (${health.live.runId})` : ""}`,
  );
} catch {
  record("WARN", "Witness server", `nothing on :${port} (start it with \`pnpm demo:up\`)`);
}
const built = existsSync(path.join(REPO_ROOT, "apps", "web", "dist", "index.html"));
record(
  built ? "OK" : "WARN",
  "Dashboard built",
  built ? "apps/web/dist" : "pnpm demo:up builds it",
);

// "Not a bug" clicks from rehearsals would hide those findings in the real demo (they go to Discarded).
const suppressionsFile = path.join(REPO_ROOT, "data", "suppressions.json");
const benchOrigins = new Set([
  `http://localhost:${process.env.BENCH_PORT ?? 5180}`,
  `http://127.0.0.1:${process.env.BENCH_PORT ?? 5180}`,
]);
const suppressions = existsSync(suppressionsFile)
  ? JSON.parse(readFileSync(suppressionsFile, "utf8")).filter((x) => benchOrigins.has(x.origin))
  : [];
record(
  suppressions.length ? "WARN" : "OK",
  "No 'Not a bug' marks on the bench",
  suppressions.length
    ? `${suppressions.length} will be hidden in the demo — remove them from data/suppressions.json if they came from rehearsals:${suppressions
        .map(
          (x) =>
            `\n         ${x.fingerprint}  "${x.reason}"  (${x.createdAt.slice(0, 16).replace("T", " ")})`,
        )
        .join("")}`
    : "none",
);

// Rehearsal run's LLM cache (the offline fallback, pnpm demo:replay)
const rehearsal = process.argv[2] ?? process.env.WITNESS_REHEARSAL_RUN;
if (!rehearsal) {
  record("WARN", "Rehearsal LLM cache", "no run given: pnpm demo:check <rehearsal run id>");
} else {
  const calls = path.join(REPO_ROOT, "runs", rehearsal, "llm-calls.ndjson");
  if (!existsSync(calls))
    record("FAIL", "Rehearsal LLM cache", `no runs/${rehearsal}/llm-calls.ndjson`);
  else {
    const cacheDir = path.join(REPO_ROOT, ".witness-cache", "v2"); // keys from D86 on
    const entries = new Map();
    const has = (role, hash) => {
      if (!entries.has(role)) {
        const dir = path.join(cacheDir, role);
        entries.set(role, existsSync(dir) ? readdirSync(dir) : []);
      }
      return entries.get(role).some((f) => f.startsWith(hash));
    };
    const lines = readFileSync(calls, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const answered = lines.filter((c) => c.valid || c.cached);
    const cached = answered.filter((c) => has(c.role, c.promptHash)).length;
    record(
      cached === answered.length && answered.length > 0 ? "OK" : "WARN",
      "Rehearsal LLM cache",
      `${cached} of ${answered.length} AI answers from ${rehearsal} are in .witness-cache`,
    );
  }
}

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
