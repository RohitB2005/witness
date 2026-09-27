// Verification (SPEC FR-8): turns candidate groups into tier decisions. For each group's representative:
// (1) evidence validation — every cited evidence ID exists; (2) replay without the LLM (verify/replay.ts);
// (3) the judge for Explorer flags; (4) the skeptic, which may only downgrade; (5) suppression. Grounding
// was validated when the expectation was written (FR-5). verify/tier.ts turns the facts into a tier.
//
// A failing LLM stage never fails the run: the judge or skeptic is recorded as skipped and the tier rules
// treat it as absent (a flag stays at Needs review; a check keeps its replayed tier).
import { log } from "../events";
import type { LlmGateway } from "../llm/gateway";
import type { GroupVerdict } from "../report/findings";
import { groupCandidates, tierFacts } from "../report/findings";
import type { Suppression } from "../store/run-store";
import type { Candidate, Journey, PageState, Pipeline, Step } from "../types";
import { pageText, snapshotText } from "./facts";
import { judge, type JudgeOutput } from "./judge";
import { replayTargets, type ReplayDeps, type ReplayResult } from "./replay";
import { skeptic, skepticApplies, type SkepticOutput } from "./skeptic";
import { isGrounded, replayOutcome, replayText, tierWithStages, type TierInput } from "./tier";
import { fingerprint } from "../report/fingerprint";

export interface VerifyInput {
  candidates: Candidate[];
  journeys: Journey[];
  states: PageState[];
  pipeline: Pipeline;
  /** Absent: no judge or skeptic (deterministic pipeline, or the AI is unavailable). */
  gateway?: LlmGateway;
  replay: Omit<ReplayDeps, "steps" | "deadline">;
  /** Epoch ms: replays and LLM verification stop starting after this. */
  deadline: number;
  suppressions: Suppression[];
}

export interface VerifyOutput {
  verdicts: Map<string, GroupVerdict>;
  /** Candidate → tier funnel (AI_AGENT_SPEC.md §8), for aiMetrics. */
  funnel: Record<string, number>;
}

interface GroupFacts {
  rep: Candidate;
  group: Candidate[];
  evidenceValid: boolean;
  evidenceNote?: string;
  replay?: ReplayResult;
  judge?: JudgeOutput;
  skeptic?: SkepticOutput;
  skepticSkipped?: string;
  suppressed?: { at: string; reason: string };
}

