// Table-driven tests for the pure report rules: severity, verdict, fingerprints, provisional tier, grouping.
import { describe, expect, it } from "vitest";
import type { Candidate, CandidateSource, Finding } from "../types";
import { buildFindings, provisionalTier, reproSteps } from "./findings";
import { fingerprint } from "./fingerprint";
import { severityFor, type SeverityInput } from "./severity";
import { readinessVerdict } from "./verdict";

const det = (id: string) => ({ kind: "detector", id }) as CandidateSource;
const check = { kind: "check", id: "numericRelation", expectationId: "ex_1" } as const;

describe("severityFor (FR-9)", () => {
  const cases: [string, SeverityInput, string][] = [
    [
      "5xx in a core journey",
      { kind: "bug", source: det("DET-HTTP5XX"), journeyPriority: "core" },
      "critical",
    ],
    [
      "page error in a core journey",
      { kind: "bug", source: det("DET-PAGEERROR"), journeyPriority: "core" },
      "critical",
    ],
    ["5xx outside journeys", { kind: "bug", source: det("DET-HTTP5XX") }, "high"],
    ["page error while crawling", { kind: "bug", source: det("DET-PAGEERROR") }, "high"],
    ["XSS anywhere", { kind: "bug", source: det("DET-XSS") }, "high"],
    [
      "money check in core",
      { kind: "bug", source: check, journeyPriority: "core", checkImpact: "money" },
      "critical",
    ],
    [
      "data-loss check in core",
      { kind: "bug", source: check, journeyPriority: "core", checkImpact: "data-loss" },
      "critical",
    ],
    [
      "wrong-info check in core",
      { kind: "bug", source: check, journeyPriority: "core", checkImpact: "wrong-info" },
      "high",
    ],
    [
      "check in secondary",
      { kind: "bug", source: check, journeyPriority: "secondary", checkImpact: "money" },
      "medium",
    ],
    [
      "overflow on a core-journey page",
      { kind: "bug", source: det("DET-OVERFLOW"), onCoreJourneyPage: true },
      "medium",
    ],
    ["overflow elsewhere", { kind: "bug", source: det("DET-OVERFLOW") }, "low"],
    [
      "console in core",
      { kind: "bug", source: det("DET-CONSOLE"), journeyPriority: "core" },
      "medium",
    ],
    ["console elsewhere", { kind: "bug", source: det("DET-CONSOLE") }, "low"],
    [
      "axe serious",
      { kind: "improvement", source: det("DET-A11Y"), severityHint: "medium" },
      "medium",
    ],
    ["axe minor", { kind: "improvement", source: det("DET-A11Y"), severityHint: "low" }, "low"],
    ["broken link", { kind: "bug", source: det("DET-BROKENLINK") }, "low"],
    ["broken image", { kind: "bug", source: det("DET-BROKENIMG") }, "low"],
    ["perf", { kind: "improvement", source: det("DET-PERF") }, "low"],
    ["security headers", { kind: "improvement", source: det("DET-SECHEADERS") }, "low"],
  ];
  it.each(cases)("%s → %s", (_n, input, expected) => expect(severityFor(input)).toBe(expected));
});

describe("readinessVerdict (FR-9)", () => {
  const f = (kind: Finding["kind"], tier: Finding["tier"], severity: Finding["severity"]) => ({
    kind,
    tier,
    severity,
    title: `${severity} ${kind}`,
  });
  const core = (status: "completed" | "incomplete") => ({
    priority: "core" as const,
    status,
    title: "Book",
  });
  const cases: [string, Parameters<typeof readinessVerdict>[0], string][] = [
    [
      "confirmed critical bug",
      { findings: [f("bug", "confirmed", "critical")], journeys: [], journeysAttempted: true },
      "not_ready",
    ],
    [
      "likely high bug",
      { findings: [f("bug", "likely", "high")], journeys: [], journeysAttempted: true },
      "not_ready",
    ],
    [
      "needs-review critical bug only",
      {
        findings: [f("bug", "needs_review", "critical")],
        journeys: [core("completed")],
        journeysAttempted: true,
      },
      "caveats",
    ],
    [
      "discarded critical bug",
      {
        findings: [f("bug", "discarded", "critical")],
        journeys: [core("completed")],
        journeysAttempted: true,
      },
      "ready",
    ],
    [
      "only a medium bug",
      {
        findings: [f("bug", "confirmed", "medium")],
        journeys: [core("completed")],
        journeysAttempted: true,
      },
      "caveats",
    ],
    [
      "core journey incomplete",
      { findings: [], journeys: [core("incomplete")], journeysAttempted: true },
      "caveats",
    ],
    [
      "improvements only, journeys done",
      {
        findings: [f("improvement", "evidence_based", "medium")],
        journeys: [core("completed")],
        journeysAttempted: true,
      },
      "ready",
    ],
    [
      "nothing found but no journeys exercised (D16)",
      { findings: [], journeys: [], journeysAttempted: false },
      "caveats",
    ],
  ];
  it.each(cases)("%s → %s", (_n, input, level) => {
    const v = readinessVerdict(input);
    expect(v.level).toBe(level);
    expect(v.reason.length).toBeGreaterThan(10);
  });
});

