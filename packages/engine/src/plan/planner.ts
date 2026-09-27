// Planner (AI_AGENT_SPEC.md §3.1, SPEC FR-5): one structured call to the smart model, then deterministic
// validation. Code, not the model, decides what survives:
// - every check must parse in the check language (invalid expectations are dropped);
// - startRoute must exist in the map (or the journey is dropped);
// - every ui_text quote must literally appear (case/whitespace-insensitive) in a recorded snapshot, and
//   every requirement quote in the requirements text; otherwise it becomes "convention" (unverified);
// - journeys beyond the budget are dropped, core first;
// - with requirements (ADDENDUM A5): every acceptance criterion's quote must appear in the requirements text,
//   or the criterion is dropped; expectations and journeys may only link to criteria that survived.
import { z } from "zod";
import { newId } from "../ids";
import { toJsonSchema, type LlmGateway } from "../llm/gateway";
import { plannerInstructions, plannerPrompt } from "../llm/prompts/planner";
import { CheckSchema } from "../oracle/language";
import { containsLoose } from "../oracle/parse";
import {
  ExpectationCategorySchema,
  ExpectationImpactSchema,
  type Expectation,
  type Grounding,
  type Journey,
  type PageState,
  type RunResult,
} from "../types";
import { buildAppMapSummary, type MapPage } from "./summary";

const GroundingOut = z.object({
  kind: z.enum(["ui_text", "convention", "requirement"]),
  quote: z.string().max(300).optional(),
  rationale: z.string().max(400).optional(),
});

function journeySchema(check: z.ZodType) {
  return z.object({
    title: z.string().min(3).max(120),
    goal: z.string().min(3).max(400),
    priority: z.enum(["core", "secondary"]),
    startRoute: z.string().min(1).max(200),
    suggestedSteps: z.array(z.string().max(200)).min(1).max(10),
    expectations: z
      .array(
        z.object({
          statement: z.string().min(3).max(300),
          check,
          grounding: GroundingOut,
          impact: ExpectationImpactSchema,
          category: ExpectationCategorySchema.optional(),
          when: z.string().max(200).optional(),
          criterion: z.number().int().positive().optional(),
        }),
      )
      .max(6),
    criteria: z.array(z.number().int().positive()).max(15).optional(),
    edgeTargets: z
      .array(z.object({ formRoute: z.string(), formName: z.string() }))
      .max(4)
      .optional(),
  });
}
type PlannedJourney = z.infer<ReturnType<typeof journeySchema>>;

const AppModelOut = z.object({
  purpose: z.string().min(3).max(400),
  domain: z.string().min(2).max(100),
  entities: z.array(z.string().max(60)).max(12),
  notes: z.string().max(600).optional(),
});

/** An acceptance criterion as the Planner proposes it (only when requirements were given). */
const CriterionOut = z.object({
  number: z.number().int().positive(),
  text: z.string().min(3).max(300),
  quote: z.string().min(3).max(400),
  importance: z.enum(["core", "secondary"]),
  foundInApp: z.boolean(),
  lookFor: z.array(z.string().min(2).max(40)).max(5),
});
export type PlannedCriterion = z.infer<typeof CriterionOut>;

