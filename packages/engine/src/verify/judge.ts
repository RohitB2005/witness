// Judge (AI_AGENT_SPEC.md §3.4): one structured call per Explorer flag, used only because no deterministic
// check covers it. It sees recorded facts (steps, page text, errors), never the Explorer's reasoning, and
// can take a finding to Likely at most (verify/tier.ts).
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway";
import { pageContent } from "../llm/prompts/universal";
import { JUDGE_INSTRUCTIONS } from "../llm/prompts/verify";

export const JudgeOutputSchema = z.object({
  verdict: z.enum(["bug", "not_bug", "unclear"]),
  confidence: z.number().min(0).max(1),
  expected: z.string().min(1).max(400),
  actual: z.string().min(1).max(400),
  citedEvidenceIds: z.array(z.string()).max(12),
  notes: z.string().max(400).optional(),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface JudgeInput {
  claim: string;
  route: string;
  steps: string[];
  pageText: string[];
  previousPageText?: string[];
  errors: string[];
  evidenceIds: string[];
}

export function judgePrompt(i: JudgeInput): string {
  return [
    `<claim route="${i.route}">${i.claim}</claim>`,
    `<steps>\n${i.steps.map((s, n) => `${n + 1}. ${s}`).join("\n") || "(none)"}\n</steps>`,
    `<recorded_errors>\n${i.errors.join("\n") || "none"}\n</recorded_errors>`,
    `<evidence_ids>\n${i.evidenceIds.join("\n")}\n</evidence_ids>`,
    i.previousPageText?.length
      ? `Page before the last step:\n${pageContent(i.previousPageText.join("\n"))}`
      : "",
    `Page when the claim was made:\n${pageContent(i.pageText.join("\n"), i.route)}`,
    "Give your verdict.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function judge(
  gateway: LlmGateway,
  input: JudgeInput,
): Promise<{ ok: true; value: JudgeOutput } | { ok: false; error: string }> {
  const res = await gateway.structured({
    role: "judge",
    tier: "smart",
    instructions: JUDGE_INSTRUCTIONS,
    prompt: judgePrompt(input),
    schema: JudgeOutputSchema,
    schemaName: "judgement",
    timeoutMs: 45_000,
  });
  if (!res.ok) return { ok: false, error: res.error };
  // Code checks what the model cites: unknown evidence IDs are dropped, never trusted.
  const known = new Set(input.evidenceIds);
  return {
    ok: true,
    value: {
      ...res.value,
      citedEvidenceIds: res.value.citedEvidenceIds.filter((id) => known.has(id)),
    },
  };
}
