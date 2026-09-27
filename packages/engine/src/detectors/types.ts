// Detector interface. A detector turns recorded facts about one page state into candidate drafts.
// It never decides tier or final severity — that's report/ (and verify/ from P3).
import type { Page } from "playwright";
import type { EvidenceWriter, StateCapture } from "../record/evidence";
import type { Candidate, DetectorId, PageState } from "../types";

export type CandidateDraft = Pick<
  Candidate,
  | "kind"
  | "category"
  | "signature"
  | "groupKey"
  | "severityHint"
  | "signals"
  | "detail"
  | "summary"
  | "evidenceIds"
> &
  Partial<Pick<Candidate, "check" | "grounding" | "review">> & {
    source: { kind: "detector"; id: DetectorId };
  };

export interface DetectorContext {
  page: Page;
  state: PageState;
  capture: StateCapture;
  origin: string;
  evidence: EvidenceWriter;
  mobileViewport: { width: number; height: number };
}

export interface PageDetector {
  id: DetectorId;
  /** "desktop" runs on the page as loaded; "mobile" runs after the viewport is narrowed to phone width. */
  viewport: "desktop" | "mobile";
  run(ctx: DetectorContext): Promise<CandidateDraft[]>;
}
