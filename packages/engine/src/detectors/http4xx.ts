// DET-HTTP4XX — a same-origin fetch/XHR answered 4xx during a *happy-path* step (SPEC FR-4). It needs step
// context: during edge inputs a 4xx is often the correct answer (validation), so the executor only runs this
// on happy steps. A 4xx doesn't prove a bug on its own, so these cap at Likely.
import type { CandidateDraft, PageDetector } from "./types";
import { pathPattern } from "./util";

export const http4xxDetector: PageDetector = {
  id: "DET-HTTP4XX",
  viewport: "desktop",
  async run({ capture }) {
    const seen = new Set<string>();
    const out: CandidateDraft[] = [];
    for (const e of capture.slice.network) {
      if (!e.sameOrigin || e.status === undefined || e.status < 400 || e.status >= 500) continue;
      if (e.resourceType !== "fetch" && e.resourceType !== "xhr") continue;
      const pattern = pathPattern(e.path);
      const key = `${e.method} ${pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-HTTP4XX" },
        category: "functional",
        signature: { kind: "http", method: e.method, pathPattern: pattern, statusClass: "4xx" },
        groupKey: `http4xx|${key}|${e.status}`,
        signals: {
          request: { method: e.method, path: e.path, status: e.status, durationMs: e.durationMs },
        },
        detail: {
          title: `Request refused (${e.status}) during a normal step: ${e.method} ${e.path}`,
          impact:
            "A normal action made the app ask its server for something, and the server refused.",
          expected: `${e.method} ${e.path} succeeds during an ordinary user action.`,
          actual: `${e.method} ${e.path} returned HTTP ${e.status}.`,
          whyFlagged:
            "DET-HTTP4XX: a same-origin API request returned a 4xx status during a happy-path step (capped at Likely: a 4xx can be intended).",
        },
        summary: `${e.method} ${e.path} → ${e.status}`,
        evidenceIds: [capture.evidence.network],
      });
    }
    return out;
  },
};
