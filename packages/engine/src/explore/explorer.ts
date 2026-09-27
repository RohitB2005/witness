// Explorer loop (AI_AGENT_SPEC.md §3.2): the only agent in Witness. One journey per call, in a fresh
// browser context. Each turn: build a text context → one tool call (fast model; escalates to the smart
// model for one turn after two bad turns) → the executor or the oracle carries it out → record.
// Stops on: finish, step budget, a repeated action on an unchanged page, 3 executor errors in a row,
// the wall-clock deadline, or the LLM becoming unavailable (spend cap, provider down, cache miss).
import type { Browser } from "playwright";
import { createContext } from "../browser/context";
import type { SafetyPolicy } from "../browser/policy";
import type { SecretVault } from "../browser/vault";
import { AUTH_PAGE } from "../crawl/crawler";
import { log, type EventSink } from "../events";
import { newId } from "../ids";
import type { LlmGateway } from "../llm/gateway";
import { EXPLORER_INSTRUCTIONS } from "../llm/prompts/explorer";
import { pageContent } from "../llm/prompts/universal";
import { containsLoose } from "../oracle/parse";
import type { StorageState } from "../preflight/preflight";
import type { EvidenceWriter } from "../record/evidence";
import { PageRecorder } from "../record/recorder";
import type { RunStore } from "../store/run-store";
import type { Candidate, Expectation, Journey, ScanMode, Step } from "../types";
import { checkCandidate, flagCandidate } from "./candidates";
import { buildTurnParts, labelledAmounts, type TurnContext } from "./context";
import { Executor, type AgentAction, type StepResult } from "./executor";
import { RefError } from "./locators";
import type { StateRegistry } from "./states";
import { AssertSchema, EXPLORER_TOOLS, ToolInputs, type CaptureInput } from "./tools";

export interface ExploreDeps {
  browser: Browser;
  policy: SafetyPolicy;
  evidence: EvidenceWriter;
  store: RunStore;
  runId: string;
  gateway: LlmGateway;
  vault: SecretVault;
  sink: EventSink;
  mode: ScanMode;
  viewport: { width: number; height: number };
  mobileViewport: { width: number; height: number };
  credentials?: { username: string; passwordRef: string };
  /** Logged-in cookies/storage from preflight (memory only). */
  session?: StorageState;
  states: StateRegistry;
  stepsPerJourney: number;
  /** Epoch ms: no new turn starts after this. */
  deadline: number;
  /**
   * The crawl's site map (same text the Planner saw), sent first in every turn. It helps the Explorer find
   * its way, and it is stable for the whole run, so with the tools and system prompt it clears the fast
   * model's minimum cacheable length (P3).
   */
  siteMap?: string;
}

export interface ExplorerMetrics {
  turns: number;
  invalidToolCalls: number;
  executorErrors: number;
  escalations: number;
  asserts: number;
  assertFailures: number;
  assertErrors: number;
  flags: number;
  loopAborts: number;
}

export interface JourneyRun {
  journey: Journey;
  candidates: Candidate[];
  metrics: ExplorerMetrics;
  /** Set when the LLM became unavailable: later journeys shouldn't start either. */
  llmUnavailable?: "budget" | "provider" | "cache-miss";
  /** Snapshot text by evidence id (the edge runner reads success messages from these). */
  snapshots: Map<string, string>;
  session: "anonymous" | "authenticated";
}

type Status = TurnContext["expectations"][number]["status"];

