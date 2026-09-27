// SECURITY T7: page text in a finding can't inject markup into the HTML report; severity and tier are words.
import { describe, expect, it } from "vitest";
import type { Finding, RunResult } from "../types";
import { esc, renderHtml } from "./html";

const evil = `<script>alert("x")</script><img src=x onerror=alert(1)>`;

function result(): RunResult {
  const f = {
    id: "fd_1",
    fingerprint: "fp_1",
    kind: "bug",
    tier: "confirmed",
    tierReason: "It reproduced 2 of 2 replays.",
    severity: "high",
    category: "security",
    source: { kind: "detector", id: "DET-XSS" },
    route: "/search?q",
    title: `Search shows ${evil}`,
    impact: "Attackers could run code.",
    whyFlagged: "DET-XSS",
    steps: [`Type "${evil}" into the search box`],
    expected: "Shown as text",
    actual: evil,
    evidenceIds: ["ev_1"],
    instances: [],
    candidateIds: [],
    replay: { attempts: 2, reproduced: 2 },
    signals: {},
  } as unknown as Finding;
  return {
    runId: "run_x",
    scope: "http://app.test",
    config: { mode: "staging", budget: "quick", pipeline: "full" },
    startedAt: "2026-09-27T00:00:00Z",
    finishedAt: "2026-09-27T00:01:00Z",
    verdict: { level: "not_ready", reason: `Not ready: ${evil}` },
    notTested: [evil],
    notes: [evil],
    findings: [f],
    journeys: [],
    states: [],
    stats: { durationMs: 60_000, llmCalls: 1, costUsd: 0.01, pages: 3 },
  } as unknown as RunResult;
}

describe("renderHtml", () => {
  it("escapes every page-controlled value (T7)", () => {
    const html = renderHtml(result(), {
      images: new Map([["ev_1", `javascript:alert(1)`]]),
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:alert"); // only data:image URIs are inlined
    expect((html.match(/<script/gi) ?? []).length).toBe(0);
  });
  it("writes severity, tier and verdict as words", () => {
    const html = renderHtml(result());
    expect(html).toContain("Severity: high");
    expect(html).toContain("Tier: Confirmed");
    expect(html).toContain("Verdict: Not ready.");
    expect(esc(`"a'<`)).toBe("&quot;a&#39;&lt;");
  });
});
