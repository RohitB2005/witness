// Loads and validates bench/bugs.yaml (ground truth). Strict: an unknown rule field is an error, so a
// typo in the frozen file can never silently make a rule match everything.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUGS_YAML = path.join(REPO_ROOT, "bench", "bugs.yaml");

export const RuleSchema = z
  .object({
    source: z.string().optional(),
    source_kind: z.enum(["detector", "check", "judgement", "ux-review"]).optional(),
    category: z.string().optional(),
    route: z.string().optional(),
    request_path: z.string().optional(),
    method: z.string().optional(),
    status_gte: z.number().optional(),
    axe_rule: z.string().optional(),
    message: z.string().optional(),
    keywords_any: z.array(z.string()).optional(),
    keywords_all: z.array(z.string()).optional(),
    confirm: z.literal("manual").optional(),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

const MatchSchema = z.object({ any: z.array(RuleSchema).min(1) });

export const BugSchema = z
  .object({
    id: z.string().regex(/^B\d\d$/),
    title: z.string(),
    category: z.string(),
    severity_expected: z.string(),
    expected_tier: z.enum(["Confirmed", "Likely", "Needs review"]),
    detection_layer: z.string(),
    difficulty: z.string(),
    flag: z.string(),
    route: z.string(),
    match: MatchSchema,
  })
  .passthrough();
export type Bug = z.infer<typeof BugSchema>;

export const DecoySchema = z.object({
  id: z.string().regex(/^D\d\d$/),
  title: z.string(),
  route: z.string(),
  false_claim: z.string(),
  match: MatchSchema,
});
export type Decoy = z.infer<typeof DecoySchema>;

export const TruthSchema = z
  .object({
    version: z.literal(1),
    app: z.string(),
    bugs: z.array(BugSchema),
    decoys: z.array(DecoySchema),
  })
  .passthrough();
export type Truth = z.infer<typeof TruthSchema>;

export function loadTruth(file = BUGS_YAML): { truth: Truth; sha256: string } {
  const text = readFileSync(file, "utf8");
  return {
    truth: TruthSchema.parse(parse(text)),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}
