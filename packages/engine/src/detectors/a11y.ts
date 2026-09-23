// DET-A11Y — axe-core violations, one candidate per rule per distinct set of targets.
// Improvement (evidence-based): critical/serious → medium, moderate/minor → low (SPEC FR-4).
import AxeBuilder from "@axe-core/playwright";
import type { CandidateDraft, PageDetector } from "./types";
import { shortHash, truncate } from "./util";

const MAX_NODES = 10;

export function axeSeverity(impact: string | null | undefined): "medium" | "low" {
  return impact === "critical" || impact === "serious" ? "medium" : "low";
}

export const a11yDetector: PageDetector = {
  id: "DET-A11Y",
  viewport: "desktop",
  async run({ page, evidence, state }) {
    const results = await new AxeBuilder({ page }).analyze();
    const out: CandidateDraft[] = [];
    for (const v of results.violations) {
      const targets = v.nodes.map((n) => n.target.map(String).join(" "));
      const axeId = await evidence.put(
        "axe",
        {
          ruleId: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.slice(0, MAX_NODES).map((n) => ({
            target: n.target.map(String),
            html: truncate(n.html, 300),
            failureSummary: n.failureSummary,
          })),
          totalNodes: v.nodes.length,
        },
        { stateId: state.id },
      );
      const count = v.nodes.length;
      out.push({
        kind: "improvement",
        source: { kind: "detector", id: "DET-A11Y" },
        category: "accessibility",
        // Same rule on the same elements = same problem, even on another page (shared nav/footer).
        signature: {
          kind: "detector",
          detectorId: "DET-A11Y",
          key: `${v.id}|${targets.join(",")}`,
        },
        groupKey: `a11y|${v.id}|${shortHash(targets.sort().join(","))}`,
        severityHint: axeSeverity(v.impact),
        signals: { axeRuleId: v.id, axeImpact: v.impact ?? undefined },
        detail: {
          title: `Accessibility: ${v.help}`,
          impact: `${count} element${count === 1 ? "" : "s"} on this page ${count === 1 ? "is" : "are"} harder or impossible to use with a screen reader, keyboard or low vision.`,
          expected: `The page passes the axe-core rule "${v.id}" (${v.help}).`,
          actual: `${count} element${count === 1 ? " fails" : "s fail"} it, e.g. ${truncate(v.nodes[0]?.html ?? "", 120)}`,
          whyFlagged: `DET-A11Y: axe-core rule "${v.id}" (impact: ${v.impact ?? "unknown"}). More: ${v.helpUrl}`,
        },
        summary: `axe ${v.id} (${count})`,
        evidenceIds: [axeId],
      });
    }
    return out;
  },
};
