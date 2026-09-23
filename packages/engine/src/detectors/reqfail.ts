// DET-REQFAIL — a same-origin request that failed at the network level (connection refused, reset…),
// excluding requests Witness's own safety policy aborted and requests cancelled by a navigation.
import type { CandidateDraft, PageDetector } from "./types";
import { pathPattern } from "./util";

/** Failures that aren't the target's fault: the browser cancelled the request (e.g. the page navigated). */
export function isBenignFailure(errorText: string): boolean {
  return /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(errorText);
}

export const reqfailDetector: PageDetector = {
  id: "DET-REQFAIL",
  viewport: "desktop",
  async run({ capture }) {
    const seen = new Set<string>();
    const out: CandidateDraft[] = [];
    for (const e of capture.slice.network) {
      if (!e.sameOrigin || !e.failure || e.blockedByPolicy || isBenignFailure(e.failure)) continue;
      const pattern = pathPattern(e.path);
      const key = `${e.method} ${pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-REQFAIL" },
        category: "broken-resource",
        signature: { kind: "detector", detectorId: "DET-REQFAIL", key },
        groupKey: `reqfail|${key}`,
        signals: { request: { method: e.method, path: e.path, status: 0 } },
        detail: {
          title: `Request failed: ${e.method} ${e.path}`,
          impact: "The browser couldn't complete a request to the app's own server.",
          expected: `${e.method} ${e.path} completes.`,
          actual: `The request failed with ${e.failure}.`,
          whyFlagged: "DET-REQFAIL: a same-origin request failed at the network level.",
        },
        summary: `${e.method} ${e.path} failed (${e.failure})`,
        evidenceIds: [capture.evidence.network],
      });
    }
    return out;
  },
};
