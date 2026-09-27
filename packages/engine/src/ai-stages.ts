// The AI stages of a scan: plan → explore (one journey at a time) → edge inputs. Called by runScan after
// the crawl. Any failure here degrades: the scan still reports its deterministic findings and says which
// AI stage was skipped and why (NFR-3).
import type { Browser } from "playwright";
import { TIME_SPLIT, type Budget } from "./config/budgets";
import type { SafetyPolicy } from "./browser/policy";
import type { SecretVault } from "./browser/vault";
import type { CrawlResult } from "./crawl/crawler";
import { log, type EventSink } from "./events";
import { runEdgeInputs, type EdgeMetrics } from "./explore/edge";
import { exploreJourney, type ExplorerMetrics, type JourneyRun } from "./explore/explorer";
import type { StateRegistry } from "./explore/states";
import { LlmCache } from "./llm/cache";
import { LlmGateway } from "./llm/gateway";
import type { Models } from "./llm/settings";
import { planJourneys, type PlanMetrics, type ValidCriterion } from "./plan/planner";
import { buildAppMapSummary } from "./plan/summary";
import type { PreflightSuccess } from "./preflight/preflight";
import type { EvidenceWriter } from "./record/evidence";
import type { RunStore } from "./store/run-store";
import type { Candidate, Journey, PageState, RunResult, ScanConfig } from "./types";

export interface AiStagesInput {
  config: ScanConfig;
  budget: Budget;
  started: number;
  runId: string;
  browser: Browser;
  policy: SafetyPolicy;
  evidence: EvidenceWriter;
  store: RunStore;
  vault: SecretVault;
  sink: EventSink;
  pre: PreflightSuccess;
  crawled: CrawlResult;
  /** Page states seen so far (shared with the automatic probes that run alongside). */
  states: StateRegistry;
  crawlCandidates: Candidate[];
  models: Models;
  cacheDir: string;
  /** min(budget preset cap, WITNESS_MAX_COST_USD). */
  costCapUsd: number;
}

export interface AiStagesOutput {
  journeys: Journey[];
  candidates: Candidate[];
  addedStates: PageState[];
  appModel?: RunResult["appModel"];
  /** Acceptance criteria the Planner split the requirements into (quotes verified), when given. */
  criteria?: ValidCriterion[];
  aiStagesSkipped?: string;
  capsHit: string[];
  metrics: Record<string, number>;
  llm: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  steps: number;
  /** The run's gateway: verification and the report make their LLM calls through the same one. */
  gateway: LlmGateway;
  /** The state registry (crawl + agent states), for verification. */
  states: StateRegistry;
  /** Resolves when every LLM call so far is written to llm-calls.ndjson (NFR-6). */
  flushLogs: () => Promise<void>;
}

