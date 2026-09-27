// Core engine types (ARCHITECTURE.md §3). Every type that crosses a boundary (files on disk, API, LLM)
// is a zod schema; TS types are derived with z.infer.
import { z } from "zod";
import { CheckSchema, LocatorSchema } from "./oracle/language";

export { LocatorSchema, CheckSchema } from "./oracle/language";
export type { Locator, Check, AgentCheck, NumExpr, TextExpr } from "./oracle/language";

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
  /**
   * The document had an error status but the app rendered a working page anyway (single-page apps on static
   * hosts often answer deep links with 404). Crawled and probed like a normal page (P3).
   */
  appRendered: z.boolean().optional(),
  session: z.enum(["anonymous", "authenticated"]),
  evidenceIds: z.array(z.string()),
  discoveredBy: z.enum(["crawl", "agent"]),
});
export type PageState = z.infer<typeof PageStateSchema>;

// ---------------------------------------------------------------------------------------------
// Actions and steps (recorded by the executor)

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), path: z.string() }),
  z.object({
    type: z.literal("click"),
    target: LocatorSchema,
    /** 2 = double-click (the edge runner's double-submit variant). */
    clickCount: z.number().int().min(1).max(2).optional(),
  }),
  z.object({ type: z.literal("fill"), target: LocatorSchema, value: z.string() }),
  z.object({ type: z.literal("select"), target: LocatorSchema, option: z.string() }),
  z.object({ type: z.literal("press"), key: z.string() }),
  z.object({ type: z.literal("reload") }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["down", "up"]) }),
  z.object({ type: z.literal("wait"), ms: z.number().int().nonnegative() }),
  /** Evaluate a check (assert or capture) at this point; replay re-evaluates it in the same place. */
  z.object({
    type: z.literal("check"),
    check: CheckSchema,
    expectationId: z.string().optional(),
  }),
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
  /** What the action touched, read from the DOM at record time (edge inputs need the field type). */
  target: z
    .object({
      role: z.string().optional(),
      name: z.string().optional(),
      tag: z.string().optional(),
      inputType: z.string().optional(),
      required: z.boolean().optional(),
      /** Identifies the enclosing form (same key → same form), when there is one. */
      formKey: z.string().optional(),
      isSubmit: z.boolean().optional(),
    })
    .optional(),
  /** The expectation this step asserted or captured, if any. */
  expectationId: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

// ---------------------------------------------------------------------------------------------
// Journeys and expectations (produced by the Planner; the Explorer and edge runner add their own)

export const GroundingSchema = z.discriminatedUnion("kind", [
  /** A literal quote from a recorded page; `verified` = code found it (case/whitespace-insensitive). */
  z.object({
    kind: z.literal("ui_text"),
    quote: z.string(),
    verified: z.boolean(),
    evidenceId: z.string().optional(),
  }),
  z.object({ kind: z.literal("convention"), rationale: z.string() }),
  /**
   * A quote from the user-supplied requirements text (ADDENDUM A5; P2 adds the hook only). Verified by
   * string match against that text; counts like ui_text for tiering.
   */
  z.object({ kind: z.literal("requirement"), quote: z.string(), verified: z.boolean() }),
]);
export type Grounding = z.infer<typeof GroundingSchema>;

export const ExpectationImpactSchema = z.enum([
  "money",
  "data-loss",
  "blocks-completion",
  "wrong-info",
  "cosmetic",
]);
/** Finding categories an expectation can fail as (a subset of FindingCategory). */
export const ExpectationCategorySchema = z.enum(["functional", "state", "validation", "ux"]);

export const ExpectationSchema = z.object({
  id: z.string().regex(/^ex_/),
  journeyId: z.string(),
  statement: z.string(),
  check: CheckSchema,
  grounding: GroundingSchema,
  impact: ExpectationImpactSchema,
  category: ExpectationCategorySchema.optional(),
  /** Plain-language moment to evaluate it, for the Explorer. */
  when: z.string().optional(),
  /** Who wrote it: the Planner, the Explorer mid-journey, the edge-input runner, or an automatic probe. */
  origin: z.enum(["plan", "agent", "edge", "probe"]).optional(),
  /** An input rule an AI proposed (edge-input generator) rather than Witness's fixed set (D46 cap). */
  aiGuessed: z.boolean().optional(),
  /** The acceptance criterion this expectation tests (ADDENDUM A5), e.g. "AC3". */
  criterionId: z.string().optional(),
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
  /** Forms the Planner wants edge inputs tried on. */
  edgeTargets: z.array(z.object({ formRoute: z.string(), formName: z.string() })).optional(),
  /** Steps the Explorer recorded (happy path first, then edge variants). */
  steps: z.array(StepSchema).optional(),
  /**
   * An automatic check Witness ran by itself (sort controls, the interaction sweep, reflected input, the
   * login-message comparison), not a user journey: it never counts as "a journey was exercised" (D16).
   */
  automatic: z.boolean().optional(),
  /** Acceptance criteria this journey covers (ADDENDUM A5). */
  criterionIds: z.array(z.string()).optional(),
});
export type Journey = z.infer<typeof JourneySchema>;

// ---------------------------------------------------------------------------------------------
// Acceptance criteria (ADDENDUM A5): the requirements split into numbered criteria by the Planner, each
// quote verified by code; status decided by code from what the run recorded.

export const CriterionStatusSchema = z.enum(["verified", "failed", "not_found", "not_tested"]);
export type CriterionStatus = z.infer<typeof CriterionStatusSchema>;

