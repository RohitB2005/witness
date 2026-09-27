// Skeptic (AI_AGENT_SPEC.md §3.5): after a failure reproduces, one call argues the strongest innocent
// explanation. It can only downgrade (benign_likely → Needs review) and never sees the Explorer's reasoning.
// Skipped for universal oracles (crashes, broken links/images, axe…): there's nothing to argue.
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway";
import { pageContent } from "../llm/prompts/universal";
import { SKEPTIC_INSTRUCTIONS } from "../llm/prompts/verify";
import type { Candidate } from "../types";

export const SkepticOutputSchema = z.object({
  verdict: z.enum(["bug_likely", "unclear", "benign_likely"]),
  strongestBenignExplanation: z.string().min(1).max(600),
  reason: z.string().min(1).max(400),
});
export type SkepticOutput = z.infer<typeof SkepticOutputSchema>;

export interface SkepticInput {
  statement: string;
  grounding: string;
  check?: string;
  actual: string;
  route: string;
  steps: string[];
  pageText: string[];
  replay: string;
}

/** Detector findings the skeptic may argue about (arithmetic over on-screen amounts can miss a line). */
const ARGUABLE_DETECTORS = new Set(["DET-TOTALS"]);

export function skepticApplies(c: Pick<Candidate, "kind" | "source">): boolean {
  if (c.kind !== "bug") return false;
  if (c.source.kind === "check" || c.source.kind === "judgement") return true;
  return c.source.kind === "detector" && ARGUABLE_DETECTORS.has(c.source.id);
}

export function skepticPrompt(i: SkepticInput): string {
  return [
    `<expectation>${i.statement}</expectation>`,
    `<grounding>${i.grounding}</grounding>`,
    i.check ? `<check>${i.check}</check>` : "",
    `<result>${i.actual}</result>`,
    `<replay>${i.replay}</replay>`,
    `<steps>\n${i.steps.map((s, n) => `${n + 1}. ${s}`).join("\n") || "(none)"}\n</steps>`,
    `Page when the check failed:\n${pageContent(i.pageText.join("\n"), i.route)}`,
    "Argue the innocent case, then give your verdict.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function skeptic(
  gateway: LlmGateway,
  input: SkepticInput,
  deadline?: number,
): Promise<{ ok: true; value: SkepticOutput } | { ok: false; error: string }> {
  const res = await gateway.structured({
    role: "skeptic",
    tier: "smart",
    instructions: SKEPTIC_INSTRUCTIONS,
    prompt: skepticPrompt(input),
    schema: SkepticOutputSchema,
    schemaName: "skepticVerdict",
    timeoutMs: 45_000,
    deadline,
  });
  return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.error };
}
