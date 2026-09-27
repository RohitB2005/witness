// SECURITY T7: page text in a finding can't inject markup into the HTML report; severity and tier are words.
import { describe, expect, it } from "vitest";
import type { Finding, RunResult } from "../types";
import { esc, renderHtml } from "./html";
import { renderMarkdown } from "./markdown";

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
    stats: { durationMs: 60_000, llmCalls: 1, costUsd: 0.01, pages: 3, capsHit: [] },
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
    expect(html).toContain("Severity: High");
    expect(html).toContain("Tier: Confirmed");
    expect(html).toContain("Verdict: Not ready.");
    expect(esc(`"a'<`)).toBe("&quot;a&#39;&lt;");
  });
});

describe("report order (Rohit, 28 Sep): verdict, then Requirements coverage, then Security, then the rest", () => {
  const withCriteria = (): RunResult => ({
    ...result(),
    requirements: {
      droppedCriteria: 0,
      criteria: [
        {
          id: "AC1",
          text: "Search works",
          quote: "Search works",
          importance: "core",
          plannedNotFound: false,
          lookFor: [],
          status: "verified",
          reason: "Checked.",
          expectationIds: [],
          journeyIds: [],
          findingIds: [],
        },
      ],
    },
  });
  const order = (text: string, marks: string[]) => marks.map((m) => text.indexOf(m));

  it("HTML", () => {
    const html = renderHtml(withCriteria());
    const at = order(html, [
      "Verdict:",
      "Requirements coverage",
      "<h2>Security (1)",
      "What wasn't tested",
      "<h2>Bugs",
    ]);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('<a href="#fd_1">'); // the security row links to its card
  });

  it("Markdown", () => {
    const md = renderMarkdown(withCriteria());
    const at = order(md, [
      "**Verdict:",
      "## Requirements coverage",
      "## Security (1)",
      "## What wasn't tested",
      "## Bugs",
    ]);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
