// Requirements coverage (ADDENDUM A5): the page search behind "Not found in the app", and how code decides
// each criterion's status from the run's steps, candidates and findings.
import { describe, expect, it } from "vitest";
import type { ValidCriterion } from "../plan/planner";
import type { Candidate, Finding, Journey, Step } from "../types";
import { criteriaCoverage, mentions, notFoundCandidates } from "./requirements";

describe("mentions", () => {
  it.each([
    ['- button "Reschedule"', "Reschedule", true],
    ["Rescheduling is free", "reschedule", true],
    ['- link "Change date"', "Change the date", true], // "the" is a stopword
    ['- button "Cancel"', "Reschedule", false],
    ["Move booking", "Change date", false],
    ['- button "Go"', "Go", true], // no word of 3+ letters: matched as a whole
    ['- button "Stop"', "Go", false],
  ])("%j mentions %j → %s", (text, term, want) => {
    expect(mentions(text, term)).toBe(want);
  });
});

const crit = (over: Partial<ValidCriterion> = {}): ValidCriterion => ({
  id: "AC1",
  text: "Renew a loan",
  quote: "Members can renew a loan online.",
  importance: "core",
  plannedNotFound: false,
  lookFor: [],
  ...over,
});

const evidence = { put: async () => "ev_search" } as never;

describe("notFoundCandidates", () => {
  const pages = [
    { url: "http://a.test/", route: "/", text: '- heading "Home"' },
    { url: "http://a.test/loans", route: "/loans", text: '- button "Return"' },
  ];

  it("reports a missing feature only when no recorded page mentions its words", async () => {
    const out = await notFoundCandidates({
      criteria: [
        crit({ plannedNotFound: true, lookFor: ["Renew", "Extend loan"] }),
        crit({ id: "AC2", plannedNotFound: true, lookFor: ["Return"] }), // it's there after all
        crit({ id: "AC3", plannedNotFound: false }),
      ],
      pages,
      startUrl: "http://a.test/",
      session: "authenticated",
      evidence,
    });
    expect(out.candidates.map((c) => c.source)).toEqual([
      { kind: "requirement", id: "REQ-NOTFOUND", criterionId: "AC1" },
    ]);
    const c = out.candidates[0]!;
    expect(c.detail.expected).toContain("Members can renew a loan online.");
    expect(c.detail.actual).toBe(
      'None of the 2 pages Witness recorded (2 routes) mentions "Renew", "Extend loan".',
    );
    expect(c.grounding).toEqual({ kind: "requirement", verified: true, quote: crit().quote });
    expect(out.mentioned.get("AC2")).toEqual({ term: "Return", route: "/loans" });
  });
});

function step(expectationId: string, ok = true): Step {
  return {
    id: `sp_${expectationId}`,
    journeyId: "jr_1",
    index: 0,
    kind: "happy",
    action: { type: "check", check: { type: "noNewErrors" }, expectationId },
    description: "check",
    beforeEvidenceIds: [],
    afterEvidenceIds: [],
    urlBefore: "http://a.test/",
    urlAfter: "http://a.test/",
    ok,
  };
}

function journey(over: Partial<Journey> = {}): Journey {
  const ex = (id: string, criterionId?: string) => ({
    id,
    journeyId: "jr_1",
    statement: `statement ${id}`,
    check: { type: "noNewErrors" as const },
    grounding: { kind: "convention" as const, rationale: "x" },
    impact: "wrong-info" as const,
    ...(criterionId ? { criterionId } : {}),
  });
  return {
    id: "jr_1",
    title: "Loans",
    goal: "g",
    priority: "core",
    startRoute: "/",
    suggestedSteps: [],
    expectations: [ex("ex_1", "AC1"), ex("ex_2", "AC2"), ex("ex_3", "AC3")],
    status: "completed",
    criterionIds: ["AC1", "AC2", "AC3", "AC4"],
    steps: [step("ex_1"), step("ex_2"), step("ex_3")],
    ...over,
  };
}

const cand = (id: string, expectationId: string) =>
  ({ id, source: { kind: "check", id: "noNewErrors", expectationId } }) as Candidate;
const finding = (id: string, candidateIds: string[], tier: Finding["tier"]) =>
  ({
    id,
    kind: "bug",
    tier,
    title: `Finding ${id}`,
    candidateIds,
    source: { kind: "check" },
  }) as unknown as Finding;

describe("criteriaCoverage", () => {
  it("verified, failed, not tested (unverified failure), not tested (never reached), not found", () => {
    const notFound = {
      id: "fd_nf",
      kind: "bug",
      tier: "likely",
      title: "Not found",
      candidateIds: [],
      source: { kind: "requirement", id: "REQ-NOTFOUND", criterionId: "AC5" },
    } as unknown as Finding;
    const out = criteriaCoverage({
      criteria: [
        crit(),
        crit({ id: "AC2" }),
        crit({ id: "AC3" }),
        crit({ id: "AC4" }),
        crit({ id: "AC5", plannedNotFound: true, lookFor: ["Renew"] }),
      ],
      journeys: [journey()],
      candidates: [cand("cd_2", "ex_2"), cand("cd_3", "ex_3")],
      findings: [
        finding("fd_2", ["cd_2"], "confirmed"),
        finding("fd_3", ["cd_3"], "needs_review"),
        notFound,
      ],
      mentioned: new Map(),
    });
    expect(out.map((c) => [c.id, c.status, c.findingIds])).toEqual([
      ["AC1", "verified", []],
      ["AC2", "failed", ["fd_2"]],
      ["AC3", "not_tested", ["fd_3"]],
      ["AC4", "not_tested", []],
      ["AC5", "not_found", ["fd_nf"]],
    ]);
    expect(out[3]!.reason).toMatch(/no check Witness could evaluate/);
  });

  it("an unfinished journey is the reason a check wasn't reached", () => {
    const [c] = criteriaCoverage({
      criteria: [crit()],
      journeys: [journey({ status: "incomplete", incompleteReason: "time ran out", steps: [] })],
      candidates: [],
      findings: [],
      mentioned: new Map(),
    });
    expect(c!.status).toBe("not_tested");
    expect(c!.reason).toBe('Journey "Loans" didn\'t reach its check (time ran out).');
  });

  it("a discarded failure is neither a pass nor a failure", () => {
    const [c] = criteriaCoverage({
      criteria: [crit()],
      journeys: [journey()],
      candidates: [cand("cd_1", "ex_1")],
      findings: [finding("fd_1", ["cd_1"], "discarded")],
      mentioned: new Map(),
    });
    expect(c!.status).toBe("not_tested");
  });
});
