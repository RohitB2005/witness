// UX reviewer (AI_AGENT_SPEC.md §3.7): one call over up to 6 key pages' snapshots, at most 5 suggestions.
// Each must point at a listed page and quote text that code finds on that page; the rest are dropped.
// Always tier "suggestion" (never a bug). Skipped on the Quick budget.
import { z } from "zod";
import { compactSnapshot } from "../explore/context";
import { newId } from "../ids";
import type { LlmGateway } from "../llm/gateway";
import { UX_INSTRUCTIONS } from "../llm/prompts/report";
import { pageContent } from "../llm/prompts/universal";
import { containsLoose } from "../oracle/parse";
import type { Candidate, PageState } from "../types";

const UxOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().min(3).max(100),
        rationale: z.string().min(3).max(400),
        route: z.string().min(1),
        elementDescription: z.string().min(1).max(160),
        quote: z.string().min(1).max(200),
        heuristic: z.string().min(2).max(80),
      }),
    )
    .max(5),
});

export interface UxPage {
  state: PageState;
  snapshot: string;
}

export async function uxReview(
  gateway: LlmGateway,
  pages: UxPage[],
): Promise<{ candidates: Candidate[]; proposed: number; dropped: number }> {
  const chosen = pages.slice(0, 6);
  if (!chosen.length) return { candidates: [], proposed: 0, dropped: 0 };
  const prompt = [
    `Pages: ${chosen.map((p) => p.state.routePattern).join(", ")}`,
    ...chosen.map(
      (p) =>
        `<page route="${p.state.routePattern}">\n${pageContent(compactSnapshot(p.snapshot, 5_000), p.state.url)}\n</page>`,
    ),
    "Give your suggestions.",
  ].join("\n");
  const res = await gateway.structured({
    role: "ux",
    tier: "smart",
    instructions: UX_INSTRUCTIONS,
    prompt,
    schema: UxOutputSchema,
    schemaName: "uxSuggestions",
    temperature: 0.2,
    timeoutMs: 45_000,
  });
  if (!res.ok) return { candidates: [], proposed: 0, dropped: 0 };
  const candidates: Candidate[] = [];
  let dropped = 0;
  for (const s of res.value.suggestions) {
    const page = chosen.find((p) => p.state.routePattern === s.route);
    // Code checks the reference: the quoted text must be on the page the suggestion names.
    if (!page || !containsLoose(page.snapshot, s.quote)) {
      dropped++;
      continue;
    }
    candidates.push({
      id: newId("cd"),
      kind: "improvement",
      source: { kind: "ux-review" },
      category: "ux",
      route: page.state.routePattern,
      url: page.state.url,
      stateId: page.state.id,
      session: page.state.session,
      viewport: "desktop",
      stepIds: [],
      evidenceIds: page.state.evidenceIds.slice(0, 2),
      signature: { kind: "judgement", expectationId: newId("ex") },
      groupKey: `ux|${page.state.routePattern}|${s.quote.toLowerCase().slice(0, 60)}`,
      severityHint: "low",
      signals: {},
      detail: {
        title: s.title,
        impact: s.rationale,
        expected: `${s.elementDescription} follows "${s.heuristic}".`,
        actual: `On ${page.state.routePattern}: "${s.quote}".`,
        whyFlagged: `UX review (an LLM), heuristic: ${s.heuristic}. The quoted text was found on the page by code.`,
      },
      summary: s.title,
    });
  }
  return { candidates, proposed: res.value.suggestions.length, dropped };
}
