// pnpm eval:score <run.json | runs/<id> | results-dir-with-runs.jsonl>... [--clean] [--labels file] [--out dir]
//   [--bugs bench/bugs-v2.yaml]   score against another ground-truth file (v2: the QA coverage pack)
// Matches each run's findings against bench/bugs.yaml and writes summary.json + summary.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { RunResultSchema, type RunResult } from "@witness/engine";
import { LabelsFileSchema, scoreRun, summarise, type Labels, type RunScore } from "./score-lib";
import { BUGS_YAML, loadTruth, REPO_ROOT } from "./truth";

interface RunRef {
  file: string;
  clean: boolean;
}

function resolveRuns(inputs: string[], clean: boolean): RunRef[] {
  const out: RunRef[] = [];
  for (const input of inputs) {
    const p = path.resolve(input);
    if (!existsSync(p)) throw new Error(`Not found: ${input}`);
    if (statSync(p).isFile()) {
      out.push({ file: p, clean });
    } else if (existsSync(path.join(p, "run.json"))) {
      out.push({ file: path.join(p, "run.json"), clean });
    } else if (existsSync(path.join(p, "runs.jsonl"))) {
      // One JSON object per line: { "runDir": "runs/run_…", "clean": false } (written by the P5 runner).
      for (const line of readFileSync(path.join(p, "runs.jsonl"), "utf8").split("\n")) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as { runDir: string; clean?: boolean };
        out.push({
          file: path.join(path.resolve(REPO_ROOT, entry.runDir), "run.json"),
          clean: entry.clean ?? clean,
        });
      }
    } else {
      throw new Error(`${input} has no run.json or runs.jsonl`);
    }
  }
  return out;
}

const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`;

function renderMarkdown(
  scores: RunScore[],
  summary: ReturnType<typeof summarise>,
  verbose: boolean,
): string {
  const L: string[] = ["# Witness evaluation summary", ""];
  L.push(
    `bugs.yaml sha256 \`${summary.bugsYamlHash.slice(0, 12)}…\` · bench commit \`${summary.benchCommit ?? "?"}\``,
    "",
  );
  L.push(
    "| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |",
  );
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of scores) {
    L.push(
      `| ${s.runId} | ${s.pipeline} | ${s.clean ? "clean" : "buggy"} | ${pct(s.recall.confirmed)} | ${pct(s.recall.confirmedLikely)} | ${pct(s.recall.all)} | ${pct(s.precision.bugs.confirmedLikely)} | ${s.cleanFalsePositives ?? "–"} | ${s.decoysFlagged.join(", ") || "none"} | ${s.unlabelled} | ${s.minutes.toFixed(1)} |`,
    );
  }
  L.push(
    "",
    "## Per seeded bug (buggy runs)",
    "",
    "| Bug | Found in runs | Best tier | Expected tier |",
    "| --- | --- | --- | --- |",
  );
  for (const b of summary.perBug) {
    L.push(
      `| ${b.id} | ${b.found.map((f) => (f ? "✓" : "·")).join(" ") || "–"} | ${b.bestTier ?? "not found"} | ${b.expectedTier} |`,
    );
  }
  // One line per fingerprint: a label covers every run, and derived A1/A3 rows repeat the same findings.
  const seen = new Set<string>();
  const once = (items: { s: RunScore; f: RunScore["findings"][number] }[]) =>
    items.filter(({ f }) => !seen.has(f.fingerprint) && !!seen.add(f.fingerprint));
  const tentative = once(
    scores.flatMap((s) =>
      s.findings.filter((f) => f.match?.tentative && !f.label).map((f) => ({ s, f })),
    ),
  );
  const unmatched = once(
    scores.flatMap((s) => s.findings.filter((f) => !f.match && !f.label).map((f) => ({ s, f }))),
  );
  L.push("", `## Needs a label (${tentative.length + unmatched.length})`, "");
  L.push(
    'Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.',
    "",
  );
  for (const { s, f } of [...tentative, ...unmatched]) {
    L.push(`- ${f.fingerprint} (${s.runId}) [${f.kind}/${f.tier}] ${f.title} — ${f.why}`);
  }
  if (verbose) {
    L.push("", "## Every finding", "");
    for (const s of scores) {
      for (const f of s.findings)
        L.push(
          `- ${s.runId} ${f.outcome.toUpperCase()} [${f.kind}/${f.tier}] ${f.title} — ${f.why}`,
        );
    }
  }
  L.push("");
  return L.join("\n");
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      clean: { type: "boolean", default: false },
      labels: { type: "string", default: path.join(REPO_ROOT, "eval", "labels.json") },
      out: { type: "string" },
      verbose: { type: "boolean", short: "v", default: false },
      bugs: { type: "string", default: BUGS_YAML },
    },
  });
  if (!positionals.length) {
    console.error(
      "Usage: pnpm eval:score <run.json | runs/<id> | results-dir>... [--clean] [--labels file] [--out dir] [--bugs file] [-v]",
    );
    process.exit(2);
  }
  const bugsFile = path.resolve(values.bugs!);
  const { truth, sha256 } = loadTruth(bugsFile);
  const labels: Labels = existsSync(values.labels!)
    ? LabelsFileSchema.parse(JSON.parse(readFileSync(values.labels!, "utf8")))
    : {};
  let benchCommit: string | undefined;
  try {
    benchCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch {
    benchCommit = undefined;
  }
  // Each `full` run that recorded stage tiers is also scored as A1 and A3 (derived ablation, D51).
  const scores = resolveRuns(positionals, values.clean!).flatMap(({ file, clean }) => {
    const result: RunResult = RunResultSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    const derived =
      result.config.pipeline === "full"
        ? (["aiNoVerify", "noSkeptic"] as const).map((stage) =>
            scoreRun(result, truth, labels, { clean, stage }),
          )
        : [];
    return [scoreRun(result, truth, labels, { clean }), ...derived];
  });
  const summary = summarise(scores, truth, { bugsYamlHash: sha256, benchCommit });
  const md = renderMarkdown(scores, summary, values.verbose!).replace(
    "bugs.yaml sha256",
    `${path.basename(bugsFile)} sha256`,
  );
  console.log(md);
  if (values.out) {
    const out = path.resolve(values.out);
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, "summary.json"),
      JSON.stringify({ ...summary, runs: scores }, null, 2),
    );
    await writeFile(path.join(out, "summary.md"), md);
    console.log(`Wrote ${path.relative(process.cwd(), out)}/summary.{json,md}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
