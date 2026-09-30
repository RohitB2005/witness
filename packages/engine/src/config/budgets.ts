// Budget presets (SPEC.md FR-14). These are caps, not estimates.
import type { BudgetPreset } from "../types";

export interface Budget {
  pages: number;
  journeys: number;
  stepsPerJourney: number;
  wallClockMs: number;
  llmUsd: number;
}

export const BUDGETS: Record<BudgetPreset, Budget> = {
  quick: { pages: 15, journeys: 2, stepsPerJourney: 15, wallClockMs: 3 * 60_000, llmUsd: 0.5 },
  // For the live demo (P5, being timed): Standard's depth on the core journeys only, hard-capped at 5 minutes.
  demo: { pages: 40, journeys: 2, stepsPerJourney: 25, wallClockMs: 5 * 60_000, llmUsd: 1.5 },
  // 3 journeys (was 5): with replay, a Standard run must still fit 8 minutes (DEVLOG D50, measured in P3).
  standard: { pages: 40, journeys: 3, stepsPerJourney: 25, wallClockMs: 8 * 60_000, llmUsd: 2 },
  deep: { pages: 100, journeys: 8, stepsPerJourney: 35, wallClockMs: 15 * 60_000, llmUsd: 5 },
};

/**
 * How a run's wall-clock budget is shared (D38, revised in P3 for verification). Exploring stops starting
 * journeys at `exploreEnd`, edge inputs stop at `edgeEnd`, replays and the judge/skeptic stop at
 * `wall − reportReserveMs`, and the report (writer, UX review) gets the rest. The cap is hard (D78): every
 * AI call and replay is cut off at its deadline, and the last `finalizeMs` is kept for building and saving
 * the result, so a run never finishes after `wall`.
 */
export const TIME_SPLIT = {
  exploreEnd: 0.5,
  edgeEnd: 0.64,
  reportReserveMs: 25_000,
  finalizeMs: 4_000,
} as const;

/** How long the plan waits for review before it is approved automatically (live view). */
export const PLAN_AUTO_APPROVE_MS = 10_000;

/** Per-action and per-page time limits (SECURITY.md T9). */
export const LIMITS = {
  actionTimeoutMs: 10_000,
  navigationTimeoutMs: 15_000,
  /** Network-quiet wait after a crawl navigation: long enough to observe slow APIs (DET-PERF threshold is 2 s). */
  crawlQuietCapMs: 6_000,
  quietWindowMs: 500,
  /** Minimum gap between actions/navigations against the target (T10). */
  minActionGapMs: 300,
} as const;