export async function runAiStages(i: AiStagesInput): Promise<AiStagesOutput> {
  const { config, budget, sink } = i;
  const phase = (p: "plan" | "explore") =>
    sink({ t: "phase", phase: p, at: new Date().toISOString() });
  const logs: Promise<void>[] = [];
  const gateway = new LlmGateway({
    models: { smart: i.models.smart, fast: i.models.fast },
    modelIds: i.models.ids,
    vault: i.vault,
    cache: new LlmCache(i.cacheDir, config.llmCache),
    costCapUsd: i.costCapUsd,
    promptCaching: true,
    onCall: (e) => {
      logs.push(i.store.appendLlmCall(i.runId, { ...e }).catch(() => undefined));
    },
  });
  const states = i.states;
  const out: AiStagesOutput = {
    journeys: [],
    candidates: [],
    addedStates: [],
    capsHit: [],
    metrics: {},
    llm: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    steps: 0,
    gateway,
    states,
    flushLogs: async () => {
      await Promise.all(logs);
    },
  };
  const wall = budget.wallClockMs;
  const exploreDeadline = i.started + Math.round(wall * TIME_SPLIT.exploreEnd);
  const edgeDeadline = i.started + Math.round(wall * TIME_SPLIT.edgeEnd);

  // ---- Plan
  phase("plan");
  const pages = i.crawled.states.map((s) => ({
    state: s,
    snapshot: i.crawled.snapshots.get(s.id) ?? "",
  }));
  const snapshotEvidence = new Map(i.crawled.states.map((s) => [s.id, s.evidenceIds[1] ?? ""]));
  const plan = await planJourneys(gateway, {
    pages,
    snapshotEvidence,
    hint: config.hint,
    requirements: config.requirements,
    detectorSummary: detectorSummary(i.crawlCandidates),
    maxJourneys: budget.journeys,
  });
  if (!plan.ok) {
    out.aiStagesSkipped = `Planning failed (${plan.reason}): ${plan.error}. The report has the deterministic findings only.`;
    log(sink, "warn", out.aiStagesSkipped);
    return finish(out, gateway);
  }
  out.appModel = plan.appModel;
  if (config.requirements?.trim()) out.criteria = plan.criteria;
  Object.assign(out.metrics, prefix("plan", plan.metrics as unknown as Record<string, number>));
  let journeys = plan.journeys.map((j) => ({ ...j, status: "approved" as Journey["status"] }));
  if (config.approvedJourneyIds?.length) {
    const ok = new Set(config.approvedJourneyIds);
    journeys = journeys.map((j) =>
      ok.has(j.id) ? j : { ...j, status: "skipped" as const, incompleteReason: "Not approved." },
    );
  }
  sink({ t: "plan", journeys, autoApproveInMs: 0 });
  log(sink, "info", `The app looks like: ${plan.appModel.purpose}`);

  // ---- Explore
  phase("explore");
  const siteMap = buildAppMapSummary(pages, 12_000);
  const runs: JourneyRun[] = [];
  const totals: ExplorerMetrics = {
    turns: 0,
    invalidToolCalls: 0,
    executorErrors: 0,
    escalations: 0,
    asserts: 0,
    assertFailures: 0,
    assertErrors: 0,
    flags: 0,
    loopAborts: 0,
    duplicateAsserts: 0,
  };
  let stopReason: string | undefined;
  const credentials = config.credentials;
  for (const [n, j] of journeys.entries()) {
    if (j.status === "skipped") continue;
    // Each journey gets a fair share of the exploring time left (time a journey doesn't use carries over),
    // so one slow journey can't starve the rest (P3 gate run: the third journey got 5 steps).
    const left = journeys.slice(n).filter((x) => x.status !== "skipped").length;
    const share = Math.max(0, exploreDeadline - Date.now()) / Math.max(1, left);
    const journeyDeadline = Math.min(exploreDeadline, Date.now() + share);
    if (stopReason) {
      journeys[n] = { ...j, status: "skipped", incompleteReason: stopReason };
      continue;
    }
    if (Date.now() > exploreDeadline) {
      if (!out.capsHit.includes("wall-clock")) out.capsHit.push("wall-clock");
      journeys[n] = {
        ...j,
        status: "skipped",
        incompleteReason: "Not started: the time limit for exploring was reached.",
      };
      continue;
    }
    log(sink, "info", `Journey: ${j.title}`);
    const run = await exploreJourney(j, {
      browser: i.browser,
      policy: i.policy,
      evidence: i.evidence,
      store: i.store,
      runId: i.runId,
      gateway,
      vault: i.vault,
      sink,
      mode: config.mode,
      viewport: config.viewport,
      mobileViewport: config.mobileViewport,
      credentials,
      session: i.pre.session?.storageState,
      states,
      stepsPerJourney: budget.stepsPerJourney,
      deadline: journeyDeadline,
      siteMap,
    });
    runs.push(run);
    journeys[n] = run.journey;
    out.candidates.push(...run.candidates);
    for (const k of Object.keys(totals) as (keyof ExplorerMetrics)[]) totals[k] += run.metrics[k];
    if (run.llmUnavailable) {
      stopReason = `Not started: the AI became unavailable (${run.llmUnavailable}).`;
      if (run.llmUnavailable === "budget" && !out.capsHit.includes("llm-spend"))
        out.capsHit.push("llm-spend");
    }
  }
  Object.assign(out.metrics, prefix("explore", totals as unknown as Record<string, number>));
  out.metrics["explore.journeysCompleted"] = journeys.filter(
    (j) => j.status === "completed",
  ).length;
  out.metrics["explore.journeysAttempted"] = runs.length;

  // ---- Edge inputs (deterministic runner; the generator is the only LLM call)
  if (runs.length && Date.now() < edgeDeadline) {
    log(sink, "info", "Trying unusual inputs on the forms the journeys used.");
    const quick = config.budget === "quick";
    const edge = await runEdgeInputs(runs, {
      browser: i.browser,
      policy: i.policy,
      evidence: i.evidence,
      store: i.store,
      runId: i.runId,
      gateway: stopReason ? undefined : gateway,
      vault: i.vault,
      sink,
      mode: config.mode,
      viewport: config.viewport,
      mobileViewport: config.mobileViewport,
      credentials,
      session: i.pre.session?.storageState,
      states,
      deadline: edgeDeadline,
      variantsPerForm: quick ? 4 : 8,
      aiSlots: quick ? 1 : 3,
      maxForms: quick ? 2 : 5,
      loginUrl: i.pre.loginUrl,
      concurrency: 2,
    });
    out.candidates.push(...edge.candidates);
    for (const j of journeys) {
      const exps = edge.expectations.filter((e) => e.journeyId === j.id);
      const steps = edge.steps.filter((s) => s.journeyId === j.id);
      if (exps.length) j.expectations = [...j.expectations, ...exps];
      if (steps.length) j.steps = [...(j.steps ?? []), ...steps];
    }
    if (edge.loginJourney) journeys.push(edge.loginJourney);
    Object.assign(out.metrics, prefix("edge", edge.metrics as unknown as Record<string, number>));
    if (edge.metrics.variantsSkippedTime && !out.capsHit.includes("wall-clock"))
      out.capsHit.push("wall-clock");
  } else if (runs.length) {
    out.metrics["edge.skippedTime"] = 1;
    if (!out.capsHit.includes("wall-clock")) out.capsHit.push("wall-clock");
  }

  out.journeys = journeys;
  out.addedStates = states.added;
  out.steps = journeys.reduce((n, j) => n + (j.steps?.length ?? 0), 0);
  if (stopReason)
    out.aiStagesSkipped = stopReason.replace(/^Not started: /, "Some journeys weren't run: ");
  return finish(out, gateway);
}

function finish(out: AiStagesOutput, gateway: LlmGateway): AiStagesOutput {
  const t = gateway.totals;
  out.llm = {
    calls: t.calls,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    costUsd: t.costUsd,
  };
  Object.assign(out.metrics, {
    "llm.invalid": t.invalid,
    "llm.repaired": t.repaired,
    "llm.cacheHits": t.cacheHits,
    "llm.failures": t.failures,
  });
  if (gateway.budgetExhausted && !out.capsHit.includes("llm-spend")) out.capsHit.push("llm-spend");
  return out;
}

function prefix(p: string, m: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [`${p}.${k}`, v]));
}

/** One line for the Planner: what the crawl's detectors already found (so it doesn't plan around it). */
export function detectorSummary(candidates: Candidate[]): string {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const id = c.source.kind === "detector" ? c.source.id : c.source.kind;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (!counts.size) return "The crawl's automatic checks found nothing.";
  return `The crawl's automatic checks found: ${[...counts].map(([id, n]) => `${n} × ${id}`).join(", ")}.`;
}

export type { EdgeMetrics, PlanMetrics };
