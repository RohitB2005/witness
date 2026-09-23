// Core engine types (ARCHITECTURE.md §3). Every type that crosses a boundary (files on disk, API, LLM)
// is a zod schema; TS types are derived with z.infer.
import { z } from "zod";

export const ScanModeSchema = z.enum(["staging", "production"]);
export type ScanMode = z.infer<typeof ScanModeSchema>;

export const BudgetPresetSchema = z.enum(["quick", "standard", "deep"]);
export type BudgetPreset = z.infer<typeof BudgetPresetSchema>;

export const PipelineSchema = z.enum(["deterministic", "ai-no-verify", "full", "full-no-skeptic"]);
export type Pipeline = z.infer<typeof PipelineSchema>;

export const LlmCacheSchema = z.enum(["off", "rw", "replay"]);

const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// ---------------------------------------------------------------------------------------------
// Evidence

export const EvidenceKindSchema = z.enum([
  "screenshot",
  "aria_snapshot",
  "network",
  "console",
  "page_error",
  "timing",
  "axe",
  "check_result",
  "dom_probe",
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceSchema = z.object({
  id: z.string().regex(/^ev_/),
  kind: EvidenceKindSchema,
  stateId: z.string().optional(),
  stepId: z.string().optional(),
  createdAt: z.string(),
  path: z.string().optional(), // artifact file, relative to the run folder
  data: z.unknown(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------------------------------------------------------------------------------------------
// Page states

export const PageStateSchema = z.object({
  id: z.string().regex(/^st_/),
  url: z.string(),
  routePattern: z.string(),
  structureHash: z.string(),
  title: z.string(),
  status: z.number().int().optional(), // HTTP status of the document, when it was a navigation
  session: z.enum(["anonymous", "authenticated"]),
  evidenceIds: z.array(z.string()),
  discoveredBy: z.enum(["crawl", "agent"]),
});
export type PageState = z.infer<typeof PageStateSchema>;

// ---------------------------------------------------------------------------------------------
// Locators, actions, steps (recorded by the executor from P2; declared now so RunResult is complete)

type LocatorBase =
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "label"; text: string; exact?: boolean }
  | { by: "placeholder"; text: string }
  | { by: "testId"; id: string }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "css"; selector: string };
export type Locator = LocatorBase & { within?: Locator; nth?: number };

const locatorModifiers = {
  within: z.lazy((): z.ZodType<Locator> => LocatorSchema).optional(),
  nth: z.number().int().nonnegative().optional(),
};
export const LocatorSchema: z.ZodType<Locator> = z.union([
  z.object({
    by: z.literal("role"),
    role: z.string(),
    name: z.string().optional(),
    exact: z.boolean().optional(),
    ...locatorModifiers,
  }),
  z.object({
    by: z.literal("label"),
    text: z.string(),
    exact: z.boolean().optional(),
    ...locatorModifiers,
  }),
  z.object({ by: z.literal("placeholder"), text: z.string(), ...locatorModifiers }),
  z.object({ by: z.literal("testId"), id: z.string(), ...locatorModifiers }),
  z.object({
    by: z.literal("text"),
    text: z.string(),
    exact: z.boolean().optional(),
    ...locatorModifiers,
  }),
  z.object({ by: z.literal("css"), selector: z.string(), ...locatorModifiers }),
]);

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), path: z.string() }),
  z.object({ type: z.literal("click"), target: LocatorSchema }),
  z.object({ type: z.literal("fill"), target: LocatorSchema, value: z.string() }),
  z.object({ type: z.literal("select"), target: LocatorSchema, option: z.string() }),
  z.object({ type: z.literal("press"), key: z.string() }),
  z.object({ type: z.literal("reload") }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["down", "up"]) }),
  z.object({ type: z.literal("wait"), ms: z.number().int().nonnegative() }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const StepSchema = z.object({
  id: z.string().regex(/^sp_/),
  journeyId: z.string(),
  index: z.number().int().nonnegative(),
  kind: z.enum(["happy", "edge", "preamble"]),
  action: ActionSchema,
  description: z.string(),
  beforeEvidenceIds: z.array(z.string()),
  afterEvidenceIds: z.array(z.string()),
  urlBefore: z.string(),
  urlAfter: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

// ---------------------------------------------------------------------------------------------
// Journeys and expectations (produced by the Planner from P2). `check` is typed by the oracle in P2.

export const ExpectationSchema = z.object({
  id: z.string().regex(/^ex_/),
  journeyId: z.string(),
  statement: z.string(),
  check: z.unknown(),
  grounding: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ui_text"),
      quote: z.string(),
      verified: z.boolean(),
      evidenceId: z.string().optional(),
    }),
    z.object({ kind: z.literal("convention"), rationale: z.string() }),
  ]),
  impact: z.enum(["money", "data-loss", "blocks-completion", "wrong-info", "cosmetic"]),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

export const JourneyStatusSchema = z.enum([
  "proposed",
  "approved",
  "skipped",
  "running",
  "completed",
  "incomplete",
]);

export const JourneySchema = z.object({
  id: z.string().regex(/^jr_/),
  title: z.string(),
  goal: z.string(),
  priority: z.enum(["core", "secondary"]),
  startRoute: z.string(),
  suggestedSteps: z.array(z.string()),
  expectations: z.array(ExpectationSchema),
  status: JourneyStatusSchema,
  incompleteReason: z.string().optional(),
});
export type Journey = z.infer<typeof JourneySchema>;

// ---------------------------------------------------------------------------------------------
// Candidates and findings

export const FindingCategorySchema = z.enum([
  "functional",
  "crash",
  "validation",
  "state",
  "broken-resource",
  "accessibility",
  "performance",
  "security",
  "responsive",
  "ux",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const DetectorIdSchema = z.enum([
  "DET-PAGEERROR",
  "DET-CONSOLE",
  "DET-HTTP5XX",
  "DET-REQFAIL",
  "DET-HTTP4XX",
  "DET-BROKENLINK",
  "DET-BROKENIMG",
  "DET-A11Y",
  "DET-PERF",
  "DET-OVERFLOW",
  "DET-XSS",
  "DET-SECHEADERS",
]);
export type DetectorId = z.infer<typeof DetectorIdSchema>;

export const CandidateSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("detector"), id: DetectorIdSchema }),
  z.object({ kind: z.literal("check"), id: z.string(), expectationId: z.string() }),
  z.object({
    kind: z.literal("judgement"),
    expectationId: z.string().optional(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal("ux-review") }),
]);
export type CandidateSource = z.infer<typeof CandidateSourceSchema>;