export async function exploreJourney(input: Journey, deps: ExploreDeps): Promise<JourneyRun> {
  const journey: Journey = {
    ...input,
    status: "running",
    expectations: input.expectations.map((e) => ({ ...e })),
  };
  deps.sink({ t: "journey", journeyId: journey.id, status: "running" });
  const metrics: ExplorerMetrics = {
    turns: 0,
    invalidToolCalls: 0,
    executorErrors: 0,
    escalations: 0,
    asserts: 0,
    assertFailures: 0,
    assertErrors: 0,
    flags: 0,
    loopAborts: 0,
  };
  const candidates: Candidate[] = [];
  const status = new Map<string, Status>(
    journey.expectations.map((e) => [e.id, "not checked yet"]),
  );
  const loggedIn = !!deps.session && !AUTH_PAGE.test(journey.startRoute.split("?")[0] ?? "");
  const session = loggedIn ? "authenticated" : "anonymous";
  const context = await createContext(deps.browser, {
    policy: deps.policy,
    viewport: deps.viewport,
    storageState: loggedIn ? deps.session : undefined,
    onDialog: (d) => log(deps.sink, "info", `Dismissed a ${d.type} dialog: "${d.message}"`),
  });
  let llmUnavailable: JourneyRun["llmUnavailable"];
  const history: string[] = [];
  let lastResult: string | undefined;

  const finish = (s: "completed" | "incomplete", reason?: string) => {
    journey.status = s;
    if (reason) journey.incompleteReason = reason;
  };

  try {
    const page = await context.newPage();
    const recorder = new PageRecorder(page, deps.policy);
    const ex = new Executor({
      page,
      recorder,
      evidence: deps.evidence,
      vault: deps.vault,
      policy: deps.policy,
      mode: deps.mode,
      journeyId: journey.id,
      kind: "happy",
      session,
      states: deps.states,
      viewport: deps.viewport,
      mobileViewport: deps.mobileViewport,
      credentials: deps.credentials,
    });
    const emitStep = (r: { step: Step }) =>
      deps.sink({
        t: "step",
        step: {
          id: r.step.id,
          journeyId: journey.id,
          index: r.step.index,
          description: r.step.description,
          ok: r.step.ok,
          kind: r.step.kind,
        },
      });
    const addCandidates = (cs: Candidate[]) => {
      for (const c of cs) {
        candidates.push(c);
        deps.sink({
          t: "candidate",
          candidate: { id: c.id, category: c.category, summary: c.summary, route: c.route },
        });
      }
    };

    const start = await ex.act({ type: "goto", path: journey.startRoute });
    emitStep(start);
    addCandidates(start.candidates);
    history.push(`1. ${start.step.description} → ${start.ok ? "ok" : start.message}`);

    let consecutiveErrors = 0;
    let badTurns = 0;
    let lastActionKey = "";
    let repeats = 0;
    let finished = false;
    const amountStates = new Set<string>();
    let providerErrors = 0;
    // The journey brief is fixed at the first turn, so every turn shares one cacheable prefix.
    let brief: string | undefined;

    while (!finished) {
      if (metrics.turns >= deps.stepsPerJourney) {
        finish("incomplete", `Step budget (${deps.stepsPerJourney}) reached.`);
        break;
      }
      if (Date.now() > deps.deadline) {
        finish("incomplete", "Time limit reached.");
        break;
      }
      metrics.turns++;
      const cur = ex.current;
      const errors = cur
        ? [
            ...cur.capture.slice.errors.map((e) => `page error: ${e.text}`),
            ...cur.capture.slice.network
              .filter((n) => n.sameOrigin && (n.status ?? 0) >= 500)
              .map((n) => `server error: ${n.method} ${n.path} → ${n.status}`),
          ]
        : [];
      const parts = buildTurnParts({
        journey,
        expectations: journey.expectations.map((exp) => ({
          exp,
          status: status.get(exp.id) ?? "not checked yet",
        })),
        history,
        newErrors: errors,
        evidenceIds: cur
          ? [
              { id: cur.capture.evidence.screenshot, what: "screenshot" },
              { id: cur.capture.evidence.snapshot, what: "page snapshot" },
              { id: cur.capture.evidence.network, what: "network log" },
              { id: cur.capture.evidence.console, what: "console" },
              { id: cur.capture.evidence.pageErrors, what: "page errors" },
            ]
          : [],
        stepNumber: metrics.turns,
        stepBudget: deps.stepsPerJourney,
        url: page.url(),
        title: cur?.capture.title ?? "",
        snapshot: cur?.capture.snapshot ?? "",
        lastResult,
        loggedIn,
        today: new Date().toLocaleDateString("en-CA"), // local YYYY-MM-DD
      });
      brief ??= parts.brief;
      const prompt = parts.turn;
      // Escalate to the smart model for one turn after two bad turns, and the first time a page state
      // shows labelled amounts: writing the relation a label states is where the small model is weakest.
      const stateId = cur?.state.id ?? "";
      const amountsTurn =
        !!cur && !amountStates.has(stateId) && labelledAmounts(cur.capture.snapshot).length > 0;
      if (amountsTurn) amountStates.add(stateId);
      const escalate = badTurns >= 2 || amountsTurn;
      if (escalate) metrics.escalations++;
      const call = await deps.gateway.toolCall({
        role: "explorer",
        tier: escalate ? "smart" : "fast",
        instructions: EXPLORER_INSTRUCTIONS,
        prompt,
        tools: EXPLORER_TOOLS,
        promptPrefix: deps.siteMap
          ? [
              `<site_map hint="pages the crawl found, for finding your way">\n${pageContent(deps.siteMap)}\n</site_map>`,
              brief!,
            ]
          : brief,
        // A normal turn takes 2–4 s; don't let one stuck call eat the journey's time.
        timeoutMs: 30_000,
      });
      deps.sink({
        t: "cost",
        llmCalls: deps.gateway.totals.calls,
        costUsd: deps.gateway.totals.costUsd,
      });
      if (!call.ok) {
        if (call.reason === "invalid") {
          metrics.invalidToolCalls++;
          badTurns++;
          lastResult = `Your last tool call was invalid: ${call.error}`;
          continue;
        }
        // One provider error or timeout is a bad turn; two in a row means the AI is unavailable.
        // Budget and cache misses are final at once.
        if (call.reason === "provider" && providerErrors++ === 0) {
          badTurns++;
          lastResult = "The previous turn didn't get a reply; carry on.";
          continue;
        }
        llmUnavailable = call.reason;
        finish("incomplete", `The AI stopped being available (${call.reason}): ${call.error}`);
        break;
      }
      providerErrors = 0;
      const { name, input } = call.value;
      const turnNo = ex.steps.length + 1;
      let outcome: { ok: boolean; message: string; stepResult?: StepResult };

      switch (name) {
        case "click":
        case "fill":
        case "select":
        case "press":
        case "goto":
        case "reload":
        case "scroll":
        case "wait": {
          const action = toAction(name, input);
          const key = `${JSON.stringify(action)}|${ex.current?.state.id ?? ""}`;
          repeats = key === lastActionKey ? repeats + 1 : 0;
          lastActionKey = key;
          const r = await ex.act(action);
          emitStep(r);
          addCandidates(r.candidates);
          outcome = { ok: r.ok, message: r.message, stepResult: r };
          if (repeats >= 2 && ex.current?.state.id && key.endsWith(ex.current.state.id)) {
            metrics.loopAborts++;
            finish(
              "incomplete",
              "Stopped: the same action kept being repeated on an unchanged page.",
            );
            finished = true;
          }
          break;
        }
        case "assert": {
          outcome = await doAssert(AssertSchema.parse(input));
          break;
        }
        case "capture": {
          const c = input as CaptureInput;
          try {
            const stored = await ex.storedCheck(c);
            const r = await ex.check(stored);
            emitStep(r);
            outcome = {
              ok: r.result.status !== "error",
              message: `${r.result.status === "error" ? "ERROR" : "OK"}: ${r.result.message}`,
            };
          } catch (err) {
            outcome = {
              ok: false,
              message: err instanceof RefError ? err.message : `Couldn't capture: ${String(err)}`,
            };
          }
          break;
        }
        case "flag_candidate": {
          const f = ToolInputs.flag.parse(input);
          const unknown: string[] = [];
          for (const id of f.evidenceIds)
            if (!(await deps.store.hasEvidence(deps.runId, id))) unknown.push(id);
          if (unknown.length) {
            outcome = {
              ok: false,
              message: `Unknown evidence IDs: ${unknown.join(", ")}. Cite only IDs from <evidence_ids>.`,
            };
            break;
          }
          metrics.flags++;
          addCandidates([
            flagCandidate({
              summary: f.summary,
              category: f.category,
              evidenceIds: f.evidenceIds,
              url: page.url(),
              state: ex.current?.state,
              session,
              journeyId: journey.id,
              stepIds: ex.steps.map((s) => s.id),
            }),
          ]);
          outcome = { ok: true, message: "Flag recorded; it will be verified separately." };
          break;
        }
        case "finish": {
          const f = ToolInputs.finish.parse(input);
          finished = true;
          if (f.outcome === "completed") finish("completed");
          else
            finish("incomplete", `${f.outcome === "blocked" ? "Blocked" : "Gave up"}: ${f.note}`);
          outcome = { ok: true, message: "Finished." };
          break;
        }
        default:
          outcome = { ok: false, message: `Unknown tool ${name}` };
      }

      history.push(`${turnNo}. ${describeTurn(name, input, outcome)}`);
      lastResult = outcome.message;
      if (outcome.ok) {
        consecutiveErrors = 0;
        badTurns = 0;
      } else {
        consecutiveErrors++;
        badTurns++;
        if (outcome.stepResult) metrics.executorErrors++;
        if (consecutiveErrors >= 3 && !finished) {
          finish(
            "incomplete",
            `Stopped after 3 failed actions in a row (last: ${outcome.message})`,
          );
          finished = true;
        }
      }
    }

    journey.steps = ex.steps;
    return { journey, candidates, metrics, llmUnavailable, snapshots: ex.snapshots, session };

    // ---------------------------------------------------------------------------------------------
    async function doAssert(
      a: ReturnType<typeof AssertSchema.parse>,
    ): Promise<{ ok: boolean; message: string }> {
      metrics.asserts++;
      let exp: Expectation | undefined;
      try {
        if (a.expectationId) {
          exp = journey.expectations.find((e) => e.id === a.expectationId);
          if (!exp) return { ok: false, message: `Unknown expectationId ${a.expectationId}.` };
          const prev = status.get(exp.id);
          // A decided expectation is frozen: the check that failed is the one replay must re-run, and a
          // failure can't be "fixed" by asserting a different check.
          if (prev === "passed" || prev === "FAILED") {
            return {
              ok: true,
              message: `Already asserted (${prev}). Move on; add a new expectation if you see something else.`,
            };
          }
          if (a.check && prev === "not checked yet" && exp.origin === "plan") {
            // Two readings of one statement: the Planner's check and the Explorer's. The planned one
            // runs first and a failure there stands (a weaker replacement can't mask it). Otherwise the
            // Explorer's check decides: it may be the precise one (e.g. the exact relation once the
            // result is on screen). If it can't be evaluated, a planned pass stands.
            const planned = await evaluate(exp);
            if (planned.status === "fail") {
              return { ok: true, message: `${planned.message} (from the planned check)` };
            }
            const plannedCheck = exp.check;
            exp.check = await ex.storedCheck(a.check);
            const own = await evaluate(exp);
            if (own.status === "error" && planned.status === "pass") {
              exp.check = plannedCheck;
              status.set(exp.id, "passed");
              return { ok: true, message: `${planned.message} (your check couldn't be evaluated)` };
            }
            return { ok: own.status !== "error", message: own.message };
          }
          if (a.check) exp.check = await ex.storedCheck(a.check);
        } else {
          const snapshot = ex.current?.capture.snapshot ?? "";
          const g = a.grounding!;
          exp = {
            id: newId("ex"),
            journeyId: journey.id,
            statement: a.statement!,
            check: await ex.storedCheck(a.check!),
            grounding:
              g.kind === "ui_text"
                ? containsLoose(snapshot, g.quote)
                  ? {
                      kind: "ui_text",
                      quote: g.quote,
                      verified: true,
                      evidenceId: ex.current?.capture.evidence.snapshot,
                    }
                  : {
                      kind: "convention",
                      rationale: `Quoted text not found on the page: "${g.quote.slice(0, 120)}"`,
                    }
                : { kind: "convention", rationale: g.rationale },
            impact: a.impact!,
            category: a.category,
            origin: "agent",
          };
          journey.expectations.push(exp);
        }
      } catch (err) {
        metrics.assertErrors++;
        return {
          ok: false,
          message:
            err instanceof RefError ? err.message : `Couldn't use that check: ${String(err)}`,
        };
      }
      const r = await evaluate(exp);
      return { ok: r.status !== "error", message: r.message };
    }

    /** Evaluates an expectation's (stored) check now, records it, and turns a failure into a candidate. */
    async function evaluate(exp: Expectation): Promise<{ status: string; message: string }> {
      const r = await ex.check(exp.check, { expectationId: exp.id, statement: exp.statement });
      emitStep(r);
      if (r.result.status === "pass") {
        status.set(exp.id, "passed");
        return { status: "pass", message: `PASS: ${r.result.message}` };
      }
      if (r.result.status === "error") {
        status.set(exp.id, "couldn't evaluate");
        metrics.assertErrors++;
        return {
          status: "error",
          message: `ERROR (couldn't evaluate): ${r.result.message} Try again with your own check using refs.`,
        };
      }
      status.set(exp.id, "FAILED");
      metrics.assertFailures++;
      const cur = ex.current;
      addCandidates([
        checkCandidate({
          exp,
          result: r.result,
          url: page.url(),
          state: cur?.state,
          session,
          journeyId: journey.id,
          stepIds: ex.steps.map((s) => s.id),
          evidenceIds: [
            r.evidenceId,
            ...(cur ? [cur.capture.evidence.screenshot, cur.capture.evidence.snapshot] : []),
          ],
        }),
      ]);
      return { status: "fail", message: `FAIL (recorded as a candidate): ${r.result.message}` };
    }
  } finally {
    await context.close().catch(() => undefined);
    if (journey.status === "running") finish("incomplete", "Stopped unexpectedly.");
    deps.sink({ t: "journey", journeyId: journey.id, status: journey.status });
  }
}

