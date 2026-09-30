// Candidates → findings: group duplicates, assign severity and a tier, write deterministic repro steps.
//
// Tiers come from verify/tier.ts. The verifier (verify/index.ts) decides each group's facts (evidence,
// replay, judge, skeptic, suppression) and passes them in as a GroupVerdict; a group without one is
// reported as not verified (Needs review for bugs), except in the unverified pipeline (A1), which reports
// what grounding alone would give (D29).
import { newId } from "../ids";
import type { Candidate, Expectation, Finding, Journey, Pipeline, Step } from "../types";
import { tierWithStages, type AnyTier, type TierInput } from "../verify/tier";
import { fingerprint } from "./fingerprint";
import { compareSeverity, maxSeverity, severityFor } from "./severity";

/** What verification decided about one group of candidates (one finding). */
export interface GroupVerdict {
  tier: AnyTier;
  tierReason: string;
  stageTiers?: Finding["stageTiers"];
  replay: Finding["replay"];
  skeptic?: Finding["skeptic"];
  judge?: Finding["judge"];
  suppressed?: Finding["suppressed"];
  /** Evidence recorded while verifying (replay check results and states). */
  extraEvidenceIds?: string[];
}

export interface BuildContext {
  /** Plain-language label for the logged-in account, e.g. "the test account". */
  accountLabel?: string;
  mobileViewport: { width: number; height: number };
  pipeline?: Pipeline;
  /** Journeys (with their steps and expectations), for severity, grounding and repro steps. */
  journeys?: Journey[];
  /** Verification results by group key (verify/index.ts). */
  verdicts?: Map<string, GroupVerdict>;
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

/** A more specific detector leads a group it shares (a DB error explains the 5xx it came with). */
function leads(c: Candidate): number {
  return c.source.kind === "detector" && c.source.id === "DET-DBERROR" ? 1 : 0;
}

/**
 * Candidates with the same group key are one problem. Each group is sorted so its first candidate (the
 * representative, which is replayed and reported) is the lexically first route: stable across crawl orders.
 * A more specific detector goes first whatever its route (`leads`).
 */
export function groupCandidates(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const g = groups.get(c.groupKey);
    if (g) g.push(c);
    else groups.set(c.groupKey, [c]);
  }
  return [...groups.values()].map((g) =>
    g.sort(
      (a, b) => leads(b) - leads(a) || a.route.localeCompare(b.route) || a.url.localeCompare(b.url),
    ),
  );
}

/** The facts about a representative candidate that the tier rules use (before verification adds its own). */
export function tierFacts(
  c: Candidate,
  group: readonly Candidate[] = [c],
): Pick<TierInput, "kind" | "source" | "grounding" | "review" | "afterBlocked"> {
  // The block explains the group only if every sighting came after one (D87).
  const afterBlocked = group.every((m) => m.afterBlocked) ? c.afterBlocked : undefined;
  return {
    kind: c.kind,
    source: c.source,
    ...(c.review ? { review: c.review } : {}),
    ...(afterBlocked ? { afterBlocked } : {}),
    grounding: c.grounding
      ? {
          kind: c.grounding.kind,
          verified: c.grounding.verified,
          selfReferential: c.grounding.selfReferential,
          aiGuessedRule: c.grounding.aiGuessedRule,
        }
      : c.source.kind === "detector"
        ? undefined
        : { kind: "convention", verified: false },
  };
}

/** Tier for a group nobody verified: A1 reports grounding alone; any other pipeline says "not verified". */
function unverifiedVerdict(
  c: Candidate,
  pipeline: Pipeline = "full",
  group: readonly Candidate[] = [c],
): GroupVerdict {
  const replay = { attempts: 0, reproduced: 0, skipped: "not verified" };
  const t = tierWithStages({ ...tierFacts(c, group), evidenceValid: true, replay }, pipeline);
  return {
    tier: t.tier,
    tierReason: t.reason,
    stageTiers: t.stageTiers,
    replay: { attempts: 0, reproduced: 0, notes: "Not replayed." },
  };
}

export function buildFindings(candidates: Candidate[], ctx: BuildContext): Finding[] {
  const l = lookups(ctx);
  const findings: Finding[] = [];
  for (const group of groupCandidates(candidates)) {
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
    const v = ctx.verdicts?.get(first.groupKey) ?? unverifiedVerdict(first, ctx.pipeline, group);
    const instances = dedupeBy(
      group.map((c) => ({ route: c.route, url: c.url, evidenceIds: c.evidenceIds })),
      (i) => i.url,
    );
    const sourceId = "id" in first.source ? first.source.id : first.source.kind;
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
      tier: v.tier,
      tierReason: v.tierReason,
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
      evidenceIds: [
        ...new Set([...group.flatMap((c) => c.evidenceIds), ...(v.extraEvidenceIds ?? [])]),
      ],
      instances,
      candidateIds: group.map((c) => c.id),
      replay: v.replay,
      ...(v.skeptic ? { skeptic: v.skeptic } : {}),
      ...(v.judge ? { judge: v.judge } : {}),
      ...(v.suppressed ? { suppressed: v.suppressed } : {}),
      ...(v.stageTiers ? { stageTiers: v.stageTiers } : {}),
      signals: first.signals,
      repro: {
        session: first.session,
        viewport: first.viewport,
        url: first.url,
        journeyId: first.journeyId,
        stepIds: first.stepIds,
        signature: first.signature,
        ...(first.check ? { check: first.check } : {}),
        ...(first.successCheck ? { successCheck: first.successCheck } : {}),
      },
      wording: "template",
    });
  }
  return findings.sort(compareFindings);
}

/** Report order: bugs before improvements, then by severity, then by title. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    (a.kind === b.kind ? 0 : a.kind === "bug" ? -1 : 1) ||
    compareSeverity(a.severity, b.severity) ||
    a.title.localeCompare(b.title)
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
  const src = c.source.kind === "detector" ? c.source.id : undefined;
  const req = c.signals.request;
  if (c.source.kind === "requirement") {
    steps.push(
      "Read the requirement quoted above, then look through the app for it: no page Witness visited mentions it.",
    );
    return steps;
  }
  if (src === "DET-AUTHZ") {
    steps.push(
      "Open a private browser window, so you're not logged in.",
      `Open ${c.url}`,
      "The data is shown instead of a login prompt or an error.",
    );
    return steps;
  }
  steps.push(`Open ${c.url}`);
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
    case "DET-SECRETS":
      if (req)
        steps.push(
          `Look at ${req.path}, which the page downloads (browser dev tools → Network → Response): it contains the key shown (redacted) above.`,
        );
      break;
    case "DET-DBERROR":
      if (req)
        steps.push(
          `Watch the response to ${req.method} ${req.path} (browser dev tools → Network → Response): it contains the database error.`,
        );
      else steps.push("Read the page: it shows the database error.");
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
