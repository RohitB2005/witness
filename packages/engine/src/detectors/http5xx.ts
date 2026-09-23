// DET-HTTP5XX — a same-origin response with status ≥ 500. The server failed; always a bug.
import type { CandidateDraft, PageDetector } from "./types";
import { pathPattern } from "./util";

export const http5xxDetector: PageDetector = {
  id: "DET-HTTP5XX",
  viewport: "desktop",
  async run({ capture }) {
    const seen = new Set<string>();
    const out: CandidateDraft[] = [];
    for (const e of capture.slice.network) {
      if (!e.sameOrigin || e.status === undefined || e.status < 500) continue;
      const pattern = pathPattern(e.path);
      const key = `${e.method} ${pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-HTTP5XX" },
        category: "crash",
        signature: { kind: "http", method: e.method, pathPattern: pattern, statusClass: "5xx" },
        groupKey: `http5xx|${key}`,
        signals: {
          request: { method: e.method, path: e.path, status: e.status, durationMs: e.durationMs },
        },
        detail: {
          title: `Server error (${e.status}) from ${e.method} ${e.path}`,
          impact:
            "The server failed while handling this request, so whatever depended on it didn't work.",
          expected: `${e.method} ${e.path} responds without a server error (status below 500).`,
          actual: `${e.method} ${e.path} returned HTTP ${e.status}.`,
          whyFlagged: "DET-HTTP5XX: a same-origin request returned a 5xx status (always a bug).",
        },
        summary: `${e.method} ${e.path} → ${e.status}`,
        evidenceIds: [capture.evidence.network],
      });
    }
    return out;
  },
};
