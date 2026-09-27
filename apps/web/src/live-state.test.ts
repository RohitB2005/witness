// The live view's plain-language state (FR-13) from a scripted event stream.
import { describe, expect, it } from "vitest";
import type { WitnessEvent } from "@witness/engine";
import { initialLiveState, liveReducer, plainVerify } from "./live-state";

const run = (events: WitnessEvent[]) => events.reduce(liveReducer, initialLiveState);

describe("liveReducer", () => {
  it("names phases in plain language, never the internal ids", () => {
    const s = run([
      { t: "phase", phase: "map", at: "" },
      { t: "phase", phase: "verify", at: "" },
    ]);
    expect(s.phasesSeen).toEqual(["map", "verify"]);
    expect(s.now).toBe("Double-checking findings…");
  });

  it("follows a candidate from being found to its tier, with the reason", () => {
    const s = run([
      {
        t: "candidate",
        candidate: {
          id: "cd_1",
          category: "functional",
          summary: "Total is wrong",
          route: "/quote",
        },
      },
      { t: "verify", candidateId: "cd_1", stage: "replay", detail: "Replay 1: reproduced" },
      {
        t: "verify",
        candidateId: "cd_1",
        stage: "replay",
        detail: 'Replay 2: not reproduced (step 3 ("Click") failed: gone)',
      },
      {
        t: "tier",
        candidateIds: ["cd_1"],
        tier: "needs_review",
        reason: "Intermittent: reproduced 1 of 2 replays.",
      },
    ]);
    expect(s.candidates).toEqual([
      expect.objectContaining({
        summary: "Total is wrong",
        progress: [
          "Replay 1: it happened again",
          'Replay 2: it didn\'t happen (step 3 ("Click") failed: gone)',
        ],
        tier: "needs_review",
        reason: "Intermittent: reproduced 1 of 2 replays.",
      }),
    ]);
    expect(s.now).toBe('"Total is wrong" → Needs review');
  });

  it("says what the agent is doing, and when an action didn't work", () => {
    const s = run([
      {
        t: "step",
        step: {
          id: "sp_1",
          journeyId: "jr_1",
          index: 0,
          description: 'Type "3" into the "Hours" field',
          ok: true,
          kind: "happy",
        },
        thumb: "ev_1.jpg",
      },
      {
        t: "step",
        step: {
          id: "sp_2",
          journeyId: "jr_1",
          index: 1,
          description: 'Click the "Book" button',
          ok: false,
          kind: "happy",
        },
      },
    ]);
    expect(s.steps[0]?.thumb).toBe("ev_1.jpg");
    expect(s.now).toBe('Didn\'t work: Click the "Book" button');
  });

  it("keeps the cost meter and the verdict", () => {
    const s = run([
      { t: "cost", llmCalls: 3, costUsd: 0.02 },
      { t: "done", verdict: { level: "caveats", reason: "Two things to check." } },
    ]);
    expect(s.cost).toEqual({ llmCalls: 3, costUsd: 0.02 });
    expect(s.verdict?.level).toBe("caveats");
  });
});

describe("plainVerify", () => {
  it.each([
    ["skeptic", "Skeptic: benign_likely", "Second opinion: may be intended"],
    ["tier", "Judge: bug (0.85)", "AI judge: a bug (85% confident)"],
    ["replay", "Replay 2: reproduced", "Replay 2: it happened again"],
  ])("%s %s", (stage, detail, want) => {
    expect(plainVerify(stage, detail)).toBe(want);
  });
});

describe("steps and checks read differently", () => {
  it("a failed check says it failed, not that an action didn't work", () => {
    const s = run([
      {
        t: "step",
        step: {
          id: "sp_1",
          journeyId: "jr_1",
          index: 0,
          description: "Check: The total includes tax once",
          ok: false,
          kind: "happy",
        },
      },
    ]);
    expect(s.now).toBe("Check failed: The total includes tax once");
  });
  it("a detector's terse name is replaced by the candidate's plain title", () => {
    const s = run([
      { t: "detector", candidateId: "cd_1", detectorId: "DET-A11Y", summary: "axe label (1)" },
      {
        t: "candidate",
        candidate: {
          id: "cd_1",
          category: "accessibility",
          summary: "axe label (1)",
          route: "/",
          title: "Accessibility: Form elements must have labels",
        },
      },
    ]);
    expect(s.candidates.map((c) => c.summary)).toEqual([
      "Accessibility: Form elements must have labels",
    ]);
  });
});