export const CriterionSchema = z.object({
  id: z.string().regex(/^AC\d+$/),
  /** The criterion in the Planner's words. */
  text: z.string(),
  /** The exact text from the requirements (verified by string match). */
  quote: z.string(),
  importance: z.enum(["core", "secondary"]),
  /** The Planner found nothing in the app for it; `lookFor` are the words code searched every page for. */
  plannedNotFound: z.boolean(),
  lookFor: z.array(z.string()),
  status: CriterionStatusSchema,
  /** One plain sentence: why this status. */
  reason: z.string(),
  expectationIds: z.array(z.string()),
  journeyIds: z.array(z.string()),
  findingIds: z.array(z.string()),
});
export type Criterion = z.infer<typeof CriterionSchema>;

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
  "DET-TOTALS",
  "DET-SORT",
  "DET-SECRETS",
  "DET-DBERROR",
  "DET-AUTHZ",
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
  /** An acceptance criterion from the requirements with nothing matching it in the app (ADDENDUM A5). */
  z.object({
    kind: z.literal("requirement"),
    id: z.literal("REQ-NOTFOUND"),
    criterionId: z.string(),
  }),
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
  z.object({ kind: z.literal("requirement"), criterionId: z.string() }),
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
  /**
   * A deterministic finding that still needs a person to decide (e.g. a key that is often meant to be
   * public): reported at Needs review at most, with this reason.
   */
  review: z.string().optional(),
  /** Detector-supplied severity hint (e.g. axe impact); final severity is decided by report/severity.ts. */
  severityHint: z.enum(["critical", "high", "medium", "low"]).optional(),
  signals: SignalsSchema,
  detail: CandidateDetailSchema,
  summary: z.string(),
  /**
   * The deterministic check whose failure this candidate is: a failed expectation's check, or the check a
   * detector's finding is equivalent to (DET-TOTALS, DET-SORT, DET-XSS). Replay re-evaluates it at the end of
   * the steps; the test exporter asserts it (P3).
   */
  check: CheckSchema.optional(),
  /** For a `fieldRejected` check: the form's success signature when it ran (replay passes it again). */
  successCheck: CheckSchema.optional(),
  /** Grounding facts for tiering, copied from the expectation (or a detector's on-screen labels). */
  grounding: z
    .object({
      kind: z.enum(["ui_text", "requirement", "convention"]),
      verified: z.boolean(),
      quote: z.string().optional(),
      /** The check only asserts that its own grounding quote is visible (can't ground itself, P3). */
      selfReferential: z.boolean().optional(),
      /** An AI-guessed input rule not stated on the page (capped at Needs review, D46). */
      aiGuessedRule: z.boolean().optional(),
    })
    .optional(),
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
  judge: z
    .object({
      verdict: z.enum(["bug", "not_bug", "unclear"]),
      confidence: z.number().min(0).max(1),
      notes: z.string().optional(),
    })
    .optional(),
  signals: SignalsSchema,
  testFile: z.string().optional(),
  suppressed: z.object({ reason: z.string(), at: z.string() }).optional(),
  /**
   * The tier this finding would have had at earlier pipeline stages, so ablations A1 (no verification) and
   * A3 (no skeptic) can be scored from the same run (DEVLOG D51).
   */
  stageTiers: z
    .object({
      aiNoVerify: z.union([TierSchema, ImprovementTierSchema]),
      noSkeptic: z.union([TierSchema, ImprovementTierSchema]),
    })
    .optional(),
  /** How to reproduce it without the LLM: the representative candidate's replay facts (exporter input). */
  repro: z
    .object({
      session: z.enum(["anonymous", "authenticated"]),
      viewport: z.enum(["desktop", "mobile"]),
      url: z.string(),
      journeyId: z.string().optional(),
      stepIds: z.array(z.string()),
      signature: SignatureSchema,
      check: CheckSchema.optional(),
      successCheck: CheckSchema.optional(),
    })
    .optional(),
  /** Set when the writer's wording replaced the deterministic template (fact-checked). */
  wording: z.enum(["template", "writer"]).optional(),
  /**
   * The deterministic wording (D22), kept when the writer rephrased the finding. The eval scorer matches on
   * this, so scores don't depend on the writer's word choice (DEVLOG D53).
   */
  template: z
    .object({ title: z.string(), impact: z.string(), expected: z.string(), actual: z.string() })
    .optional(),
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
  /** Acceptance criteria / agreed scope, pasted or uploaded (ADDENDUM A5 hook; used by the Planner). */
  requirements: z.string().max(5000).optional(),
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
  /** What the AI stages did, for the reliability measures in AI_AGENT_SPEC.md §8 (counts and ratios). */
  aiMetrics: z.record(z.string(), z.number()).optional(),
  /** Path of the login page found in preflight (exported tests log in there). */
  loginPath: z.string().optional(),
  /** Short plain-language notes for the report (e.g. page text aimed at AI tools that was ignored, D44). */
  notes: z.array(z.string()).optional(),
  /** Requirements coverage (ADDENDUM A5): present when the scan was given requirements. */
  requirements: z
    .object({
      criteria: z.array(CriterionSchema),
      /** Criteria the Planner proposed whose quote wasn't in the requirements (dropped). */
      droppedCriteria: z.number().int(),
    })
    .optional(),
  /** The Planner's reading of the app (purpose, domain), shown in the report. */
  appModel: z
    .object({
      purpose: z.string(),
      domain: z.string(),
      entities: z.array(z.string()),
      notes: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(), // set when the scan stopped early (e.g. preflight failed)
});
export type RunResult = z.infer<typeof RunResultSchema>;
