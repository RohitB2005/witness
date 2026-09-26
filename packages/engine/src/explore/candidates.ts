// Candidates from the AI stages: a failed check (source "check") or an Explorer flag (source "judgement").
// Wording is deterministic, built from the expectation and the evaluator's message (D22).
import { routePattern } from "../crawl/normalise";
import { newId } from "../ids";
import type { CheckResult } from "../oracle/evaluate";
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

export function checkCandidate(input: {
  exp: Expectation;
  result: CheckResult;
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
