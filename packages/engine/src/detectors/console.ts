// DET-CONSOLE — console.error messages, grouped by normalised message.
import type { CandidateDraft, PageDetector } from "./types";
import { messagePrefix, truncate } from "./util";

/**
 * Chromium logs "Failed to load resource: …" for every failed or 4xx/5xx sub-resource. Those are already
 * covered (with better detail) by DET-HTTP5XX / DET-REQFAIL / DET-BROKENIMG / DET-HTTP4XX, and counting
 * them here would double-report every network failure and turn deliberate 4xx (a wrong-password login)
 * into console "bugs". This is a rule about browsers, not about any app.
 */
export function isNetworkEcho(text: string): boolean {
  return (
    /^Failed to load resource\b/.test(text) ||
    /^(GET|POST|PUT|PATCH|DELETE) https?:\/\/\S+ (net::|\d{3})/.test(text)
  );
}

export const consoleDetector: PageDetector = {
  id: "DET-CONSOLE",
  viewport: "desktop",
  async run({ capture }) {
    const pageErrorMessages = capture.slice.errors.map((e) => e.message).filter(Boolean);
    const seen = new Set<string>();
    const out: CandidateDraft[] = [];
    for (const entry of capture.slice.console) {
      if (entry.type !== "error") continue;
      if (isNetworkEcho(entry.text)) continue;
      // Frameworks often re-log an uncaught error to the console; DET-PAGEERROR already has it.
      if (pageErrorMessages.some((m) => entry.text.includes(m))) continue;
      const prefix = messagePrefix(entry.text);
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-CONSOLE" },
        category: "functional",
        signature: { kind: "detector", detectorId: "DET-CONSOLE", key: prefix },
        groupKey: `console|${prefix}`,
        severityHint: "low",
        signals: { errorMessage: entry.text },
        detail: {
          title: `The page logged an error: ${truncate(entry.text, 90)}`,
          impact:
            "The app reported a problem to the browser console; something may not be working as intended.",
          expected: "No errors are logged to the browser console.",
          actual: `console.error: ${truncate(entry.text, 200)}`,
          whyFlagged: "DET-CONSOLE: the page's own code logged an error.",
        },
        summary: "Console error",
        evidenceIds: [capture.evidence.console],
        ...(entry.afterBlocked ? { afterBlocked: entry.afterBlocked } : {}),
      });
    }
    return out;
  },
};