export async function verify(input: VerifyInput): Promise<VerifyOutput> {
  const { pipeline } = input;
  const sink = input.replay.sink;
  const steps = new Map<string, Step>();
  for (const j of input.journeys) for (const s of j.steps ?? []) steps.set(s.id, s);
  const stateById = new Map(input.states.map((s) => [s.id, s]));

  const groups: GroupFacts[] = [];
  for (const group of groupCandidates(input.candidates)) {
    const rep = group[0]!;
    const missing: string[] = [];
    for (const id of rep.evidenceIds)
      if (!(await input.replay.store.hasEvidence(input.replay.runId, id))) missing.push(id);
    groups.push({
      rep,
      group,
      evidenceValid: missing.length === 0,
      evidenceNote: missing.length ? `unknown evidence ${missing.join(", ")}` : undefined,
    });
  }

  // ---- Suppression (FR-12): the user said "Not a bug" for this fingerprint on this origin.
  const suppressed = new Map(input.suppressions.map((s) => [s.fingerprint, s]));
  for (const g of groups) {
    const s = suppressed.get(fingerprintOf(g.rep));
    if (s) g.suppressed = { at: s.createdAt, reason: s.reason };
  }

  // ---- Replay (not in the unverified pipeline, A1), with the judge and skeptic started for each finding
  // as soon as its replay is done (so they overlap the remaining replays instead of waiting for them all).
  // Finished replays go through a queue to workers created here, outside the replay's no-LLM context: the
  // replay guard stays absolute (an LLM call from inside a replay still throws).
  const gateway = input.gateway;
  const llmStages = !!gateway && pipeline !== "ai-no-verify" && pipeline !== "deterministic";
  let aiSkippedTime = 0;
  const llmOk = () => !!gateway && !gateway.budgetExhausted && Date.now() < input.deadline;
  const byKey = new Map(groups.map((g) => [g.rep.groupKey, g]));
  const queue = channel<GroupFacts>();
  const workers = Array.from({ length: 3 }, async () => {
    for (let g = await queue.next(); g; g = await queue.next()) await llmVerify(g);
  });
  const afterReplay = (g: GroupFacts) => {
    if (
      !llmStages ||
      !g.replay ||
      replayOutcome({ ...g.replay, static: g.rep.stepIds.length === 0 }) !== "reproduced"
    )
      return;
    if (g.rep.source.kind === "judgement" || (pipeline === "full" && skepticApplies(g.rep)))
      queue.push(g);
  };
  async function llmVerify(g: GroupFacts): Promise<void> {
    if (!gateway) return;
    const judged = g.rep.source.kind === "judgement";
    const argue = pipeline === "full" && skepticApplies(g.rep);
    if (judged) {
      if (!llmOk()) {
        if (Date.now() >= input.deadline) aiSkippedTime++;
        return;
      }
      const facts = await factSheet(g.rep, input, steps, stateById);
      const r = await judge(
        gateway,
        {
          claim: g.rep.summary,
          route: g.rep.route,
          steps: facts.steps,
          pageText: facts.pageText,
          previousPageText: facts.previousPageText,
          errors: facts.errors,
          evidenceIds: g.rep.evidenceIds,
        },
        input.deadline,
      );
      if (r.ok) g.judge = r.value;
      else log(sink, "warn", `The judge couldn't decide on "${g.rep.summary}": ${r.error}`);
      sink({
        t: "verify",
        candidateId: g.rep.id,
        stage: "tier",
        detail: r.ok ? `Judge: ${r.value.verdict} (${r.value.confidence})` : "Judge unavailable",
      });
      if (g.judge?.verdict !== "bug") return;
    }
    if (!argue) return;
    if (!llmOk()) {
      if (Date.now() >= input.deadline) aiSkippedTime++;
      g.skepticSkipped = "time or spend ran out";
      return;
    }
    const facts = await factSheet(g.rep, input, steps, stateById);
    const r = await skeptic(
      gateway,
      {
        statement: g.rep.detail.expected,
        grounding: g.rep.detail.whyFlagged,
        check: g.rep.check ? JSON.stringify(g.rep.check) : undefined,
        actual: g.rep.detail.actual,
        route: g.rep.route,
        steps: facts.steps,
        pageText: facts.pageText,
        replay: replayText(g.replay!),
      },
      input.deadline,
    );
    if (r.ok) g.skeptic = r.value;
    else g.skepticSkipped = r.error;
    sink({
      t: "verify",
      candidateId: g.rep.id,
      stage: "skeptic",
      detail: r.ok ? `Skeptic: ${r.value.verdict}` : "Skeptic unavailable",
    });
  }
  if (pipeline !== "ai-no-verify") {
    const targets = groups
      .filter((g) => g.evidenceValid && !g.suppressed && g.rep.source.kind !== "requirement")
      .map((g) => ({ key: g.rep.groupKey, candidate: g.rep, priority: priority(g.rep) }));
    const results = await replayTargets(targets, {
      ...input.replay,
      steps,
      deadline: input.deadline,
      onDone: (key, result) => {
        const g = byKey.get(key);
        if (!g) return;
        g.replay = result;
        afterReplay(g);
      },
    });
    for (const g of groups) g.replay = results.get(g.rep.groupKey);
  }
  queue.close();
  await Promise.all(workers);

  // ---- Tiers
  const verdicts = new Map<string, GroupVerdict>();
  const funnel: Record<string, number> = {
    "verify.candidates": input.candidates.length,
    "verify.groups": groups.length,
    "verify.discardedEvidence": 0,
    "verify.discardedReplay": 0,
    "verify.notReplayed": 0,
    "verify.notReplayedTime": 0,
    "verify.couldntRepeat": 0,
    "verify.intermittent": 0,
    "verify.downgradedSkeptic": 0,
    "verify.discardedJudge": 0,
    "verify.suppressed": 0,
  };
  for (const g of groups) {
    const replay = g.replay ?? { attempts: 0, reproduced: 0, notes: [], evidenceIds: [] };
    const facts: TierInput = {
      ...tierFacts(g.rep),
      evidenceValid: g.evidenceValid,
      evidenceNote: g.evidenceNote,
      replay: {
        attempts: replay.attempts,
        reproduced: replay.reproduced,
        static: g.rep.stepIds.length === 0,
        stepFailures: replay.stepFailures,
        failedStep: replay.failedStep,
        skipped:
          pipeline === "ai-no-verify" ? "unverified pipeline" : (replay.skipped ?? undefined),
      },
      judge: g.judge ? { verdict: g.judge.verdict, confidence: g.judge.confidence } : undefined,
      skeptic: g.skeptic?.verdict,
      suppressed: g.suppressed,
    };
    const t = tierWithStages(facts, pipeline);
    const outcome = replayOutcome(facts.replay);
    if (!g.evidenceValid) funnel["verify.discardedEvidence"]!++;
    else if (g.suppressed) funnel["verify.suppressed"]!++;
    else if (outcome === "not_reproduced" && pipeline !== "ai-no-verify")
      funnel["verify.discardedReplay"]!++;
    else if (outcome === "not_replayed" && pipeline !== "ai-no-verify")
      funnel["verify.notReplayed"]!++;
    if (/time for verifying ran out/.test(replay.skipped ?? ""))
      funnel["verify.notReplayedTime"]!++;
    else if (outcome === "couldnt_repeat" && pipeline !== "ai-no-verify")
      funnel["verify.couldntRepeat"]!++;
    else if (outcome === "intermittent") funnel["verify.intermittent"]!++;
    if (g.judge?.verdict === "not_bug") funnel["verify.discardedJudge"]!++;
    if (g.skeptic?.verdict === "benign_likely" && t.stageTiers.noSkeptic !== t.tier)
      funnel["verify.downgradedSkeptic"]!++;
    const notes = [
      ...replay.notes,
      ...(replay.skipped ? [`Not replayed: ${replay.skipped}.`] : []),
      ...(g.skepticSkipped ? [`Skeptic skipped: ${g.skepticSkipped}.`] : []),
    ];
    sink({ t: "tier", candidateIds: g.group.map((c) => c.id), tier: t.tier, reason: t.reason });
    verdicts.set(g.rep.groupKey, {
      tier: t.tier,
      tierReason: t.reason,
      stageTiers: t.stageTiers,
      replay: {
        attempts: replay.attempts,
        reproduced: replay.reproduced,
        ...(notes.length ? { notes: notes.join(" ").slice(0, 600) } : {}),
      },
      ...(g.skeptic
        ? {
            skeptic: {
              verdict: g.skeptic.verdict,
              reason: `${g.skeptic.reason} Innocent explanation considered: ${g.skeptic.strongestBenignExplanation}`,
            },
          }
        : {}),
      ...(g.judge
        ? {
            judge: {
              verdict: g.judge.verdict,
              confidence: g.judge.confidence,
              ...(g.judge.notes ? { notes: g.judge.notes } : {}),
            },
          }
        : {}),
      ...(g.suppressed ? { suppressed: g.suppressed } : {}),
      extraEvidenceIds: replay.evidenceIds.slice(0, 4),
    });
  }
  funnel["verify.aiReviewSkippedTime"] = aiSkippedTime;
  return { verdicts, funnel };
}

