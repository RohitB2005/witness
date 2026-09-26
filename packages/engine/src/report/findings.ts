// Candidates → findings: group duplicates, assign severity and a tier, write deterministic repro steps.
//
// Tiers here are *provisional* until replay verification exists (verify/, P3), which replaces
// `provisionalTier` with verify/tier.ts (D17, D29):
// - full / full-no-skeptic / deterministic: bugs cap at Likely ("not yet replayed"); an Explorer flag
//   (judgement) is Needs review; improvements are Evidence-based.
// - ai-no-verify (ablation A1): the tier the grounding alone would give, with no replay and no skeptic —
//   what an unverified AI tester would claim.
import { newId } from "../ids";
import type {
  Candidate,
  Expectation,
  Finding,
  ImprovementTier,
  Journey,
  Pipeline,
  Step,
  Tier,
} from "../types";
import { fingerprint } from "./fingerprint";
import { compareSeverity, maxSeverity, severityFor } from "./severity";

export interface ProvisionalTier {
  tier: Tier | ImprovementTier;
  reason: string;
}

export function provisionalTier(
  c: Pick<Candidate, "kind" | "source">,
  opts: { pipeline?: Pipeline; expectation?: Expectation } = {},
): ProvisionalTier {
  if (c.kind === "improvement") {
    return {
      tier: "evidence_based",
      reason: "Measured directly on the page by a deterministic check.",
    };
  }
  const g = opts.expectation?.grounding;
  const grounded = !!g && g.kind !== "convention" && g.verified;
  const groundingWords = !g
    ? ""
    : g.kind === "convention"
      ? " Its expectation is grounded in convention, not on-screen text."
      : grounded
        ? ` Grounded in ${g.kind === "ui_text" ? "on-screen text" : "the requirements"}: "${g.quote}".`
        : "";
  if (opts.pipeline === "ai-no-verify") {
    const unverified = "Unverified pipeline (ablation A1): reported without replay or skeptic.";
    if (c.source.kind === "detector")
      return { tier: "confirmed", reason: `${unverified} Found by ${c.source.id}.` };
    if (c.source.kind === "check")
      return { tier: grounded ? "confirmed" : "likely", reason: `${unverified}${groundingWords}` };
    return { tier: "likely", reason: `${unverified} The Explorer's judgement.` };
  }
  if (c.source.kind === "detector") {
    return {
      tier: "likely",
      reason: `Found by ${c.source.id}, a check for something that is always wrong; not yet replayed (replay verification arrives in P3), so capped at Likely.`,
    };
  }
  if (c.source.kind === "check") {
    return {
      tier: "likely",
      reason: `A deterministic check failed.${groundingWords} Not yet replayed (replay verification arrives in P3), so capped at Likely.`,
    };
  }
  if (c.source.kind === "judgement") {
    return {
      tier: "needs_review",
      reason:
        "The Explorer (an LLM) flagged this; no check confirmed it and it hasn't been judged or replayed yet.",
    };
  }
  return { tier: "needs_review", reason: "Not yet verified." };
}

export interface BuildContext {
  /** Plain-language label for the logged-in account, e.g. "the test account". */
  accountLabel?: string;
  mobileViewport: { width: number; height: number };
  pipeline?: Pipeline;
  /** Journeys (with their steps and expectations), for severity, grounding and repro steps. */
  journeys?: Journey[];
}

interface Lookups {
  journeys: Map<string, Journey>;
  expectations: Map<string, Expectation>;
  steps: Map<string, Step>;
  coreRoutes: Set<string>;
}

function lookups(ctx: BuildContext): Lookups {
  const l: Lookups = {
    journeys: new Map(),
    expectations: new Map(),
    steps: new Map(),
    coreRoutes: new Set(),
  };
  for (const j of ctx.journeys ?? []) {
    l.journeys.set(j.id, j);
    for (const e of j.expectations) l.expectations.set(e.id, e);
    for (const s of j.steps ?? []) {
      l.steps.set(s.id, s);
      if (j.priority === "core" && s.kind === "happy") {
        try {
          l.coreRoutes.add(new URL(s.urlAfter).pathname);
        } catch {
          // ignore unparsable URLs
        }
      }
    }
  }
  return l;
}

export function buildFindings(candidates: Candidate[], ctx: BuildContext): Finding[] {
  const l = lookups(ctx);
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
      .map((c) =>
        severityFor({
          kind: c.kind,
          source: c.source,
          severityHint: c.severityHint,
          journeyPriority: c.journeyId ? l.journeys.get(c.journeyId)?.priority : undefined,
          checkImpact:
            c.source.kind === "check"
              ? l.expectations.get(c.source.expectationId)?.impact
              : undefined,
          onCoreJourneyPage: l.coreRoutes.has(c.route.split("?")[0] ?? c.route),
        }),
      )
      .reduce(maxSeverity);
    const { tier, reason } = provisionalTier(first, {
      pipeline: ctx.pipeline,
      expectation:
        first.source.kind === "check" ? l.expectations.get(first.source.expectationId) : undefined,
    });
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
      steps: reproSteps(first, ctx, l.steps),
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

/**
 * Numbered, human-readable steps generated from recorded facts — never from LLM text. For candidates from
 * a journey or an edge input, these are the recorded steps' own descriptions (Step.description).
 */
export function reproSteps(
  c: Candidate,
  ctx: BuildContext,
  recorded?: Map<string, Step>,
): string[] {
  const steps: string[] = [];
  if (c.session === "authenticated")
    steps.push(`Log in with ${ctx.accountLabel ?? "the test account"}.`);
  if (c.viewport === "mobile") {
    steps.push(
      `Set the browser window to ${ctx.mobileViewport.width} × ${ctx.mobileViewport.height} (phone size).`,
    );
  }
  const path = c.stepIds.map((id) => recorded?.get(id)).filter((s): s is Step => !!s);
  if (path.length) {
    steps.push(...path.map((s) => s.description));
    const req = c.signals.request;
    if (c.source.kind === "detector" && req && /HTTP|REQFAIL|PERF/.test(c.source.id)) {
      steps.push(
        `Watch the network request ${req.method} ${req.path} (browser dev tools → Network).`,
      );
    } else if (c.source.kind === "detector" && /PAGEERROR|CONSOLE/.test(c.source.id)) {
      steps.push("Open the browser console and look for the error.");
    }
    return steps;
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
