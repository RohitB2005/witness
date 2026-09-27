// Readiness verdict (SPEC FR-9). Pure function; always returns a one-sentence reason.
import type { Criterion, Finding, Journey, Verdict } from "../types";

export interface VerdictInput {
  findings: Pick<Finding, "kind" | "tier" | "severity" | "title">[];
  journeys: Pick<Journey, "priority" | "status" | "title">[];
  /**
   * False when no user journey was exercised at all (deterministic pipeline, or AI stages skipped).
   * Witness then can't claim "Ready": it only checked page loads (DEVLOG D16).
   */
  journeysAttempted: boolean;
  /**
   * Requirements coverage (ADDENDUM A5). Failed and not-found criteria are already bug findings (so they
   * count above); untested ones are a caveat.
   */
  criteria?: Pick<Criterion, "status">[];
}

const ACTIVE_BUG_TIERS = new Set(["confirmed", "likely"]);

export function readinessVerdict(input: VerdictInput): Verdict {
  const bugs = input.findings.filter((f) => f.kind === "bug" && ACTIVE_BUG_TIERS.has(f.tier));
  const serious = bugs.filter((f) => f.severity === "critical" || f.severity === "high");
  if (serious.length > 0) {
    const worst = serious.find((f) => f.severity === "critical") ?? serious[0]!;
    const more =
      serious.length > 1
        ? ` and ${serious.length - 1} other serious problem${serious.length > 2 ? "s" : ""}`
        : "";
    return {
      level: "not_ready",
      reason: `Not ready: ${worst.severity} bug "${worst.title}"${more}.`,
    };
  }
  const needsReview = input.findings.filter((f) => f.kind === "bug" && f.tier === "needs_review");
  const unfinishedCore = input.journeys.filter(
    (j) => j.priority === "core" && j.status !== "completed" && j.status !== "skipped",
  );
  const caveats: string[] = [];
  if (bugs.length) caveats.push(`${bugs.length} medium/low bug${bugs.length === 1 ? "" : "s"}`);
  if (needsReview.length)
    caveats.push(`${needsReview.length} item${needsReview.length === 1 ? "" : "s"} needing review`);
  if (unfinishedCore.length) {
    caveats.push(
      `${unfinishedCore.length} core journey${unfinishedCore.length === 1 ? "" : "s"} not completed`,
    );
  }
  if (!input.journeysAttempted) caveats.push("no user journeys were exercised (page loads only)");
  const untested = input.criteria?.filter((c) => c.status === "not_tested").length ?? 0;
  if (untested)
    caveats.push(`${untested} acceptance criteri${untested === 1 ? "on" : "a"} not tested`);
  if (caveats.length) {
    return { level: "caveats", reason: `Ready with caveats: ${joinList(caveats)}.` };
  }
  return {
    level: "ready",
    reason: "Ready: no confirmed or likely bugs, and every core journey completed.",
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
