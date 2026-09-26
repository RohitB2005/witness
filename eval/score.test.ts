// Scorer tests against the real (frozen) bench/bugs.yaml. The three "worked examples" are the ones in
// the P1 teach-back (docs/DEVLOG.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding, RunResult } from "@witness/engine";
import { failingField, matchFinding } from "./match";
import { LabelsFileSchema, recallTier, scoreRun, stabilityJaccard, type Labels } from "./score-lib";
import { loadTruth, REPO_ROOT, RuleSchema } from "./truth";

const { truth } = loadTruth();

function finding(over: Partial<Finding>): Finding {
  return {
    id: "fd_test",
    fingerprint: "fp_test",
    kind: "bug",
    tier: "confirmed",
    tierReason: "",
    severity: "high",
    category: "functional",
    source: { kind: "detector", id: "DET-HTTP5XX" },
    route: "/",
    title: "",
    impact: "",
    whyFlagged: "",
    steps: [],
    expected: "",
    actual: "",
    evidenceIds: [],
    instances: [],
    candidateIds: [],
    replay: { attempts: 3, reproduced: 3 },
    signals: {},
    ...over,
  };
}

describe("bugs.yaml loads and validates", () => {
  it("has 18 bugs and 4 decoys, all rules well-formed", () => {
    expect(truth.bugs.map((b) => b.id)).toEqual(
      Array.from({ length: 18 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`),
    );
    expect(truth.decoys.map((d) => d.id)).toEqual(["D01", "D02", "D03", "D04"]);
  });
  it("rejects an unknown rule field instead of ignoring it", () => {
    expect(() => RuleSchema.parse({ sourec: "DET-HTTP5XX" })).toThrow();
  });
});

describe("worked examples (teach-back)", () => {
  it("1. a 500 from POST /api/bookings matches B05 firmly (rule 1: source + request_path + method)", () => {
    const f = finding({
      source: { kind: "detector", id: "DET-HTTP5XX" },
      category: "crash",
      route: "/book",
      title: "Server error (500) from POST /api/bookings",
      signals: { request: { method: "POST", path: "/api/bookings", status: 500 } },
    });
    expect(matchFinding(f, truth)).toEqual({
      kind: "bug",
      id: "B05",
      ruleIndex: 0,
      tentative: false,
    });
  });

  it("2. a slow-quote performance finding matches decoy D03 (the 800 ms 'Calculating…' is by design)", () => {
    const f = finding({
      kind: "improvement",
      tier: "evidence_based",
      source: { kind: "detector", id: "DET-PERF" },
      category: "performance",
      route: "/quote",
      title: "Slow API call: GET /api/quote took 2.1 s",
      signals: { request: { method: "GET", path: "/api/quote", status: 200, durationMs: 2100 } },
    });
    // Walks every bug first: B14 rule 1 fails on request_path, B14 rule 2 fails on route…
    const b14 = truth.bugs.find((b) => b.id === "B14")!;
    expect(b14.match.any.map((r) => failingField(r, f))).toEqual(["request_path", "route"]);
    // …then the decoys: D03 rule 1 (route ^/quote + category performance) matches.
    expect(matchFinding(f, truth)).toEqual({
      kind: "decoy",
      id: "D03",
      ruleIndex: 0,
      tentative: false,
    });
    expect(scoreRun(run([f]), truth, {}, { clean: false }).findings[0]).toMatchObject({
      outcome: "fp",
      decoyId: "D03",
    });
  });

  it("3. a judged 'total includes GST twice' finding is only a TENTATIVE B01 match (keyword rule)", () => {
    const f = finding({
      source: { kind: "judgement", confidence: 0.8 },
      tier: "likely",
      category: "functional",
      route: "/quote",
      title: "Quote total looks too high",
      actual: "Total is $178.54 but subtotal $135.00 plus GST should be $155.25",
    });
    // Rule 1 needs source numericRelation (a check), so it fails; rule 2 is category + route + keyword "gst".
    expect(matchFinding(f, truth)).toEqual({
      kind: "bug",
      id: "B01",
      ruleIndex: 1,
      tentative: true,
    });
    const scored = scoreRun(run([f]), truth, {}, { clean: false });
    expect(scored.findings[0]!.outcome).toBe("unlabelled");
    expect(scored.found).toEqual({}); // not counted until a human labels it
    const labels: Labels = { fp_test: { label: "tp:B01", reason: "total shows GST added twice" } };
    const labelled = scoreRun(run([f]), truth, labels, { clean: false });
    expect(labelled.found).toEqual({ B01: "likely" });
  });
});

describe("matching semantics", () => {
  it("first match in file order wins (B09 before B10)", () => {
    const f = finding({
      category: "broken-resource",
      source: { kind: "ux-review" },
      title: "Image link returns 404",
    });
    expect(matchFinding(f, truth)?.id).toBe("B09");
  });
  it("every field in a rule must hold (B16 needs route ^/book)", () => {
    const f = finding({
      source: { kind: "detector", id: "DET-OVERFLOW" },
      category: "responsive",
      route: "/faq",
    });
    expect(matchFinding(f, truth)).toBeUndefined();
    expect(matchFinding({ ...f, route: "/book" }, truth)?.id).toBe("B16");
  });
  it("message is a regex on signals.errorMessage (B11)", () => {
    const f = finding({
      source: { kind: "detector", id: "DET-PAGEERROR" },
      category: "crash",
      route: "/",
      signals: { errorMessage: "TypeError: Cannot read properties of undefined (reading 'links')" },
    });
    expect(matchFinding(f, truth)?.id).toBe("B11");
  });
  it("axe_rule matches signals.axeRuleId (B12, B13)", () => {
    const a11y = (rule: string) =>
      finding({
        kind: "improvement",
        tier: "evidence_based",
        category: "accessibility",
        source: { kind: "detector", id: "DET-A11Y" },
        signals: { axeRuleId: rule },
      });
    expect(matchFinding(a11y("label"), truth)?.id).toBe("B12");
    expect(matchFinding(a11y("color-contrast"), truth)?.id).toBe("B13");
    expect(matchFinding(a11y("region"), truth)).toBeUndefined();
  });
});

function run(findings: Finding[], over: Partial<RunResult> = {}): RunResult {
  return {
    runId: "run_20260101-000000_test",
    config: {
      url: "http://localhost:5180/",
      mode: "staging",
      budget: "standard",
      pipeline: "deterministic",
      llmCache: "rw",
      viewport: { width: 1280, height: 800 },
      mobileViewport: { width: 375, height: 667 },
    },
    scope: "http://localhost:5180",
    startedAt: "",
    finishedAt: "",
    verdict: { level: "caveats", reason: "" },
    notTested: [],
    findings,
    journeys: [],
    states: [],
    stats: {
      pages: 0,
      steps: 0,
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      candidates: 0,
      discarded: 0,
      durationMs: 60_000,
      capsHit: [],
    },
    ...over,
  };
}

describe("scoreRun", () => {
  const b05 = finding({
    fingerprint: "fp_b05",
    tier: "likely",
    source: { kind: "detector", id: "DET-HTTP5XX" },
    route: "/book",
    signals: { request: { method: "POST", path: "/api/bookings", status: 500 } },
  });
  const b13 = finding({
    fingerprint: "fp_b13",
    kind: "improvement",
    tier: "evidence_based",
    category: "accessibility",
    source: { kind: "detector", id: "DET-A11Y" },
    signals: { axeRuleId: "color-contrast" },
  });
  const b05discarded = { ...b05, fingerprint: "fp_x", tier: "discarded" as const };
  const unknown = finding({
    fingerprint: "fp_unknown",
    tier: "likely",
    category: "ux",
    source: { kind: "ux-review" },
    title: "Hero image is blurry",
  });

  it("computes recall at each tier set, mapping improvement tiers (D12)", () => {
    const s = scoreRun(run([b05, b13, b05discarded, unknown]), truth, {}, { clean: false });
    expect(s.found).toEqual({ B05: "likely", B13: "confirmed" });
    expect(s.recall.confirmed).toBeCloseTo(1 / 18);
    expect(s.recall.confirmedLikely).toBeCloseTo(2 / 18);
    expect(s.unlabelled).toBe(1); // the unknown finding; the discarded one isn't scored at all
    expect(s.precision.bugs.confirmedLikely).toBe(1); // b05 TP; unknown excluded (unlabelled)
    expect(s.tierAccuracy).toBe(0.5); // B13 at its expected Confirmed; B05 found Likely, expected Confirmed
  });

  it("labels override matches and count in precision", () => {
    const labels: Labels = {
      fp_unknown: { label: "fp", reason: "intended behaviour" },
      fp_b05: { label: "fp", reason: "test override" },
    };
    const s = scoreRun(run([b05, unknown]), truth, labels, { clean: false });
    expect(s.found).toEqual({});
    expect(s.precision.bugs.confirmedLikely).toBe(0);
  });

  it("counts Confirmed/Likely bug findings on a clean build as false positives", () => {
    const s = scoreRun(run([b05, b13, unknown]), truth, {}, { clean: true });
    expect(s.cleanFalsePositives).toBe(2); // b05 (likely) and unknown (likely); b13 is an improvement
  });

  it("maps tiers for recall", () => {
    expect(recallTier("evidence_based")).toBe("confirmed");
    expect(recallTier("suggestion")).toBe("needs_review");
    expect(recallTier("discarded")).toBeUndefined();
  });
});

describe("stabilityJaccard", () => {
  it.each([
    [
      [
        ["B01", "B02"],
        ["B01", "B02"],
      ],
      1,
    ],
    [[["B01"], ["B02"]], 0],
    [[["B01", "B02"], ["B01"], ["B01", "B02"]], (0.5 + 1 + 0.5) / 3],
    [[["B01"]], null],
  ])("%j → %s", (sets, expected) => {
    const v = stabilityJaccard(sets as string[][]);
    if (expected === null) expect(v).toBeNull();
    else expect(v).toBeCloseTo(expected as number);
  });
});

describe("labels file", () => {
  const ok = { label: "tp_unseeded", reason: "real, but no seeded bug covers it" };
  it.each([
    ["a fingerprint-keyed entry with a reason", { fp_0123456789abcdef: ok }, true],
    [
      "tp:Bxx and fp labels",
      {
        fp_0123456789abcdef: { ...ok, label: "tp:B01" },
        fp_fedcba9876543210: { ...ok, label: "fp" },
      },
      true,
    ],
    ["the old bare-string format", { fp_0123456789abcdef: "tp_unseeded" }, false],
    ["a missing reason", { fp_0123456789abcdef: { label: "fp" } }, false],
    ["a blank reason", { fp_0123456789abcdef: { ...ok, reason: "   " } }, false],
    ["a multi-line reason", { fp_0123456789abcdef: { ...ok, reason: "one\ntwo" } }, false],
    ["a key that isn't a fingerprint", { fd_0123456789abcdef: ok }, false],
    ["an unknown label", { fp_0123456789abcdef: { ...ok, label: "tp:B1" } }, false],
    ["an extra field", { fp_0123456789abcdef: { ...ok, note: "x" } }, false],
  ])("%s → valid: %s", (_name, input, valid) => {
    expect(LabelsFileSchema.safeParse(input).success).toBe(valid);
  });

  it("the committed eval/labels.json is valid", () => {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "eval", "labels.json"), "utf8"),
    );
    expect(LabelsFileSchema.safeParse(raw).error).toBeUndefined();
  });
});