describe("fingerprint (FR-12)", () => {
  const base = {
    category: "crash",
    route: "/book",
    sourceId: "DET-HTTP5XX",
    key: "POST /api/bookings",
  };
  it("is stable and ignores digits/case/whitespace in the key", () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
    expect(fingerprint({ ...base, key: "post  /api/bookings" })).toBe(fingerprint(base));
    expect(fingerprint({ ...base, key: "3 items" })).toBe(fingerprint({ ...base, key: "4 items" }));
  });
  it("changes with route, source or request", () => {
    const fp = fingerprint(base);
    expect(fingerprint({ ...base, route: "/quote" })).not.toBe(fp);
    expect(fingerprint({ ...base, sourceId: "DET-REQFAIL" })).not.toBe(fp);
    expect(fingerprint({ ...base, request: { method: "POST", path: "/api/bookings" } })).not.toBe(
      fp,
    );
  });
});

function candidate(over: Partial<Candidate>): Candidate {
  return {
    id: "cd_x",
    kind: "bug",
    source: { kind: "detector", id: "DET-BROKENIMG" },
    category: "broken-resource",
    route: "/services",
    url: "http://a.test/services",
    session: "anonymous",
    viewport: "desktop",
    stepIds: [],
    evidenceIds: ["ev_1"],
    signature: { kind: "detector", detectorId: "DET-BROKENIMG", key: "/img.png" },
    groupKey: "brokenimg|http://a.test/img.png",
    signals: { request: { method: "GET", path: "/img.png", status: 404 } },
    detail: {
      title: "Image doesn't load",
      impact: "i",
      expected: "e",
      actual: "It 404s.",
      whyFlagged: "w",
    },
    summary: "s",
    ...over,
  };
}

describe("provisionalTier (P1, until replay exists)", () => {
  it.each([
    [{ kind: "bug", source: det("DET-HTTP5XX") }, "likely"],
    [{ kind: "improvement", source: det("DET-A11Y") }, "evidence_based"],
    [{ kind: "bug", source: check }, "needs_review"],
  ] as const)("%o → %s", (c, tier) => expect(provisionalTier(c).tier).toBe(tier));
});

describe("buildFindings", () => {
  const ctx = { mobileViewport: { width: 375, height: 667 } };
  it("groups candidates with the same group key into one finding with instances", () => {
    const findings = buildFindings(
      [
        candidate({
          id: "cd_b",
          route: "/services/:id",
          url: "http://a.test/services/5",
          evidenceIds: ["ev_2"],
        }),
        candidate({ id: "cd_a" }),
      ],
      ctx,
    );
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.route).toBe("/services"); // primary instance = lexically first route, independent of order
    expect(f!.instances.map((i) => i.route)).toEqual(["/services", "/services/:id"]);
    expect(f!.candidateIds.sort()).toEqual(["cd_a", "cd_b"]);
    expect(f!.actual).toContain("Seen on 2 pages");
    expect(f!.tier).toBe("likely");
    expect(f!.severity).toBe("low");
    expect(f!.fingerprint).toMatch(/^fp_[0-9a-f]{16}$/);
  });
  it("gives the same fingerprint regardless of crawl order", () => {
    const a = candidate({ id: "cd_1" });
    const b = candidate({ id: "cd_2", route: "/services/:id", url: "http://a.test/services/5" });
    expect(buildFindings([a, b], ctx)[0]!.fingerprint).toBe(
      buildFindings([b, a], ctx)[0]!.fingerprint,
    );
  });
  it("sorts bugs before improvements, then by severity", () => {
    const findings = buildFindings(
      [
        candidate({
          id: "i",
          kind: "improvement",
          source: det("DET-PERF"),
          groupKey: "p",
          category: "performance",
        }),
        candidate({ id: "b1", groupKey: "low" }),
        candidate({ id: "b2", source: det("DET-HTTP5XX"), groupKey: "high", category: "crash" }),
      ],
      ctx,
    );
    expect(findings.map((f) => f.severity + ":" + f.kind)).toEqual([
      "high:bug",
      "low:bug",
      "low:improvement",
    ]);
  });
  it("writes deterministic steps including login and phone size when relevant", () => {
    const steps = reproSteps(
      candidate({ session: "authenticated", viewport: "mobile", source: det("DET-OVERFLOW") }),
      { ...ctx, accountLabel: "the account a@b.test" },
    );
    expect(steps).toEqual([
      "Log in with the account a@b.test.",
      "Set the browser window to 375 × 667 (phone size).",
      "Open http://a.test/services",
      "Scroll sideways: part of the page is off-screen.",
    ]);
  });
});
