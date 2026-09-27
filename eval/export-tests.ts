// pnpm eval:tests <runs/run_… | run.json> [--out dir]
// E3 (docs/EVALUATION.md): every exported test whose finding matches a seeded bug must FAIL with only that
// bug's flag on and PASS with no flags on (the bench's /__bench control routes switch flags and reset data
// before each run). Tests for findings that aren't seeded bugs are listed but not judged.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { RunResultSchema, type RunResult } from "@witness/engine";
import { LabelsFileSchema, scoreFinding, type Labels } from "./score-lib";
import { loadTruth, REPO_ROOT } from "./truth";

interface Outcome {
  findingId: string;
  testFile: string;
  bugId?: string;
  failsWithBug?: boolean;
  passesWithoutBug?: boolean;
  note?: string;
}

async function bench(base: string, pathname: string, body?: unknown): Promise<void> {
  const res = await fetch(base + pathname, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Bench refused ${pathname}: ${res.status}`);
}

function runSpec(
  dir: string,
  file: string,
  env: Record<string, string>,
): Promise<{ code: number | null; out: string }> {
  const cli = path.join(
    REPO_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "playwright.cmd" : "playwright",
  );
  return new Promise((resolve) => {
    const child = spawn(cli, ["test", "-c", dir, file.replace(/\./g, "\\.")], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function main(): Promise<number> {
  const envFile = path.join(REPO_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { out: { type: "string" } },
  });
  const input = positionals[0];
  if (!input) {
    console.error("Usage: pnpm eval:tests <runs/run_… | run.json> [--out dir]");
    return 2;
  }
  const runFile = input.endsWith(".json") ? path.resolve(input) : path.resolve(input, "run.json");
  const result: RunResult = RunResultSchema.parse(JSON.parse(readFileSync(runFile, "utf8")));
  const testsDir = path.join(path.dirname(runFile), "tests");
  const { truth } = loadTruth();
  const labelsFile = path.join(REPO_ROOT, "eval", "labels.json");
  const labels: Labels = existsSync(labelsFile)
    ? LabelsFileSchema.parse(JSON.parse(readFileSync(labelsFile, "utf8")))
    : {};
  const base = result.scope;
  const env = {
    WITNESS_BASE_URL: base,
    WITNESS_TEST_USER: result.config.loggedInAs ?? "",
    WITNESS_TEST_PASSWORD: process.env.BENCH_TEST_PASSWORD ?? "",
    WITNESS_NO_CAFFEINATE: "1",
  };
  const outcomes: Outcome[] = [];
  for (const f of result.findings.filter((x) => x.testFile)) {
    const s = scoreFinding(f, truth, labels);
    // Test validity doesn't depend on scoring: a tentative match to a seeded bug still names its flag.
    const tentative = s.outcome === "unlabelled" && s.match?.kind === "bug" && s.match.tentative;
    const bugId = s.outcome === "tp" ? s.bugId : tentative ? s.match!.id : undefined;
    const flag = bugId ? truth.bugs.find((b) => b.id === bugId)?.flag : undefined;
    const o: Outcome = {
      findingId: f.id,
      testFile: f.testFile!,
      bugId,
      ...(tentative ? { note: "tentative match" } : {}),
    };
    if (!flag) {
      o.note =
        s.outcome === "tp" ? "a real problem, but not a seeded bug" : `not matched (${s.why})`;
      outcomes.push(o);
      console.log(`- ${f.testFile}: ${o.note}`);
      continue;
    }
    await bench(base, "/__bench/bugs", { set: [flag] });
    await bench(base, "/__bench/reset");
    const on = await runSpec(testsDir, f.testFile!, env);
    await bench(base, "/__bench/bugs", { set: [] });
    await bench(base, "/__bench/reset");
    const off = await runSpec(testsDir, f.testFile!, env);
    o.failsWithBug = on.code !== 0;
    o.passesWithoutBug = off.code === 0;
    if (!o.passesWithoutBug)
      o.note = off.out
        .split("\n")
        .filter((l) => /Error|expect/.test(l))
        .slice(0, 4)
        .join(" | ");
    outcomes.push(o);
    console.log(
      `- ${f.testFile} (${bugId}): flag on → ${o.failsWithBug ? "fails ✓" : "PASSES ✗"}, flag off → ${o.passesWithoutBug ? "passes ✓" : "FAILS ✗"}${o.note ? `  ${o.note}` : ""}`,
    );
  }
  // Leave the bench as the run found it: every flag on, seed data back.
  await bench(base, "/__bench/bugs", { set: truth.bugs.map((b) => b.flag) }).catch(() => undefined);
  await bench(base, "/__bench/reset").catch(() => undefined);

  const judged = outcomes.filter((o) => o.failsWithBug !== undefined);
  const valid = judged.filter((o) => o.failsWithBug && o.passesWithoutBug).length;
  const summary = {
    runId: result.runId,
    exported: outcomes.length,
    judged: judged.length,
    failOnBuggy: judged.filter((o) => o.failsWithBug).length,
    passOnClean: judged.filter((o) => o.passesWithoutBug).length,
    valid,
    outcomes,
  };
  console.log(
    `\n${valid}/${judged.length} exported tests behave (fail with their bug, pass without it); ${outcomes.length - judged.length} not matched to a seeded bug.`,
  );
  if (values.out) {
    await mkdir(path.resolve(values.out), { recursive: true });
    await writeFile(
      path.join(path.resolve(values.out), `export-tests-${result.runId}.json`),
      JSON.stringify(summary, null, 2) + "\n",
    );
  }
  return valid === judged.length ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
