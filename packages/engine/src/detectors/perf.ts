// DET-PERF — slow document (TTFB > 800 ms), slow largest paint (LCP > 2.5 s), or a same-origin API call
// slower than 2 s. Improvement (evidence-based), low severity.
import type { CandidateDraft, PageDetector } from "./types";
import { pathOf, pathPattern } from "./util";

export const PERF_THRESHOLDS = { ttfbMs: 800, lcpMs: 2500, apiMs: 2000 } as const;

const API_TYPES = new Set(["fetch", "xhr"]);

export const perfDetector: PageDetector = {
  id: "DET-PERF",
  viewport: "desktop",
  async run({ capture, state }) {
    const out: CandidateDraft[] = [];
    const base = {
      kind: "improvement" as const,
      source: { kind: "detector" as const, id: "DET-PERF" as const },
      category: "performance" as const,
      severityHint: "low" as const,
    };
    const { ttfbMs, lcpMs } = capture.timing;
    if (ttfbMs !== undefined && ttfbMs > PERF_THRESHOLDS.ttfbMs) {
      out.push({
        ...base,
        signature: {
          kind: "detector",
          detectorId: "DET-PERF",
          key: `ttfb|${pathOf(state.routePattern)}`,
        },
        groupKey: `perf|ttfb|${pathOf(state.routePattern)}`,
        signals: {},
        detail: {
          title: `Page is slow to start loading (${ttfbMs} ms to first byte)`,
          impact: "Visitors wait before anything appears on this page.",
          expected: `The server starts responding within ${PERF_THRESHOLDS.ttfbMs} ms.`,
          actual: `Time to first byte was ${ttfbMs} ms.`,
          whyFlagged: `DET-PERF: document TTFB above ${PERF_THRESHOLDS.ttfbMs} ms.`,
        },
        summary: `TTFB ${ttfbMs} ms`,
        evidenceIds: [capture.evidence.timing],
      });
    }
    if (lcpMs !== undefined && lcpMs > PERF_THRESHOLDS.lcpMs) {
      out.push({
        ...base,
        signature: {
          kind: "detector",
          detectorId: "DET-PERF",
          key: `lcp|${pathOf(state.routePattern)}`,
        },
        groupKey: `perf|lcp|${pathOf(state.routePattern)}`,
        signals: {},
        detail: {
          title: `Main content appears slowly (${(lcpMs / 1000).toFixed(1)} s)`,
          impact: "The largest piece of content takes a long time to show.",
          expected: `Largest Contentful Paint within ${PERF_THRESHOLDS.lcpMs / 1000} s.`,
          actual: `Largest Contentful Paint was ${(lcpMs / 1000).toFixed(1)} s.`,
          whyFlagged: `DET-PERF: LCP above ${PERF_THRESHOLDS.lcpMs / 1000} s.`,
        },
        summary: `LCP ${lcpMs} ms`,
        evidenceIds: [capture.evidence.timing],
      });
    }
    const seen = new Set<string>();
    for (const e of capture.slice.network) {
      if (!e.sameOrigin || !API_TYPES.has(e.resourceType)) continue;
      if (e.durationMs === undefined || e.durationMs <= PERF_THRESHOLDS.apiMs) continue;
      const key = `${e.method} ${pathPattern(e.path)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const secs = (e.durationMs / 1000).toFixed(1);
      out.push({
        ...base,
        signature: { kind: "detector", detectorId: "DET-PERF", key: `api|${key}` },
        groupKey: `perf|api|${key}`,
        signals: {
          request: {
            method: e.method,
            path: e.path,
            status: e.status ?? 0,
            durationMs: e.durationMs,
          },
        },
        detail: {
          title: `Slow API call: ${e.method} ${e.path} took ${e.pending ? "over " : ""}${secs} s`,
          impact: "Content that depends on this request appears late, so the page feels slow.",
          expected: `${e.method} ${e.path} responds within ${PERF_THRESHOLDS.apiMs / 1000} s.`,
          actual: e.pending
            ? `Still waiting after ${secs} s.`
            : `It took ${secs} s (status ${e.status ?? "unknown"}).`,
          whyFlagged: `DET-PERF: same-origin API response slower than ${PERF_THRESHOLDS.apiMs / 1000} s.`,
        },
        summary: `${e.method} ${e.path} ${e.durationMs} ms`,
        evidenceIds: [capture.evidence.network],
      });
    }
    return out;
  },
};
