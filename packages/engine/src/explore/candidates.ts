// Candidates from the AI stages: a failed check (source "check") or an Explorer flag (source "judgement").
// Wording is deterministic, built from the expectation and the evaluator's message (D22).
import { routePattern } from "../crawl/normalise";
import { newId } from "../ids";
import type { CheckResult } from "../oracle/evaluate";
import type { Check } from "../oracle/language";
import { containsLoose } from "../oracle/parse";
import type { Candidate, Expectation, FindingCategory, Grounding, PageState } from "../types";

const IMPACT_TEXT: Record<Expectation["impact"], string> = {
  money: "People could be charged, or shown, the wrong amount.",
  "data-loss": "Changes people make could be lost or applied to the wrong thing.",
  "blocks-completion": "People can't finish this task.",
  "wrong-info": "People are shown incorrect information.",
  cosmetic: "It looks wrong, though it doesn't stop anyone.",
};

const IMPACT_CATEGORY: Record<Expectation["impact"], FindingCategory> = {
  money: "functional",
  "data-loss": "state",
  "blocks-completion": "functional",
  "wrong-info": "functional",
  cosmetic: "ux",
};

export function groundingText(g: Grounding): string {
  switch (g.kind) {
    case "ui_text":
      return g.verified
        ? `grounded in on-screen text "${g.quote}"`
        : `the quoted text "${g.quote}" wasn't found on any page`;
    case "requirement":
      return g.verified
        ? `grounded in the requirements: "${g.quote}"`
        : `the quoted requirement wasn't found in the requirements text`;
    case "convention":
      return `grounded in convention: ${g.rationale}`;
  }
}

/**
 * An expectation can't be grounded in the very text it expects to see: if that text were on the page being
 * checked, the check would pass. A failure of such a check means the quote came from somewhere else (P2:
 * "Booking summary" from the booking form, asserted on the confirmation page).
 */
export function assertsOwnQuote(check: Check, quote: string): boolean {
  switch (check.type) {
    case "visible":
    case "textMatches":
      return (
        check.target.by === "text" &&
        (containsLoose(check.target.text, quote) || containsLoose(quote, check.target.text))
      );
    case "all":
      return check.checks.some((c) => assertsOwnQuote(c, quote));
    default:
      return false;
  }
}

/** Grounding facts a candidate carries for tiering (verify/tier.ts). */
export function candidateGrounding(exp: Expectation): NonNullable<Candidate["grounding"]> {
  const g = exp.grounding;
  const quote = g.kind === "convention" ? undefined : g.quote;
  return {
    kind: g.kind,
    verified: g.kind === "convention" ? false : g.verified,
    ...(quote ? { quote } : {}),
    ...(quote && assertsOwnQuote(exp.check, quote) ? { selfReferential: true } : {}),
    // D46: an input rule an AI guessed, not stated on the page. Witness's own fixed edge rules aren't.
    ...(g.kind === "convention" &&
    (exp.aiGuessed || (exp.origin !== "edge" && exp.category === "validation"))
      ? { aiGuessedRule: true }
      : {}),
  };
}

export function checkCandidate(input: {
  exp: Expectation;
  result: CheckResult;
  /** For fieldRejected: the form's success signature when it ran. */
  successCheck?: Check;
  url: string;
  state?: Pick<PageState, "id">;
  session: PageState["session"];
  journeyId: string;
  stepIds: string[];
  evidenceIds: string[];
}): Candidate {
  const { exp, result } = input;
  const route = routePattern(input.url);
  return {
    id: newId("cd"),
    kind: "bug",
    source: { kind: "check", id: result.leaf, expectationId: exp.id },
    category: exp.category ?? IMPACT_CATEGORY[exp.impact],
    route,
    url: input.url,
    stateId: input.state?.id,
    session: input.session,
    viewport: "desktop",
    journeyId: input.journeyId,
    stepIds: input.stepIds,
    evidenceIds: input.evidenceIds,
    signature: { kind: "check_failed", expectationId: exp.id },
    groupKey: `check|${exp.statement.toLowerCase()}`,
    signals: {},
    detail: {
      title: clip(`Failed check: ${exp.statement}`, 110),
      impact: IMPACT_TEXT[exp.impact],
      expected: exp.statement,
      actual: result.message,
      whyFlagged: `Check "${result.leaf}" failed on ${route}; ${groundingText(exp.grounding)}.`,
    },
    summary: exp.statement,
    check: exp.check,
    ...(input.successCheck && exp.check.type === "fieldRejected"
      ? { successCheck: input.successCheck }
      : {}),
    grounding: candidateGrounding(exp),
  };
}

export function flagCandidate(input: {
  summary: string;
  category: FindingCategory;
  evidenceIds: string[];
  url: string;
  state?: Pick<PageState, "id">;
  session: PageState["session"];
  journeyId: string;
  stepIds: string[];
}): Candidate {
  const route = routePattern(input.url);
  const id = newId("cd");
  return {
    id,
    kind: "bug",
    source: { kind: "judgement", confidence: 0.5 },
    category: input.category,
    route,
    url: input.url,
    stateId: input.state?.id,
    session: input.session,
    viewport: "desktop",
    journeyId: input.journeyId,
    stepIds: input.stepIds,
    evidenceIds: input.evidenceIds,
    signature: { kind: "judgement", expectationId: id },
    groupKey: `flag|${route}|${input.summary.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 80)}`,
    signals: {},
    detail: {
      title: clip(input.summary, 110),
      impact:
        "The Explorer reported this as looking broken; no deterministic check has confirmed it yet.",
      expected: "The page behaves as a user would expect at this point.",
      actual: input.summary,
      whyFlagged:
        "Judgement: flagged by the Explorer (an LLM). Not yet confirmed by a check or a replay.",
    },
    summary: input.summary,
  };
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
