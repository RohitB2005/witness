// Table-driven tests for the tier rules (SPEC FR-8; DEVLOG D46, D49, D51).
import { describe, expect, it } from "vitest";
import { decideTier, replayOutcome, tierWithStages, unverifiedTier, type TierInput } from "./tier";

const det = { kind: "detector", id: "DET-HTTP5XX" } as const;
const check = { kind: "check", id: "numericRelation", expectationId: "ex_1" } as const;
const flag = { kind: "judgement", confidence: 0.5 } as const;
const ok2 = { attempts: 2, reproduced: 2 };
const base: TierInput = { kind: "bug", source: det, evidenceValid: true, replay: ok2 };
const onPage = { kind: "ui_text", verified: true } as const;
const convention = { kind: "convention", verified: false } as const;

describe("replayOutcome (D49: two agreeing attempts; a third only when they disagree)", () => {
  it.each([
    [0, 0, "not_replayed"],
    [1, 1, "intermittent"], // a path replay needs two agreeing attempts; the second didn't run
    [1, 0, "not_reproduced"],
    [2, 2, "reproduced"],
    [2, 0, "not_reproduced"],
    [2, 1, "intermittent"], // the third attempt didn't happen (time)
    [3, 2, "reproduced"],
    [3, 1, "intermittent"],
  ])("%i attempts, %i reproduced → %s", (attempts, reproduced, want) => {
    expect(replayOutcome({ attempts, reproduced })).toBe(want);
  });
});

it("a static finding (no steps) is reproduced by one fresh re-run (FR-8)", () => {
  expect(replayOutcome({ attempts: 1, reproduced: 1, static: true })).toBe("reproduced");
});

