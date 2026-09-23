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
  standard: { pages: 40, journeys: 5, stepsPerJourney: 25, wallClockMs: 8 * 60_000, llmUsd: 2 },
  deep: { pages: 100, journeys: 8, stepsPerJourney: 35, wallClockMs: 15 * 60_000, llmUsd: 5 },
};

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
