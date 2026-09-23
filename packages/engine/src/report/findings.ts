// Candidates → findings: group duplicates, assign severity and a tier, write deterministic repro steps.
//
// P1 note: replay verification (verify/, P3) doesn't exist yet, so tiers here are *provisional*:
// detector bugs cap at Likely ("not yet replayed"), detector improvements are Evidence-based.
// P3 replaces `provisionalTier` with verify/tier.ts.
import { newId } from "../ids";
import type { Candidate, Finding, ImprovementTier, Tier } from "../types";
import { fingerprint } from "./fingerprint";
import { compareSeverity, maxSeverity, severityFor } from "./severity";

export interface ProvisionalTier {
  tier: Tier | ImprovementTier;
  reason: string;
}

export function provisionalTier(c: Pick<Candidate, "kind" | "source">): ProvisionalTier {
  if (c.kind === "improvement") {
    return {
      tier: "evidence_based",
      reason: "Measured directly on the page by a deterministic check.",
    };
  }
  if (c.source.kind === "detector") {
    return {
      tier: "likely",
      reason: `Found by ${c.source.id}, a check for something that is always wrong; not yet replayed (replay verification arrives in P3), so capped at Likely.`,
    };
  }
  return { tier: "needs_review", reason: "Not yet verified." };
}

export interface BuildContext {
  /** Plain-language label for the logged-in account, e.g. "the test account". */
  accountLabel?: string;
  mobileViewport: { width: number; height: number };
}

export function buildFindings(candidates: Candidate[], ctx: BuildContext): Finding[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const g = groups.get(c.groupKey);
    if (g) g.push(c);
    else groups.set(c.groupKey, [c]);
  }
  const findings: Finding[] = [];
  for (const group of groups.values()) {
    // Deterministic order: the primary instance is the lexically first route (stable across crawl orders).
    group.sort((a, b) => a.route.localeCompare(b.route) || a.url.localeCompare(b.url));
    const first = group[0]!;
    const severity = group
      .map((c) => severityFor({ kind: c.kind, source: c.source, severityHint: c.severityHint }))
      .reduce(maxSeverity);
    const { tier, reason } = provisionalTier(first);
    const instances = dedupeBy(
      group.map((c) => ({ route: c.route, url: c.url, evidenceIds: c.evidenceIds })),
      (i) => i.url,
    );
    const sourceId =
      first.source.kind === "detector" || first.source.kind === "check"
        ? first.source.id
        : first.source.kind;
    const req = first.signals.request;
    findings.push({
      id: newId("fd"),
      fingerprint: fingerprint({
        category: first.category,
        route: first.route,
        sourceId,
        key: first.groupKey,
        request: req ? { method: req.method, path: req.path } : undefined,
      }),
      kind: first.kind,
      tier,
      tierReason: reason,
      severity,
      category: first.category,
      source: first.source,
      route: first.route,
      title: first.detail.title,
      impact: first.detail.impact,
      whyFlagged: first.detail.whyFlagged,
      steps: reproSteps(first, ctx),
      expected: first.detail.expected,
      actual:
        instances.length > 1
          ? `${first.detail.actual} Seen on ${instances.length} pages: ${instances
              .slice(0, 5)
              .map((i) => i.route)
              .join(", ")}${instances.length > 5 ? ", …" : ""}.`
          : first.detail.actual,
      evidenceIds: [...new Set(group.flatMap((c) => c.evidenceIds))],
      instances,
      candidateIds: group.map((c) => c.id),
      replay: { attempts: 0, reproduced: 0, notes: "Replay verification arrives in P3." },
      signals: first.signals,
    });
  }
  return findings.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "bug" ? -1 : 1) ||
      compareSeverity(a.severity, b.severity) ||
      a.title.localeCompare(b.title),
  );
}

/** Numbered, human-readable steps generated from recorded facts — never from LLM text. */
export function reproSteps(c: Candidate, ctx: BuildContext): string[] {
  const steps: string[] = [];
  if (c.session === "authenticated")
    steps.push(`Log in with ${ctx.accountLabel ?? "the test account"}.`);
  if (c.viewport === "mobile") {
    steps.push(
      `Set the browser window to ${ctx.mobileViewport.width} × ${ctx.mobileViewport.height} (phone size).`,
    );
  }
  steps.push(`Open ${c.url}`);
  const src = c.source.kind === "detector" ? c.source.id : undefined;
  const req = c.signals.request;
  switch (src) {
    case "DET-HTTP5XX":
    case "DET-REQFAIL":
    case "DET-PERF":
      if (req)
        steps.push(
          `Watch the network request ${req.method} ${req.path} (browser dev tools → Network).`,
        );
      break;
    case "DET-PAGEERROR":
    case "DET-CONSOLE":
      steps.push("Open the browser console and look for the error.");
      break;
    case "DET-BROKENLINK":
      if (req) steps.push(`Click the link to ${req.path}.`);
      break;
    case "DET-BROKENIMG":
      steps.push("Look for the image that doesn't display.");
      break;
    case "DET-A11Y":
      steps.push(
        `Run an accessibility checker (axe-core) on the page; see rule "${c.signals.axeRuleId}".`,
      );
      break;
    case "DET-OVERFLOW":
      steps.push("Scroll sideways: part of the page is off-screen.");
      break;
    case "DET-SECHEADERS":
      steps.push("Inspect the page's response headers and cookies (browser dev tools → Network).");
      break;
  }
  return steps;
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