export const SignatureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("check_failed"), expectationId: z.string() }),
  z.object({
    kind: z.literal("http"),
    method: z.string(),
    pathPattern: z.string(),
    statusClass: z.enum(["4xx", "5xx"]),
  }),
  z.object({ kind: z.literal("page_error"), messagePrefix: z.string() }),
  z.object({ kind: z.literal("detector"), detectorId: DetectorIdSchema, key: z.string() }),
  z.object({ kind: z.literal("judgement"), expectationId: z.string() }),
]);
export type Signature = z.infer<typeof SignatureSchema>;

/** Structured fields the eval scorer matches on (bugs.yaml: request_path, method, message, axe_rule). */
export const SignalsSchema = z.object({
  request: z
    .object({
      method: z.string(),
      path: z.string(),
      status: z.number().int(),
      durationMs: z.number().optional(),
    })
    .optional(),
  errorMessage: z.string().optional(),
  axeRuleId: z.string().optional(),
  axeImpact: z.string().optional(),
});
export type Signals = z.infer<typeof SignalsSchema>;

/**
 * Deterministic wording for a candidate. Detectors write it from recorded facts; the P3 writer may
 * rephrase it (fact-checked), and falls back to this template when the LLM stage is unavailable.
 */
export const CandidateDetailSchema = z.object({
  title: z.string(),
  impact: z.string(),
  expected: z.string(),
  actual: z.string(),
  whyFlagged: z.string(),
});
export type CandidateDetail = z.infer<typeof CandidateDetailSchema>;

