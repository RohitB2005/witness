// Detector registry and runner. Page detectors run on every recorded state; site detectors
// (DET-BROKENLINK, DET-SECHEADERS) run once after the crawl. On agent steps, the log-based detectors run on
// every step and the full set only on states not seen before (runStepDetectors). DET-HTTP4XX needs step
// context (happy path only) and DET-XSS needs the edge runner's canary, so neither is in PAGE_DETECTORS.
import { newId } from "../ids";
import type { Candidate, PageState } from "../types";
import { a11yDetector } from "./a11y";
import { brokenImgDetector } from "./brokenimg";
import { consoleDetector } from "./console";
import { http4xxDetector } from "./http4xx";
import { http5xxDetector } from "./http5xx";
import { overflowDetector } from "./overflow";
import { pageErrorDetector } from "./pageerror";
import { perfDetector } from "./perf";
import { reqfailDetector } from "./reqfail";
import { totalsDetector } from "./totals";
import type { CandidateDraft, DetectorContext, PageDetector } from "./types";

export const PAGE_DETECTORS: readonly PageDetector[] = [
  pageErrorDetector,
  consoleDetector,
  http5xxDetector,
  reqfailDetector,
  brokenImgDetector,
  a11yDetector,
  perfDetector,
  totalsDetector,
  overflowDetector,
];

/** Detectors that only look at network/error logs — still meaningful on an error document (e.g. a 500). */
const LOG_ONLY = new Set(["DET-PAGEERROR", "DET-HTTP5XX", "DET-REQFAIL"]);

export interface RunDetectorsResult {
  candidates: Candidate[];
  errors: { detectorId: string; message: string }[];
}

/**
 * Runs page detectors on one state: desktop ones first, then narrows the viewport for mobile ones and
 * restores it. A detector that throws is recorded and skipped — it never fails the scan.
 */
export async function runPageDetectors(
  ctx: DetectorContext,
  opts: { desktopViewport: { width: number; height: number }; errorDocument: boolean },
): Promise<RunDetectorsResult> {
  const drafts: { draft: CandidateDraft; viewport: "desktop" | "mobile" }[] = [];
  const errors: RunDetectorsResult["errors"] = [];
  const active = PAGE_DETECTORS.filter((d) => !opts.errorDocument || LOG_ONLY.has(d.id));
  const run = async (d: PageDetector) => {
    try {
      for (const draft of await d.run(ctx)) drafts.push({ draft, viewport: d.viewport });
    } catch (err) {
      errors.push({ detectorId: d.id, message: err instanceof Error ? err.message : String(err) });
    }
  };
  for (const d of active.filter((d) => d.viewport === "desktop")) await run(d);
  const mobile = active.filter((d) => d.viewport === "mobile");
  if (mobile.length) {
    await ctx.page.setViewportSize(ctx.mobileViewport);
    await ctx.page.waitForTimeout(250); // let media queries and resize handlers settle
    for (const d of mobile) await run(d);
    await ctx.page.setViewportSize(opts.desktopViewport);
  }
  return {
    candidates: drafts.map(({ draft, viewport }) => toCandidate(draft, ctx.state, viewport)),
    errors,
  };
}

const STEP_LOG_DETECTORS: readonly PageDetector[] = [
  pageErrorDetector,
  consoleDetector,
  http5xxDetector,
  reqfailDetector,
];

/**
 * Detectors for one agent/edge step. Log-based detectors see only the step's own slice of network,
 * console and errors. `newState` adds the page detectors (axe, images, perf, overflow) the first time a
 * state is seen; `happy` adds DET-HTTP4XX.
 */
export async function runStepDetectors(
  ctx: DetectorContext,
  opts: {
    newState: boolean;
    happy: boolean;
    desktopViewport: { width: number; height: number };
  },
): Promise<RunDetectorsResult> {
  const detectors: PageDetector[] = opts.newState ? [...PAGE_DETECTORS] : [...STEP_LOG_DETECTORS];
  if (opts.happy) detectors.push(http4xxDetector);
  const drafts: { draft: CandidateDraft; viewport: "desktop" | "mobile" }[] = [];
  const errors: RunDetectorsResult["errors"] = [];
  for (const d of detectors.filter((d) => d.viewport === "desktop")) {
    try {
      for (const draft of await d.run(ctx)) drafts.push({ draft, viewport: "desktop" });
    } catch (err) {
      errors.push({ detectorId: d.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  const mobile = detectors.filter((d) => d.viewport === "mobile");
  if (mobile.length) {
    await ctx.page.setViewportSize(ctx.mobileViewport);
    await ctx.page.waitForTimeout(250);
    for (const d of mobile) {
      try {
        for (const draft of await d.run(ctx)) drafts.push({ draft, viewport: "mobile" });
      } catch (err) {
        errors.push({
          detectorId: d.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await ctx.page.setViewportSize(opts.desktopViewport);
  }
  return {
    candidates: drafts.map(({ draft, viewport }) => toCandidate(draft, ctx.state, viewport)),
    errors,
  };
}

/** Fills the fields every candidate from a page state shares. */
export function toCandidate(
  draft: CandidateDraft,
  state: Pick<PageState, "id" | "url" | "routePattern" | "session" | "evidenceIds">,
  viewport: "desktop" | "mobile" = "desktop",
): Candidate {
  const screenshot = state.evidenceIds[0];
  return {
    ...draft,
    id: newId("cd"),
    route: state.routePattern,
    url: state.url,
    stateId: state.id,
    session: state.session,
    viewport,
    stepIds: [],
    evidenceIds: [...new Set([...draft.evidenceIds, ...(screenshot ? [screenshot] : [])])],
  };
}