/** What could reach Confirmed replays first, then Likely, then the rest (D49 time ordering). */
export function priority(c: Candidate): number {
  if (c.kind === "improvement") return 3;
  if (c.source.kind === "detector") return 0;
  if (c.source.kind === "check") {
    if (c.grounding && isGrounded(c.grounding)) return 0;
    return c.grounding?.aiGuessedRule ? 2 : 1;
  }
  return 2;
}

/** The fingerprint a finding for this group will have (report/findings.ts uses the same inputs). */
export function fingerprintOf(c: Candidate): string {
  const sourceId =
    c.source.kind === "detector" || c.source.kind === "check" ? c.source.id : c.source.kind;
  const req = c.signals.request;
  return fingerprint({
    category: c.category,
    route: c.route,
    sourceId,
    key: c.groupKey,
    request: req ? { method: req.method, path: req.path } : undefined,
  });
}

async function factSheet(
  c: Candidate,
  input: VerifyInput,
  steps: Map<string, Step>,
  stateById: Map<string, PageState>,
): Promise<{ steps: string[]; pageText: string[]; previousPageText?: string[]; errors: string[] }> {
  const path = c.stepIds.map((id) => steps.get(id)).filter((s): s is Step => !!s);
  const { store, runId } = input.replay;
  const state = c.stateId ? stateById.get(c.stateId) : undefined;
  const snapshotId =
    state?.evidenceIds[1] ??
    [...path].reverse().find((s) => s.afterEvidenceIds[1])?.afterEvidenceIds[1];
  const current = pageText(await snapshotText(store, runId, snapshotId));
  const prevStep = [...path].reverse().find((s) => s.beforeEvidenceIds[1]);
  const previous = prevStep
    ? pageText(await snapshotText(store, runId, prevStep.beforeEvidenceIds[1]), 40)
    : undefined;
  const errors: string[] = [];
  for (const id of state?.evidenceIds.slice(2, 5) ?? []) {
    const ev = await store.getEvidence(runId, id).catch(() => undefined);
    const entries =
      (
        ev?.data as
          | {
              entries?: {
                text?: string;
                method?: string;
                path?: string;
                status?: number;
                sameOrigin?: boolean;
              }[];
            }
          | undefined
      )?.entries ?? [];
    for (const e of entries) {
      if (e.text)
        errors.push(
          `${ev!.kind === "page_error" ? "page error" : "console"}: ${e.text.slice(0, 160)}`,
        );
      else if (e.sameOrigin && (e.status ?? 0) >= 400)
        errors.push(`${e.method} ${e.path} → ${e.status}`);
    }
  }
  return {
    steps: path.map((s) => s.description),
    pageText: current,
    previousPageText: previous,
    errors: errors.slice(0, 10),
  };
}

/** A minimal async queue: `next()` waits for an item, or returns undefined once closed and empty. */
function channel<T>() {
  const items: T[] = [];
  const waiters: ((v: T | undefined) => void)[] = [];
  let closed = false;
  return {
    push(v: T) {
      const w = waiters.shift();
      if (w) w(v);
      else items.push(v);
    },
    close() {
      closed = true;
      for (const w of waiters.splice(0)) w(undefined);
    },
    next(): Promise<T | undefined> {
      if (items.length) return Promise.resolve(items.shift());
      if (closed) return Promise.resolve(undefined);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
