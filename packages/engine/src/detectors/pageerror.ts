// DET-PAGEERROR — uncaught exceptions (`pageerror`). Always a bug: the page's own code crashed.
import type { CandidateDraft, PageDetector } from "./types";
import { messagePrefix, truncate } from "./util";

export const pageErrorDetector: PageDetector = {
  id: "DET-PAGEERROR",
  viewport: "desktop",
  async run({ capture }) {
    const seen = new Set<string>();
    const out: CandidateDraft[] = [];
    for (const err of capture.slice.errors) {
      const prefix = messagePrefix(err.text);
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-PAGEERROR" },
        category: "crash",
        signature: { kind: "page_error", messagePrefix: prefix },
        groupKey: `pageerror|${prefix}`,
        signals: { errorMessage: err.text },
        detail: {
          title: `The page's JavaScript crashed: ${truncate(err.text, 90)}`,
          impact: "Part of the page may stop working or show nothing when this error happens.",
          expected: "The page runs without uncaught JavaScript errors.",
          actual: `An uncaught error was thrown: ${truncate(err.text, 200)}`,
          whyFlagged: "DET-PAGEERROR: the browser reported an uncaught exception (always a bug).",
        },
        summary: `Uncaught ${err.name}`,
        evidenceIds: [capture.evidence.pageErrors],
        ...(err.afterBlocked ? { afterBlocked: err.afterBlocked } : {}),
      });
    }
    return out;
  },
};