export const CandidateSchema = z.object({
  id: z.string().regex(/^cd_/),
  kind: z.enum(["bug", "improvement"]),
  source: CandidateSourceSchema,
  category: FindingCategorySchema,
  route: z.string(),
  url: z.string(), // concrete URL where it was seen (repro starts here)
  stateId: z.string().optional(),
  session: z.enum(["anonymous", "authenticated"]),
  viewport: z.enum(["desktop", "mobile"]),
  journeyId: z.string().optional(),
  stepIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  signature: SignatureSchema,
  /** What makes two candidates "the same problem" when grouping (e.g. the same failing request on two pages). */
  groupKey: z.string(),
  /** Detector-supplied severity hint (e.g. axe impact); final severity is decided by report/severity.ts. */
  severityHint: z.enum(["critical", "high", "medium", "low"]).optional(),
  signals: SignalsSchema,
  detail: CandidateDetailSchema,
  summary: z.string(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const TierSchema = z.enum(["confirmed", "likely", "needs_review", "discarded"]);
export type Tier = z.infer<typeof TierSchema>;
export const ImprovementTierSchema = z.enum(["evidence_based", "suggestion"]);
export type ImprovementTier = z.infer<typeof ImprovementTierSchema>;
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  id: z.string().regex(/^fd_/),
  fingerprint: z.string(),
  kind: z.enum(["bug", "improvement"]),
  tier: z.union([TierSchema, ImprovementTierSchema]),
  tierReason: z.string(),
  severity: SeveritySchema,
  category: FindingCategorySchema,
  source: CandidateSourceSchema,
  route: z.string(),
  title: z.string(),
  impact: z.string(),
  whyFlagged: z.string(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  likelyCause: z.object({ text: z.string(), isHypothesis: z.literal(true) }).optional(),
  evidenceIds: z.array(z.string()),
  instances: z.array(
    z.object({ route: z.string(), url: z.string(), evidenceIds: z.array(z.string()) }),
  ),
  candidateIds: z.array(z.string()),
  replay: z.object({
    attempts: z.number().int(),
    reproduced: z.number().int(),
    notes: z.string().optional(),
  }),
  skeptic: z
    .object({ verdict: z.enum(["bug_likely", "unclear", "benign_likely"]), reason: z.string() })
    .optional(),
  signals: SignalsSchema,
  testFile: z.string().optional(),
  suppressed: z.object({ reason: z.string(), at: z.string() }).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------------------------------------------------------------------------------------------
// Scan config and run result

export const CredentialsSchema = z.object({
  username: z.string().min(1),
  passwordRef: z.string().min(1), // key in the in-memory SecretVault — never the password itself
});

export const ScanConfigSchema = z.object({
  url: z.string(),
  mode: ScanModeSchema,
  budget: BudgetPresetSchema,
  credentials: CredentialsSchema.optional(),
  hint: z.string().max(200).optional(),
  pipeline: PipelineSchema,
  llmCache: LlmCacheSchema,
  viewport: ViewportSchema,
  mobileViewport: ViewportSchema,
  approvedJourneyIds: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
});
export type ScanConfig = z.infer<typeof ScanConfigSchema>;

export const VerdictSchema = z.object({
  level: z.enum(["ready", "caveats", "not_ready"]),
  reason: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const RunResultSchema = z.object({
  runId: z.string(),
  config: ScanConfigSchema.omit({ credentials: true }).extend({
    loggedInAs: z.string().optional(),
  }),
  scope: z.string(), // the origin the scan was limited to
  startedAt: z.string(),
  finishedAt: z.string(),
  verdict: VerdictSchema,
  notTested: z.array(z.string()),
  findings: z.array(FindingSchema),
  journeys: z.array(JourneySchema),
  states: z.array(PageStateSchema),
  stats: z.object({
    pages: z.number().int(),
    steps: z.number().int(),
    llmCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    candidates: z.number().int(),
    discarded: z.number().int(),
    durationMs: z.number(),
    capsHit: z.array(z.string()),
  }),
  aiStagesSkipped: z.string().optional(),
  error: z.string().optional(), // set when the scan stopped early (e.g. preflight failed)
});
export type RunResult = z.infer<typeof RunResultSchema>;
