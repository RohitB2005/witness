// Explorer tools (AI_AGENT_SPEC.md §4). Each tool has a strict zod schema (the contract the gateway
// validates and repairs against) and, where a field is a check, a loose shape shown to the model (the check
// language is described once in the system prompt instead of as a large recursive JSON Schema).
import { z } from "zod";
import { toJsonSchema, type ToolSpec } from "../llm/gateway";
import { AgentCheckSchema, type AgentCheck } from "../oracle/language";
import {
  ExpectationCategorySchema,
  ExpectationImpactSchema,
  FindingCategorySchema,
} from "../types";

const Ref = z.string().regex(/^[a-z0-9]+$/i, 'a ref from the snapshot, like "e14"');
/** Free text is trimmed, not rejected: a long note isn't worth a repair call. */
const clipped = (max: number) =>
  z.string().transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));
const Why = clipped(400).describe("One short sentence: why this action, for the log.");

const AgentGroundingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ui_text"), quote: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("convention"), rationale: z.string().min(1).max(300) }),
]);

const AssertSchema = z
  .object({
    expectationId: z.string().optional(),
    check: AgentCheckSchema.optional(),
    statement: z.string().min(3).pipe(clipped(300)).optional(),
    grounding: AgentGroundingSchema.optional(),
    impact: ExpectationImpactSchema.optional(),
    category: ExpectationCategorySchema.optional(),
  })
  .refine((a) => a.expectationId || (a.statement && a.check && a.grounding && a.impact), {
    message:
      "give an expectationId, or a new expectation with statement, check, grounding and impact",
  });
export type AssertInput = z.infer<typeof AssertSchema>;

const CaptureSchema = z
  .object({ name: z.string().min(1).max(60), value: z.unknown() })
  .transform((c, ctx) => {
    const parsed = AgentCheckSchema.safeParse({ type: "capture", name: c.name, value: c.value });
    if (!parsed.success || parsed.data.type !== "capture") {
      ctx.addIssue({
        code: "custom",
        message: 'value must be a NumExpr or TextExpr (e.g. { "text": { "ref": "e14" } })',
      });
      return z.NEVER;
    }
    return parsed.data;
  });
export type CaptureInput = Extract<AgentCheck, { type: "capture" }>;

const looseCheck = z
  .object({})
  .passthrough()
  .describe('A Check in the check language (see instructions). Use { "ref": "e14" } for elements.');

function spec(description: string, schema: z.ZodType, llm?: z.ZodType): ToolSpec {
  return { description, schema, llmSchema: toJsonSchema(llm ?? schema) };
}

export const EXPLORER_TOOLS: Record<string, ToolSpec> = {
  click: spec(
    "Click an element, named by its ref in the latest snapshot.",
    z.object({ ref: Ref, why: Why }),
  ),
  fill: spec(
    "Replace the contents of a text field. For login details type {{secret:username}} or {{secret:password}}.",
    z.object({ ref: Ref, value: z.string().max(2000), why: Why }),
  ),
  select: spec(
    "Choose an option in a dropdown (by its visible label).",
    z.object({ ref: Ref, option: z.string().min(1).max(200), why: Why }),
  ),
  press: spec(
    "Press a key.",
    z.object({ key: z.enum(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown"]) }),
  ),
  goto: spec(
    "Open a path on this site, e.g. /account.",
    z.object({ path: z.string().min(1).max(300) }),
  ),
  reload: spec("Reload the page (for persistence checks).", z.object({})),
  scroll: spec("Scroll the page.", z.object({ direction: z.enum(["down", "up"]) })),
  wait: spec(
    "Wait for the page (at most 3000 ms).",
    z.object({ ms: z.number().int().min(0).max(3000) }),
  ),
  assert: spec(
    "Evaluate an expectation now. Either { expectationId } for a planned one (optionally with your own check using refs), or a new one: { statement, check, grounding, impact, category }.",
    AssertSchema,
    z.object({
      expectationId: z.string().optional(),
      check: looseCheck.optional(),
      statement: z.string().optional(),
      grounding: z
        .object({
          kind: z.enum(["ui_text", "convention"]),
          quote: z.string().optional(),
          rationale: z.string().optional(),
        })
        .optional(),
      impact: ExpectationImpactSchema.optional(),
      category: ExpectationCategorySchema.optional(),
    }),
  ),
  capture: spec(
    "Remember a value (a NumExpr or TextExpr) under a name, to compare later with equalsCaptured.",
    CaptureSchema,
    z.object({
      name: z.string(),
      value: z
        .object({})
        .passthrough()
        .describe('e.g. { "text": { "ref": "e14" } } or { "read": { "ref": "e20" } }'),
    }),
  ),
  flag_candidate: spec(
    "Report something that looks broken which no check covers. Cite evidence IDs from <evidence_ids>.",
    z.object({
      summary: z.string().min(5).pipe(clipped(300)),
      category: FindingCategorySchema,
      evidenceIds: z.array(z.string().regex(/^ev_/)).min(1).max(6),
    }),
  ),
  finish: spec(
    "End this journey.",
    z.object({ outcome: z.enum(["completed", "blocked", "gave_up"]), note: clipped(500) }),
  ),
};

export const ToolInputs = {
  click: z.object({ ref: Ref, why: Why }),
  fill: z.object({ ref: Ref, value: z.string(), why: Why }),
  select: z.object({ ref: Ref, option: z.string(), why: Why }),
  press: z.object({ key: z.enum(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown"]) }),
  goto: z.object({ path: z.string() }),
  scroll: z.object({ direction: z.enum(["down", "up"]) }),
  wait: z.object({ ms: z.number() }),
  flag: z.object({
    summary: z.string(),
    category: FindingCategorySchema,
    evidenceIds: z.array(z.string()),
  }),
  finish: z.object({ outcome: z.enum(["completed", "blocked", "gave_up"]), note: z.string() }),
};
export { AssertSchema };
