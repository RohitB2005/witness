// Severity rules (SPEC FR-9). Pure: deterministic rules over (possibly LLM-classified) inputs.
import type { CandidateSource, Expectation, Journey, Severity } from "../types";

export interface SeverityInput {
  kind: "bug" | "improvement";
  source: CandidateSource;
  /** Detector-supplied hint (axe impact mapping, DET-PERF/SECHEADERS "low"). */
  severityHint?: Severity;
  /** Priority of the journey the candidate arose in, if any. */
  journeyPriority?: Journey["priority"];
  /** For check failures: the expectation's impact tag. */
  checkImpact?: Expectation["impact"];
  /** The page the candidate is on belongs to a core journey (DET-OVERFLOW / DET-CONSOLE rule). */
  onCoreJourneyPage?: boolean;
}

const CRASH_DETECTORS = new Set(["DET-HTTP5XX", "DET-PAGEERROR"]);
/** Security detectors set severity from what they found (ADDENDUM A1, A3, A4): the hint, else high. */
const SECURITY_DETECTORS = new Set(["DET-SECRETS", "DET-DBERROR", "DET-AUTHZ"]);
const SEVERE_IMPACTS = new Set(["money", "data-loss", "blocks-completion"]);

export function severityFor(input: SeverityInput): Severity {
  const { source } = input;
  const core = input.journeyPriority === "core";

  if (source.kind === "detector") {
    if (CRASH_DETECTORS.has(source.id)) return core ? "critical" : "high";
    if (source.id === "DET-XSS") return "high";
    if (SECURITY_DETECTORS.has(source.id)) return input.severityHint ?? "high";
    // A wrong total is a money error (FR-9: critical in a core journey); a wrong sort order is wrong info.
    if (source.id === "DET-TOTALS") return core ? "critical" : "high";
    if (source.id === "DET-SORT") return core || input.onCoreJourneyPage ? "high" : "medium";
    if (source.id === "DET-OVERFLOW" || source.id === "DET-CONSOLE") {
      return core || input.onCoreJourneyPage ? "medium" : "low";
    }
    if (source.id === "DET-A11Y") return input.severityHint === "medium" ? "medium" : "low";
    // Broken links/images outside core flows, perf, security headers, request failures.
    return core ? "medium" : "low";
  }
  if (source.kind === "check") {
    if (core)
      return input.checkImpact && SEVERE_IMPACTS.has(input.checkImpact) ? "critical" : "high";
    return input.journeyPriority === "secondary" ? "medium" : "low";
  }
  if (source.kind === "judgement") return core ? "high" : "medium";
  // A promised feature that isn't in the app: the criterion's own weight (ADDENDUM A5).
  if (source.kind === "requirement") return input.severityHint ?? "high";
  return "low"; // ux-review suggestions
}

const ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return ORDER[a] <= ORDER[b] ? a : b;
}

export function compareSeverity(a: Severity, b: Severity): number {
  return ORDER[a] - ORDER[b];
}
