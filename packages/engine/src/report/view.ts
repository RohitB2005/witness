// Plain-language labels and report structure shared by every renderer: the HTML and Markdown exports and
// the dashboard (which imports this file as `@witness/engine/view`). Browser-safe: type-only imports plus
// the pure tier rules, so the dashboard bundle never pulls in Playwright or the LLM SDK.
import type { Phase } from "../events";
import type { Criterion, Finding, RunResult, Severity } from "../types";

export { replayText } from "../verify/tier";

/** What the live view calls each phase. No jargon: some readers are non-technical. */
export const PHASE_LABEL: Record<Phase, string> = {
  preflight: "Checking the app is reachable",
  map: "Mapping the app",
  plan: "Planning what to test",
  explore: "Testing journeys",
  verify: "Double-checking findings",
  report: "Writing the report",
  done: "Finished",
};

/** The phases in order, for a stepper. */
export const PHASES: readonly Phase[] = [
  "preflight",
  "map",
  "plan",
  "explore",
  "verify",
  "report",
  "done",
];

export const VERDICT_LABEL: Record<RunResult["verdict"]["level"], string> = {
  ready: "Ready",
  caveats: "Ready with caveats",
  not_ready: "Not ready",
};

export const TIER_LABEL: Record<Finding["tier"], string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  needs_review: "Needs review",
  discarded: "Discarded",
  evidence_based: "Evidence-based",
  suggestion: "Suggestion",
};

/** One line on what each tier means, for people who haven't read the docs. */
export const TIER_HELP: Record<Finding["tier"], string> = {
  confirmed: "A deterministic check failed and the steps reproduced it.",
  likely: "Reproduced, but the expectation is a convention or an AI's judgement.",
  needs_review: "Something looked wrong, but it couldn't be verified. A person should check.",
  discarded: "Verification set this aside; the reason is shown.",
  evidence_based: "Measured directly on the page.",
  suggestion: "An AI reviewer's suggestion. Not a bug.",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Plain-language labels (never colour alone). */
export const CRITERION_LABEL: Record<Criterion["status"], string> = {
  verified: "Verified",
  failed: "Failed",
  not_found: "Not found in the app",
  not_tested: "Not tested",
};

/** The report's sections in order (Rohit, 28 Sep): verdict, requirements coverage, security, then the rest. */
export interface ReportView {
  bugs: Finding[];
  improvements: Finding[];
  discarded: Finding[];
  /** Security findings (bugs first, then hygiene improvements); they also appear under Bugs/Improvements. */
  security: Finding[];
  counts: { confirmed: number; likely: number; needsReview: number };
}

export function reportView(r: Pick<RunResult, "findings">): ReportView {
  const live = r.findings.filter((f) => f.tier !== "discarded");
  const bugs = live.filter((f) => f.kind === "bug");
  const improvements = live.filter((f) => f.kind === "improvement");
  const security = [
    ...bugs.filter((f) => f.category === "security"),
    ...improvements.filter((f) => f.category === "security"),
  ];
  const n = (t: Finding["tier"]) => bugs.filter((f) => f.tier === t).length;
  return {
    bugs,
    improvements,
    discarded: r.findings.filter((f) => f.tier === "discarded"),
    security,
    counts: { confirmed: n("confirmed"), likely: n("likely"), needsReview: n("needs_review") },
  };
}

/** "Sat 27 Sep 2026, 13:02" in the viewer's time zone: how a past run is labelled (never as live). */
export function runTimeLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = { timeZone };
  const date = d.toLocaleDateString("en-GB", {
    ...opts,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", { ...opts, hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** How the run used the AI, honestly: live calls, cached answers, or a replay of cached answers. */
export function aiUseLabel(r: Pick<RunResult, "config" | "stats">): string {
  const calls = r.stats.llmCalls;
  const hits = r.stats.llmCacheHits ?? 0;
  if (r.config.pipeline === "deterministic") return "No AI (deterministic checks only)";
  if (r.config.llmCache === "replay")
    return `AI answers replayed from the cache (${calls} calls, none sent to the AI)`;
  return `${calls} AI call${calls === 1 ? "" : "s"}${hits ? ` (${hits} answered from the cache)` : ""}, US$${r.stats.costUsd.toFixed(2)}`;
}

/** "Copy as issue": a finding as a Markdown issue body (FR-10). Plain text a person pastes into a tracker. */
export function issueMarkdown(
  f: Finding,
  r: Pick<RunResult, "runId" | "scope" | "startedAt">,
): string {
  const tick = (s: string) => s.replace(/`/g, "'");
  return [
    `## ${f.title}`,
    "",
    `**Severity:** ${SEVERITY_LABEL[f.severity]} · **Tier:** ${TIER_LABEL[f.tier]} · **Where:** \`${tick(f.route)}\` on ${r.scope}`,
    "",
    f.impact,
    "",
    "### Steps to reproduce",
    ...f.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "### Expected",
    f.expected,
    "",
    "### Actual",
    f.actual,
    "",
    `**Why Witness flagged it:** ${f.whyFlagged}`,
    `**Verification:** ${f.tierReason}`,
    ...(f.likelyCause ? [`**Likely cause (hypothesis):** ${f.likelyCause.text}`] : []),
    ...(f.testFile ? [`**Regression test:** \`tests/${tick(f.testFile)}\``] : []),
    "",
    `_Found by Witness, run ${r.runId} (${r.startedAt}). Finding ${f.id}, fingerprint ${f.fingerprint}._`,
  ].join("\n");
}