function toAction(name: string, input: unknown): AgentAction {
  switch (name) {
    case "click": {
      const i = ToolInputs.click.parse(input);
      return { type: "click", target: { ref: i.ref } };
    }
    case "fill": {
      const i = ToolInputs.fill.parse(input);
      return { type: "fill", target: { ref: i.ref }, value: i.value };
    }
    case "select": {
      const i = ToolInputs.select.parse(input);
      return { type: "select", target: { ref: i.ref }, option: i.option };
    }
    case "press":
      return { type: "press", key: ToolInputs.press.parse(input).key };
    case "goto":
      return { type: "goto", path: ToolInputs.goto.parse(input).path };
    case "scroll":
      return { type: "scroll", direction: ToolInputs.scroll.parse(input).direction };
    case "wait":
      return { type: "wait", ms: ToolInputs.wait.parse(input).ms };
    default:
      return { type: "reload" };
  }
}

function describeTurn(
  name: string,
  input: unknown,
  outcome: { ok: boolean; message: string; stepResult?: StepResult },
): string {
  const what =
    outcome.stepResult?.step.description ?? `${name} ${JSON.stringify(input).slice(0, 160)}`;
  return `${what} → ${outcome.ok ? "ok" : "failed"}: ${outcome.message.slice(0, 240)}`;
}
