// Markdown report (SPEC FR-10). Page-controlled text is escaped; severity and tier are written as words.
import type { Finding, RunResult } from "../types";
import { replayText } from "../verify/tier";

const VERDICT_LABEL = {
  ready: "READY",
  caveats: "READY WITH CAVEATS",
  not_ready: "NOT READY",
} as const;
const TIER_LABEL: Record<Finding["tier"], string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  needs_review: "Needs review",
  discarded: "Discarded",
  evidence_based: "Evidence-based",
  suggestion: "Suggestion",
};

/** Escapes text so page-controlled strings can't inject Markdown/HTML structure into the report. */
export function mdEscape(text: string): string {
  return text.replace(/[\\`*_{}[\]<>#|]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
}

export function renderMarkdown(r: RunResult): string {
  const bugs = r.findings.filter((f) => f.kind === "bug" && f.tier !== "discarded");
  const improvements = r.findings.filter((f) => f.kind === "improvement" && f.tier !== "discarded");
  const discarded = r.findings.filter((f) => f.tier === "discarded");
  const mins = (r.stats.durationMs / 60_000).toFixed(1);
  const lines: string[] = [
    `# Witness report — ${mdEscape(r.scope)}`,
    "",
    `**Verdict: ${VERDICT_LABEL[r.verdict.level]}.** ${mdEscape(r.verdict.reason)}`,
    "",
    `- Scope: ${mdEscape(r.scope)} (mode: ${r.config.mode}, budget: ${r.config.budget}, pipeline: ${r.config.pipeline})`,
    `- Run: ${r.runId}, ${r.startedAt} (${mins} min)`,
    `- Pages mapped: ${r.stats.pages}; candidates: ${r.stats.candidates}; bugs: ${bugs.length}; improvements: ${improvements.length}`,
    `- LLM calls: ${r.stats.llmCalls} (US$${r.stats.costUsd.toFixed(2)})`,
  ];
  if (r.config.loggedInAs) lines.push(`- Logged in as: ${mdEscape(r.config.loggedInAs)}`);
  if (r.stats.capsHit.length) lines.push(`- Budget caps hit: ${r.stats.capsHit.join(", ")}`);
  if (r.aiStagesSkipped) lines.push(`- AI stages skipped: ${mdEscape(r.aiStagesSkipped)}`);
  if (r.error) lines.push(`- **Scan error:** ${mdEscape(r.error)}`);
  if (r.notes?.length) {
    lines.push("", "## Notes", "");
    for (const n of r.notes) lines.push(`- ${mdEscape(n)}`);
  }
  lines.push("", "## What wasn't tested", "");
  for (const n of r.notTested.length ? r.notTested : ["Nothing noted."])
    lines.push(`- ${mdEscape(n)}`);
  if (r.appModel) {
    lines.push("", "## What Witness understood the app to be", "", mdEscape(r.appModel.purpose));
  }
  if (r.journeys.length) {
    lines.push("", `## Journeys and automatic checks (${r.journeys.length})`, "");
    const failedExp = new Set(
      r.findings.flatMap((f) => (f.source.kind === "check" ? [f.source.expectationId] : [])),
    );
    for (const j of r.journeys) {
      const happy = (j.steps ?? []).filter((s) => s.kind === "happy").length;
      const edge = (j.steps ?? []).filter((s) => s.kind === "edge").length;
      const failed = j.expectations.filter((e) => failedExp.has(e.id)).length;
      const status =
        j.status === "completed"
          ? "completed"
          : `${j.status}${j.incompleteReason ? ` (${j.incompleteReason})` : ""}`;
      lines.push(
        `- **${mdEscape(j.title)}** (${j.automatic ? "automatic" : j.priority}): ${mdEscape(status)}. ${happy} step${happy === 1 ? "" : "s"}${edge ? ` + ${edge} ${j.automatic ? "" : "edge-input "}steps` : ""}; ${j.expectations.length} expectation${j.expectations.length === 1 ? "" : "s"}, ${failed} failed.`,
      );
    }
  }

  lines.push("", `## Bugs (${bugs.length})`, "");
  if (!bugs.length) lines.push("None found.");
  bugs.forEach((f, i) => lines.push(...card(f, i + 1)));
  lines.push("", `## Improvements (${improvements.length})`, "");
  if (!improvements.length) lines.push("None found.");
  improvements.forEach((f, i) => lines.push(...card(f, i + 1)));
  if (discarded.length) {
    lines.push("", `## Discarded (${discarded.length})`, "");
    for (const f of discarded) lines.push(`- ${mdEscape(f.title)} — ${mdEscape(f.tierReason)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function card(f: Finding, n: number): string[] {
  const out = [
    `### ${n}. ${mdEscape(f.title)}`,
    "",
    `**Severity:** ${f.severity} · **Tier:** ${TIER_LABEL[f.tier]} · **Category:** ${f.category} · **Route:** \`${f.route.replace(/`/g, "")}\``,
    "",
    mdEscape(f.impact),
    "",
    `- **Why this tier:** ${mdEscape(f.tierReason)}`,
    `- **Why flagged:** ${mdEscape(f.whyFlagged)}`,
    `- **Expected:** ${mdEscape(f.expected)}`,
    `- **Actual:** ${mdEscape(f.actual)}`,
    `- **Replay:** ${mdEscape(replayText(f.replay))}${f.replay.notes ? ` (${mdEscape(f.replay.notes)})` : ""}`,
    ...(f.skeptic ? [`- **Skeptic:** ${f.skeptic.verdict}: ${mdEscape(f.skeptic.reason)}`] : []),
    ...(f.judge
      ? [`- **Judge:** ${f.judge.verdict} (${Math.round(f.judge.confidence * 100)}% confident)`]
      : []),
    ...(f.likelyCause ? [`- **Likely cause (hypothesis):** ${mdEscape(f.likelyCause.text)}`] : []),
    ...(f.testFile ? [`- **Regression test:** \`tests/${f.testFile}\``] : []),
    "",
    "Steps to reproduce:",
    "",
    ...f.steps.map((s, i) => `${i + 1}. ${mdEscape(s)}`),
    "",
    `Evidence: ${f.evidenceIds.join(", ")} · Fingerprint: ${f.fingerprint}`,
    "",
  ];
  return out;
}