describe("decideTier", () => {
  const cases: [string, Partial<TierInput>, string][] = [
    ["universal detector, reproduced", {}, "confirmed"],
    [
      "detector finding a person must decide (e.g. a Google key), reproduced",
      { review: "often public" },
      "needs_review",
    ],
    [
      "requirement not found in the app (A5): Likely at most, never replayed",
      {
        source: { kind: "requirement", id: "REQ-NOTFOUND", criterionId: "AC1" },
        replay: { attempts: 0, reproduced: 0 },
      },
      "likely",
    ],
    [
      "requirement not found, skeptic benign",
      {
        source: { kind: "requirement", id: "REQ-NOTFOUND", criterionId: "AC1" },
        replay: { attempts: 0, reproduced: 0 },
        skeptic: "benign_likely",
      },
      "needs_review",
    ],
    ["universal detector, not reproduced", { replay: { attempts: 2, reproduced: 0 } }, "discarded"],
    [
      "universal detector, intermittent",
      { replay: { attempts: 3, reproduced: 1 } },
      "needs_review",
    ],
    [
      "not replayed (time)",
      { replay: { attempts: 0, reproduced: 0, skipped: "time" } },
      "needs_review",
    ],
    ["evidence invalid", { evidenceValid: false }, "discarded"],
    [
      "suppressed",
      { suppressed: { at: "2026-09-27T10:00:00Z", reason: "by design" } },
      "discarded",
    ],
    ["check grounded on the page", { source: check, grounding: onPage }, "confirmed"],
    [
      "check grounded in requirements",
      { source: check, grounding: { kind: "requirement", verified: true } },
      "confirmed",
    ],
    [
      "check with an unverified quote",
      { source: check, grounding: { kind: "ui_text", verified: false } },
      "likely",
    ],
    ["check grounded in convention", { source: check, grounding: convention }, "likely"],
    [
      "check asserting its own quote (self-referential)",
      { source: check, grounding: { ...onPage, selfReferential: true } },
      "needs_review",
    ],
    [
      "AI-guessed input rule (D46)",
      { source: check, grounding: { ...convention, aiGuessedRule: true } },
      "needs_review",
    ],
    [
      "grounded check, skeptic benign",
      { source: check, grounding: onPage, skeptic: "benign_likely" },
      "needs_review",
    ],
    [
      "grounded check, skeptic unclear",
      { source: check, grounding: onPage, skeptic: "unclear" },
      "confirmed",
    ],
    [
      "convention check, skeptic benign",
      { source: check, grounding: convention, skeptic: "benign_likely" },
      "needs_review",
    ],
    ["flag, judge bug 0.8", { source: flag, judge: { verdict: "bug", confidence: 0.8 } }, "likely"],
    [
      "flag, judge bug 0.6",
      { source: flag, judge: { verdict: "bug", confidence: 0.6 } },
      "needs_review",
    ],
    [
      "flag, judge unclear",
      { source: flag, judge: { verdict: "unclear", confidence: 0.9 } },
      "needs_review",
    ],
    [
      "flag, judge not a bug",
      { source: flag, judge: { verdict: "not_bug", confidence: 0.9 } },
      "discarded",
    ],
    ["flag, not judged", { source: flag }, "needs_review"],
    [
      "flag, judge bug, skeptic benign",
      { source: flag, judge: { verdict: "bug", confidence: 0.9 }, skeptic: "benign_likely" },
      "needs_review",
    ],
    [
      "improvement, re-run shows it",
      { kind: "improvement", replay: { attempts: 1, reproduced: 1 } },
      "evidence_based",
    ],
    [
      "improvement, re-run doesn't",
      { kind: "improvement", replay: { attempts: 1, reproduced: 0 } },
      "discarded",
    ],
    [
      "improvement, not re-run",
      { kind: "improvement", replay: { attempts: 0, reproduced: 0 } },
      "evidence_based",
    ],
    ["UX suggestion", { kind: "improvement", source: { kind: "ux-review" } }, "suggestion"],
  ];
  it.each(cases)("%s → %s", (_name, patch, want) => {
    const d = decideTier({ ...base, ...patch });
    expect(d.tier).toBe(want);
    expect(d.reason.length).toBeGreaterThan(10);
    expect(d.reason).not.toMatch(/undefined|NaN/);
  });

  it("says how often it reproduced, in words", () => {
    expect(decideTier({ ...base, replay: { attempts: 3, reproduced: 2 } }).reason).toContain(
      "reproduced 2 of 3 replays",
    );
  });
});

describe("stage tiers (D51) and the unverified pipeline (A1)", () => {
  it("A1 takes every bug candidate at face value, before caps, replay and skeptic (D62)", () => {
    for (const i of [
      { kind: "bug", source: det },
      { kind: "bug", source: check, grounding: onPage },
      { kind: "bug", source: check, grounding: convention },
      { kind: "bug", source: check, grounding: { ...convention, aiGuessedRule: true } },
      { kind: "bug", source: check, grounding: { ...onPage, selfReferential: true } },
      { kind: "bug", source: flag },
    ] as const)
      expect(unverifiedTier(i).tier).toBe("confirmed");
    expect(unverifiedTier({ kind: "improvement", source: det }).tier).toBe("evidence_based");
  });

  it("records every stage from one set of facts", () => {
    const i: TierInput = {
      ...base,
      source: check,
      grounding: onPage,
      replay: { attempts: 2, reproduced: 0 },
    };
    const r = tierWithStages(i, "full");
    expect(r.tier).toBe("discarded");
    expect(r.stageTiers).toEqual({ aiNoVerify: "confirmed", noSkeptic: "discarded" });
    const s = tierWithStages({ ...i, replay: ok2, skeptic: "benign_likely" }, "full");
    expect(s.tier).toBe("needs_review");
    expect(s.stageTiers.noSkeptic).toBe("confirmed");
    expect(
      tierWithStages({ ...i, replay: ok2, skeptic: "benign_likely" }, "full-no-skeptic").tier,
    ).toBe("confirmed");
    expect(tierWithStages(i, "ai-no-verify").tier).toBe("confirmed");
  });
});
