// Requirements coverage (ADDENDUM A5). The Planner splits the requirements into acceptance criteria and links
// its expectations to them; code decides every status from what the run recorded:
// - Not found: the Planner saw nothing in the app for a criterion, AND no page the run recorded (crawl,
//   journeys, probes) mentions the words it would use. A "Not found in the app" finding (Likely at most).
// - Failed: a check linked to the criterion failed and the finding is Confirmed or Likely.
// - Verified: at least one linked check was evaluated and none failed.
// - Not tested: anything else, with the reason (no journey for it, the journey didn't get there, a failure
//   that couldn't be verified, or the Planner missed words that do appear in the app).
import { newId } from "../ids";
import type { ValidCriterion } from "../plan/planner";
import type { EvidenceWriter } from "../record/evidence";
import type { Candidate, Criterion, Finding, Journey } from "../types";

export interface RecordedPage {
  url: string;
  route: string;
  text: string;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "our",
  "can",
  "with",
  "from",
  "this",
  "that",
]);

function words(term: string): string[] {
  return (term.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/**
 * True if the page text mentions the term: every word of the term (3+ letters, not a stopword) appears,
 * compared on its first 6 letters so "Reschedule" also finds "rescheduling". Case-insensitive. A term with
 * no such word ("Pay now" has "now"; "Go" has none) is matched as a whole.
 */
export function mentions(text: string, term: string): boolean {
  const hay = text.toLowerCase();
  const ws = words(term);
  if (!ws.length) {
    const whole = term.trim().toLowerCase();
    return whole.length > 0 && hay.includes(whole);
  }
  return ws.every((w) => hay.includes(w.slice(0, 6)));
}

export interface NotFoundResult {
  candidates: Candidate[];
  /** Criteria the Planner called missing whose words do appear somewhere: where. */
  mentioned: Map<string, { term: string; route: string }>;
}

export async function notFoundCandidates(i: {
  criteria: ValidCriterion[];
  pages: RecordedPage[];
  startUrl: string;
  session: Candidate["session"];
  evidence: EvidenceWriter;
}): Promise<NotFoundResult> {
  const out: NotFoundResult = { candidates: [], mentioned: new Map() };
  const routes = [...new Set(i.pages.map((p) => p.route))];
  for (const c of i.criteria) {
    if (!c.plannedNotFound || !c.lookFor.length) continue;
    let hit: { term: string; route: string } | undefined;
    for (const term of c.lookFor) {
      const page = i.pages.find((p) => mentions(p.text, term));
      if (page) {
        hit = { term, route: page.route };
        break;
      }
    }
    if (hit) {
      out.mentioned.set(c.id, hit);
      continue;
    }
    const evidenceId = await i.evidence.put("dom_probe", {
      kind: "requirement-search",
      criterion: c.id,
      quote: c.quote,
      lookFor: c.lookFor,
      pagesSearched: i.pages.length,
      routes,
      found: false,
    });
    const terms = c.lookFor.map((t) => `"${t}"`).join(", ");
    out.candidates.push({
      id: newId("cd"),
      kind: "bug",
      source: { kind: "requirement", id: "REQ-NOTFOUND", criterionId: c.id },
      category: "functional",
      route: new URL(i.startUrl).pathname || "/",
      url: i.startUrl,
      session: i.session,
      viewport: "desktop",
      stepIds: [],
      evidenceIds: [evidenceId],
      signature: { kind: "requirement", criterionId: c.id },
      groupKey: `requirement|${c.id}|${c.quote.toLowerCase()}`,
      severityHint: c.importance === "core" ? "high" : "medium",
      signals: {},
      grounding: { kind: "requirement", verified: true, quote: c.quote },
      detail: {
        title: `Not found in the app: ${c.text}`,
        impact:
          "The requirements promise this, but Witness couldn't find it anywhere in the app. If it's missing, the delivery doesn't match the agreed scope.",
        expected: `The app does what the requirements say: "${c.quote}"`,
        actual: `None of the ${i.pages.length} pages Witness recorded (${routes.length} routes) mentions ${terms}.`,
        whyFlagged:
          "The Planner (an LLM) found nothing in the app for this criterion; code then searched every recorded page for the words it would use and found none. An absence can't be replayed, so it is Likely at most.",
      },
      summary: `Not found in the app: ${c.id} ${c.text}`,
    });
  }
  return out;
}

const ACTIVE = new Set(["confirmed", "likely"]);

export function criteriaCoverage(i: {
  criteria: ValidCriterion[];
  journeys: Journey[];
  candidates: Candidate[];
  findings: Finding[];
  mentioned: Map<string, { term: string; route: string }>;
}): Criterion[] {
  const findingOf = new Map<string, Finding>();
  for (const f of i.findings) for (const id of f.candidateIds) findingOf.set(id, f);
  const failedBy = new Map<string, Finding[]>(); // expectation → findings of its failed check
  for (const c of i.candidates) {
    const f = findingOf.get(c.id);
    if (!f || c.source.kind !== "check") continue;
    const list = failedBy.get(c.source.expectationId) ?? [];
    if (!list.includes(f)) list.push(f);
    failedBy.set(c.source.expectationId, list);
  }
  const evaluated = new Set<string>();
  for (const j of i.journeys)
    for (const s of j.steps ?? [])
      if (s.action.type === "check" && s.action.expectationId && s.ok)
        evaluated.add(s.action.expectationId);
  const notFound = new Map<string, Finding>();
  for (const f of i.findings)
    if (f.source.kind === "requirement" && f.tier !== "discarded")
      notFound.set(f.source.criterionId, f);

  return i.criteria.map((c): Criterion => {
    const journeys = i.journeys.filter(
      (j) =>
        !j.automatic &&
        (j.criterionIds?.includes(c.id) || j.expectations.some((e) => e.criterionId === c.id)),
    );
    const expectations = journeys
      .flatMap((j) => j.expectations)
      .filter((e) => e.criterionId === c.id && e.check.type !== "capture");
    const base = {
      id: c.id,
      text: c.text,
      quote: c.quote,
      importance: c.importance,
      plannedNotFound: c.plannedNotFound,
      lookFor: c.lookFor,
      expectationIds: expectations.map((e) => e.id),
      journeyIds: journeys.map((j) => j.id),
    };

    const missing = notFound.get(c.id);
    if (missing)
      return {
        ...base,
        status: "not_found",
        reason: `No page Witness recorded mentions ${c.lookFor.map((t) => `"${t}"`).join(", ")}.`,
        findingIds: [missing.id],
      };

    const failures = expectations.flatMap((e) => failedBy.get(e.id) ?? []);
    const active = failures.filter((f) => f.kind === "bug" && ACTIVE.has(f.tier));
    if (active.length)
      return {
        ...base,
        status: "failed",
        reason: `A check for it failed: "${active[0]!.title}"${active.length > 1 ? ` (and ${active.length - 1} more)` : ""}.`,
        findingIds: [...new Set(active.map((f) => f.id))],
      };
    const unverified = failures.filter((f) => f.tier === "needs_review");
    if (unverified.length)
      return {
        ...base,
        status: "not_tested",
        reason: `A check for it failed but couldn't be verified (Needs review): "${unverified[0]!.title}".`,
        findingIds: [...new Set(unverified.map((f) => f.id))],
      };

    const passed = expectations.filter((e) => evaluated.has(e.id) && !failedBy.has(e.id));
    if (passed.length)
      return {
        ...base,
        status: "verified",
        reason: `${passed.length} of ${expectations.length} check${expectations.length === 1 ? "" : "s"} passed, e.g. "${passed[0]!.statement}".`,
        findingIds: [],
      };

    const seen = i.mentioned.get(c.id);
    const unfinished = journeys.find((j) => j.status !== "completed");
    const reason = seen
      ? `The Planner didn't see it in the app, but "${seen.term}" appears on ${seen.route}; no journey tested it.`
      : c.plannedNotFound && !c.lookFor.length
        ? "The Planner found nothing for it and gave no words to search for, so Witness can't tell."
        : !journeys.length
          ? "No journey was planned for it (the journey limit, or it couldn't be checked from the app map)."
          : !expectations.length
            ? `Journey "${journeys[0]!.title}" covers it, but with no check Witness could evaluate.`
            : unfinished
              ? `Journey "${unfinished.title}" didn't reach its check${unfinished.incompleteReason ? ` (${unfinished.incompleteReason.replace(/\.$/, "")})` : ""}.`
              : "Its checks weren't reached.";
    return { ...base, status: "not_tested", reason, findingIds: [] };
  });
}

export { CRITERION_LABEL } from "./view";