function planSchema(journey: z.ZodType, maxJourneys: number, withCriteria = false) {
  const base = z.object({
    appModel: AppModelOut,
    journeys: z.array(journey).min(1).max(Math.max(8, maxJourneys)),
    notes: z.string().max(800).optional(),
  });
  return withCriteria ? base.extend({ criteria: z.array(CriterionOut).max(15) }) : base;
}
/** A check may arrive as a JSON string (what the model is asked for) or as an object (tests, repairs). */
function parseJsonString(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

/** What validatePlan receives: journeys are checked one by one, so one bad journey doesn't sink the plan. */
type RawPlan = {
  appModel: z.infer<typeof AppModelOut>;
  journeys: unknown[];
  notes?: string;
  criteria?: PlannedCriterion[];
};

export interface PlanInput {
  pages: MapPage[];
  /** Evidence id of each state's snapshot, for grounding evidence. */
  snapshotEvidence: Map<string, string>;
  hint?: string;
  requirements?: string;
  detectorSummary: string;
  maxJourneys: number;
}

export interface PlanMetrics {
  journeysProposed: number;
  journeysKept: number;
  journeysInvalid: number;
  journeysDroppedRoute: number;
  journeysDroppedBudget: number;
  expectationsProposed: number;
  expectationsInvalidCheck: number;
  groundingUiText: number;
  groundingVerified: number;
  planRepaired: number;
  planPartial: number;
  criteriaProposed: number;
  criteriaDroppedQuote: number;
}

/** A criterion that survived validation (its quote is in the requirements). */
export interface ValidCriterion {
  id: string;
  text: string;
  quote: string;
  importance: "core" | "secondary";
  plannedNotFound: boolean;
  lookFor: string[];
}

export type PlanResult =
  | {
      ok: true;
      appModel: NonNullable<RunResult["appModel"]>;
      journeys: Journey[];
      criteria: ValidCriterion[];
      metrics: PlanMetrics;
      notes?: string;
    }
  | { ok: false; error: string; reason: string };

export async function planJourneys(gateway: LlmGateway, input: PlanInput): Promise<PlanResult> {
  const map = buildAppMapSummary(input.pages);
  const withCriteria = !!input.requirements?.trim();
  const res = await gateway.structured({
    role: "planner",
    tier: "smart",
    instructions: plannerInstructions(input.maxJourneys, withCriteria),
    prompt: plannerPrompt({
      map,
      hint: input.hint,
      detectorSummary: input.detectorSummary,
      requirements: input.requirements,
    }),
    schema: planSchema(
      journeySchema(z.preprocess(parseJsonString, CheckSchema)),
      input.maxJourneys,
      withCriteria,
    ) as z.ZodType<RawPlan>,
    fallbackSchema: planSchema(z.unknown(), input.maxJourneys, withCriteria) as z.ZodType<RawPlan>,
    // The model writes each check as a JSON string: an open object field in a structured-output schema
    // comes back empty (DEVLOG P2 problems), and the recursive check schema is too large to send.
    llmSchema: toJsonSchema(
      planSchema(
        journeySchema(
          z
            .string()
            .describe('The check as JSON in the check language, e.g. {"type":"visible",...}'),
        ),
        input.maxJourneys,
        withCriteria,
      ),
    ),
    schemaName: "plan",
    // A little hidden reasoning helps the plan; the default (several thousand tokens) took > 60 s.
    reasoning: "low",
    timeoutMs: 120_000,
  });
  if (!res.ok) return { ok: false, error: res.error, reason: res.reason };
  const out = validatePlan(res.value, input);
  out.metrics.planRepaired = res.repaired ? 1 : 0;
  out.metrics.planPartial = res.partial ? 1 : 0;
  return { ok: true, ...out };
}

/** Deterministic validation of the model's plan (exported for tests). */
export function validatePlan(
  plan: RawPlan,
  input: Pick<PlanInput, "pages" | "snapshotEvidence" | "requirements" | "maxJourneys">,
): {
  appModel: NonNullable<RunResult["appModel"]>;
  journeys: Journey[];
  criteria: ValidCriterion[];
  metrics: PlanMetrics;
  notes?: string;
} {
  const metrics: PlanMetrics = {
    journeysProposed: plan.journeys.length,
    journeysKept: 0,
    journeysInvalid: 0,
    journeysDroppedRoute: 0,
    journeysDroppedBudget: 0,
    expectationsProposed: 0,
    expectationsInvalidCheck: 0,
    groundingUiText: 0,
    groundingVerified: 0,
    planRepaired: 0,
    planPartial: 0,
    criteriaProposed: plan.criteria?.length ?? 0,
    criteriaDroppedQuote: 0,
  };
  // Acceptance criteria: code keeps only those whose quote is really in the requirements.
  const criteria: ValidCriterion[] = [];
  const criterionIds = new Map<number, string>();
  for (const c of plan.criteria ?? []) {
    const quote = c.quote.trim();
    if (
      !input.requirements ||
      !containsLoose(input.requirements, quote) ||
      criterionIds.has(c.number)
    ) {
      metrics.criteriaDroppedQuote++;
      continue;
    }
    const id = `AC${c.number}`;
    criterionIds.set(c.number, id);
    criteria.push({
      id,
      text: c.text.trim(),
      quote,
      importance: c.importance,
      plannedNotFound: !c.foundInApp,
      lookFor: c.lookFor.map((w) => w.trim()).filter(Boolean),
    });
  }
  const journeys: Journey[] = [];
  const looseJourney = journeySchema(z.unknown());
  for (const raw of plan.journeys) {
    const parsed = looseJourney.safeParse(raw);
    if (parsed.success) {
      for (const e of parsed.data.expectations) e.check = parseJsonString(e.check);
    }
    if (!parsed.success) {
      metrics.journeysInvalid++;
      continue;
    }
    const j: PlannedJourney = parsed.data;
    const startRoute = resolveStartRoute(
      j.startRoute,
      input.pages.map((p) => p.state),
    );
    if (!startRoute) {
      metrics.journeysDroppedRoute++;
      continue;
    }
    const id = newId("jr");
    const expectations: Expectation[] = [];
    for (const e of j.expectations) {
      metrics.expectationsProposed++;
      const check = CheckSchema.safeParse(e.check);
      if (!check.success) {
        metrics.expectationsInvalidCheck++;
        continue;
      }
      if (e.grounding.kind === "ui_text") metrics.groundingUiText++;
      const grounding = verifyGrounding(e.grounding, input);
      if (grounding.kind !== "convention" && grounding.verified) metrics.groundingVerified++;
      expectations.push({
        id: newId("ex"),
        journeyId: id,
        statement: e.statement,
        check: check.data,
        grounding,
        impact: e.impact,
        category: e.category,
        when: e.when,
        origin: "plan",
        ...(e.criterion !== undefined && criterionIds.has(e.criterion)
          ? { criterionId: criterionIds.get(e.criterion) }
          : {}),
      });
    }
    journeys.push({
      id,
      title: j.title,
      goal: j.goal,
      priority: j.priority,
      startRoute,
      suggestedSteps: j.suggestedSteps,
      expectations,
      status: "proposed",
      edgeTargets: j.edgeTargets ?? [],
      ...(criterionIds.size
        ? {
            criterionIds: [
              ...new Set(
                [
                  ...(j.criteria ?? []),
                  ...j.expectations.flatMap((e) => (e.criterion ? [e.criterion] : [])),
                ]
                  .filter((n) => criterionIds.has(n))
                  .map((n) => criterionIds.get(n)!),
              ),
            ],
          }
        : {}),
    });
  }
  // Budget: keep core journeys first (stable within each priority).
  const ranked = [
    ...journeys.filter((j) => j.priority === "core"),
    ...journeys.filter((j) => j.priority !== "core"),
  ];
  const kept = ranked.slice(0, input.maxJourneys);
  metrics.journeysDroppedBudget = ranked.length - kept.length;
  metrics.journeysKept = kept.length;
  return { appModel: plan.appModel, journeys: kept, criteria, metrics, notes: plan.notes };
}

/**
 * A usable start path for a proposed route: exact path or route-pattern match against the map (a
 * pattern like /orders/:id resolves to the first concrete page with that pattern). Undefined if unknown.
 */
export function resolveStartRoute(
  route: string,
  states: Pick<PageState, "url" | "routePattern">[],
): string | undefined {
  const wanted = route.trim();
  let path: string;
  try {
    const u = new URL(wanted, "http://x");
    path = `${u.pathname}${u.search}`;
  } catch {
    return undefined;
  }
  const bare = path.split("?")[0]!.replace(/\/+$/, "") || "/";
  const search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  for (const s of states) {
    const u = new URL(s.url);
    if (`${u.pathname}${u.search}` === path) return path;
    if ((u.pathname.replace(/\/+$/, "") || "/") === bare) return `${u.pathname}${search}`;
  }
  for (const s of states) {
    if (s.routePattern === wanted || s.routePattern.split("?")[0] === bare) {
      const u = new URL(s.url);
      return `${u.pathname}${u.search}`;
    }
  }
  return undefined;
}

export function verifyGrounding(
  g: z.infer<typeof GroundingOut>,
  input: Pick<PlanInput, "pages" | "snapshotEvidence" | "requirements">,
): Grounding {
  const quote = (g.quote ?? "").trim();
  if (g.kind === "ui_text") {
    const hit = quote ? input.pages.find((p) => containsLoose(p.snapshot, quote)) : undefined;
    if (hit)
      return {
        kind: "ui_text",
        quote,
        verified: true,
        evidenceId: input.snapshotEvidence.get(hit.state.id),
      };
    return {
      kind: "convention",
      rationale: `Quoted text not found on any recorded page: "${quote.slice(0, 120)}"`,
    };
  }
  if (g.kind === "requirement") {
    if (quote && input.requirements && containsLoose(input.requirements, quote)) {
      return { kind: "requirement", quote, verified: true };
    }
    return {
      kind: "convention",
      rationale: `Quoted requirement not found in the requirements text: "${quote.slice(0, 120)}"`,
    };
  }
  return {
    kind: "convention",
    rationale: (g.rationale ?? "").trim() || "Common expectation for this kind of app.",
  };
}
