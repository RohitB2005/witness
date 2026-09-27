// DET-BROKENLINK — a same-origin link, found while crawling, whose target returned 404/410/5xx.
// Pure function over the crawl's link graph: runs once per scan, after the crawl.
import type { CandidateDraft } from "./types";

export interface LinkTarget {
  url: string;
  path: string;
  status: number;
  evidenceId: string;
  /** Pages that link to it, with the visible link text. */
  sources: { url: string; routePattern: string; linkText: string }[];
}

export function isBrokenStatus(status: number): boolean {
  return status === 404 || status === 410 || status >= 500;
}

export function brokenLinkCandidate(target: LinkTarget): CandidateDraft {
  const first = target.sources[0];
  const text = first?.linkText ? `"${first.linkText}" ` : "";
  const where = target.sources.length === 1 ? "1 page" : `${target.sources.length} pages`;
  return {
    kind: "bug",
    source: { kind: "detector", id: "DET-BROKENLINK" },
    category: "broken-resource",
    signature: { kind: "detector", detectorId: "DET-BROKENLINK", key: target.path },
    groupKey: `brokenlink|${target.path}`,
    signals: { request: { method: "GET", path: target.path, status: target.status } },
    detail: {
      title: `Link ${text}goes to a missing page (${target.path} → ${target.status})`,
      impact:
        "Visitors who click this link land on an error page instead of the content they wanted.",
      expected: `The link to ${target.path} opens a working page.`,
      actual: `${target.path} returned HTTP ${target.status}. Linked from ${where}.`,
      whyFlagged: "DET-BROKENLINK: a same-origin link returned 404/410/5xx (always a bug).",
    },
    summary: `Broken link ${target.path} (${target.status})`,
    evidenceIds: target.evidenceId ? [target.evidenceId] : [],
    // Replays and exported tests follow the link as it is on the page, so a fixed link passes.
    ...(first?.linkText
      ? {
          check: {
            type: "linkWorks" as const,
            link: { by: "role" as const, role: "link", name: first.linkText, exact: true },
          },
        }
      : {}),
  };
}
