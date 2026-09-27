// Executor (AI_AGENT_SPEC.md §4, SECURITY.md T1/T3/T9/T10): carries out one action at a time for the
// Explorer or the edge-input runner, and records it as a replayable Step.
//
// For each action: rate limit → resolve the target (ref → unique stable locator) → safety checks
// (destructive verbs, same-origin goto, allowed keys) → act with a 10 s timeout → wait for the page to
// settle → record evidence → run detectors on the step. Secrets are typed from the vault at the last
// moment; the Step keeps the {{secret:…}} placeholder. Checks (assert/capture) are recorded as steps too,
// so a replay re-evaluates them in the same place.
import type { Page } from "playwright";
import { LIMITS } from "../config/budgets";
import { RateLimiter } from "../browser/context";
import type { SafetyPolicy } from "../browser/policy";
import type { SecretVault } from "../browser/vault";
import { isNetworkEcho } from "../detectors/console";
import { runStepDetectors } from "../detectors/registry";
import { newId } from "../ids";
import { evaluateCheck, type Captured, type CheckResult } from "../oracle/evaluate";
import {
  isRef,
  mapCheckLocators,
  mapValueReads,
  type AgentCheck,
  type AgentLoc,
  type Check,
  type Locator,
} from "../oracle/language";
import { toPlaywright } from "../oracle/locate";
import { captureState, type EvidenceWriter, type StateCapture } from "../record/evidence";
import type { PageRecorder, RecorderMark } from "../record/recorder";
import type { Action, Candidate, PageState, ScanMode, Step } from "../types";
import { describeAction } from "./describe";
import {
  cssPath,
  RefError,
  stableLocatorForRef,
  type LocatorPurpose,
  type StepTarget,
} from "./locators";
import { ALLOWED_KEYS, destructiveBlock } from "./safety";
import type { StateRegistry } from "./states";

export type AgentAction =
  | { type: "click"; target: AgentLoc; clickCount?: number }
  | { type: "fill"; target: AgentLoc; value: string }
  | { type: "select"; target: AgentLoc; option: string }
  | { type: "press"; key: string }
  | { type: "goto"; path: string }
  | { type: "reload" }
  | { type: "scroll"; direction: "down" | "up" }
  | { type: "wait"; ms: number };

export interface ExecutorOptions {
  page: Page;
  recorder: PageRecorder;
  evidence: EvidenceWriter;
  vault: SecretVault;
  policy: SafetyPolicy;
  mode: ScanMode;
  journeyId: string;
  kind: "happy" | "edge";
  session: PageState["session"];
  states: StateRegistry;
  viewport: { width: number; height: number };
  mobileViewport: { width: number; height: number };
  credentials?: { username: string; passwordRef: string };
  /**
   * Detectors on each step: "full" (default: log detectors every step, page detectors on new states),
   * "log" (log detectors only: edge variants), or "off" (replays that only re-evaluate a signature).
   */
  detectors?: "full" | "log" | "off";
  limiter?: RateLimiter;
  /** Cap on the network-quiet wait after each action (ms). */
  quietCapMs?: number;
  /**
   * Record the evidence bundle (screenshot, snapshot, logs) after every step (default). Replays turn this
   * off: they act through stored locators, need no snapshot, and capture evidence once at the end.
   */
  captureSteps?: boolean;
}

export interface StepResult {
  step: Step;
  ok: boolean;
  /** Plain-language outcome for the agent (and the live view). */
  message: string;
  blocked: boolean;
  candidates: Candidate[];
  capture?: StateCapture;
  state?: PageState;
}

export interface CheckStepResult {
  step: Step;
  result: CheckResult;
  evidenceId: string;
}

export class Executor {
  readonly steps: Step[] = [];
  readonly captures = new Map<string, Captured>();
  /** Snapshot text by its evidence id, for every state this executor recorded. */
  readonly snapshots = new Map<string, string>();
  readonly #o: ExecutorOptions;
  readonly #limiter: RateLimiter;
  #errorMark: RecorderMark;
  #actionMark: RecorderMark;
  #last?: { capture: StateCapture; state: PageState };

  constructor(o: ExecutorOptions) {
    this.#o = o;
    this.#limiter = o.limiter ?? new RateLimiter();
    this.#errorMark = o.recorder.mark();
    this.#actionMark = o.recorder.mark();
  }

  get page(): Page {
    return this.#o.page;
  }

  /** The latest recorded state (after the most recent action). */
  get current(): { capture: StateCapture; state: PageState } | undefined {
    return this.#last;
  }

  /** Performs one action and records it as a step. Never throws for ordinary failures. */
  async act(action: AgentAction, extra: { kind?: Step["kind"] } = {}): Promise<StepResult> {
    const { page, recorder } = this.#o;
    await this.#limiter.wait();
    const urlBefore = page.url();
    const mark = recorder.mark();
    this.#actionMark = mark;
    const stepId = newId("sp");
    let stored: Action;
    let target: StepTarget | undefined;
    let error: string | undefined;
    let blocked = false;

    try {
      const prepared = await this.#prepare(action);
      stored = prepared.action;
      target = prepared.target;
      if (prepared.blockedReason) {
        blocked = true;
        error = `Blocked by safety policy: ${prepared.blockedReason}`;
      } else {
        await this.#perform(stored);
      }
    } catch (err) {
      stored ??= fallbackAction(action);
      error = err instanceof RefError ? err.message : `Action failed: ${firstLine(err)}`;
    }

    // Settle: the document (if it navigated), then the network.
    if (!blocked) {
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      await recorder.waitForQuiet(this.#o.quietCapMs ?? 3_000, LIMITS.quietWindowMs);
    }
    // The origin guard aborts an off-site navigation, leaving Chromium's error page: go back (DEVLOG P1).
    if (page.url().startsWith("chrome-error://")) {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      blocked = true;
      error = "Blocked by safety policy: that leads outside the site being tested.";
    }

    const step: Step = {
      id: stepId,
      journeyId: this.#o.journeyId,
      index: this.steps.length,
      kind: extra.kind ?? this.#o.kind,
      action: stored,
      description: describeAction(stored),
      beforeEvidenceIds: this.#last ? evidenceList(this.#last.capture) : [],
      afterEvidenceIds: [],
      urlBefore,
      urlAfter: page.url(),
      ok: !error,
      error,
      target,
    };
    this.steps.push(step);

    const recorded = await this.#record(step, mark, step.kind === "happy" && !error);
    return {
      step,
      ok: !error,
      message: error ?? `Done. Now on ${pathOf(page.url())}.`,
      blocked,
      candidates: recorded.candidates,
      capture: recorded.capture,
      state: recorded.state,
    };
  }

  /**
   * Evaluates a (stored, ref-free) check now and records it as a step with a check_result evidence item.
   * `capture` checks only store a value; every other check also resets the "errors since last assert" mark.
   */
  async check(
    check: Check,
    meta: { expectationId?: string; statement?: string; successCheck?: Check } = {},
  ): Promise<CheckStepResult> {
    const { page, recorder } = this.#o;
    const errorMark = this.#errorMark;
    const actionMark = this.#actionMark;
    const result = await evaluateCheck(check, {
      page,
      captures: this.captures,
      successCheck: meta.successCheck,
      errorsSince: () => {
        const slice = recorder.since(errorMark);
        return {
          pageErrors: slice.errors.map((e) => e.text),
          serverErrors: slice.network
            .filter((n) => n.sameOrigin && (n.status ?? 0) >= 500)
            .map((n) => `${n.method} ${n.path} → ${n.status}`),
          consoleErrors: slice.console
            .filter((c) => c.type === "error" && !isNetworkEcho(c.text))
            .map((c) => c.text),
        };
      },
      requestsSince: () =>
        recorder
          .since(actionMark)
          .network.filter((n) => n.sameOrigin)
          .map((n) => ({ method: n.method, path: n.path, status: n.status })),
    });
    if (check.type !== "capture") this.#errorMark = recorder.mark();
    const stepId = newId("sp");
    const evidenceId = await this.#o.evidence.put(
      "check_result",
      {
        url: page.url(),
        expectationId: meta.expectationId,
        statement: meta.statement,
        check,
        status: result.status,
        message: result.message,
        observed: result.observed,
        leaf: result.leaf,
      },
      { stepId, stateId: this.#last?.state.id },
    );
    const action: Action = { type: "check", check, expectationId: meta.expectationId };
    const step: Step = {
      id: stepId,
      journeyId: this.#o.journeyId,
      index: this.steps.length,
      kind: this.#o.kind,
      action,
      description: describeAction(action, meta.statement),
      beforeEvidenceIds: this.#last ? evidenceList(this.#last.capture) : [],
      afterEvidenceIds: [evidenceId],
      urlBefore: page.url(),
      urlAfter: page.url(),
      ok: result.status !== "error",
      error: result.status === "error" ? result.message : undefined,
      expectationId: meta.expectationId,
    };
    this.steps.push(step);
    return { step, result, evidenceId };
  }

  /**
   * Converts every ref in an agent check to a stable locator (so it can be stored and replayed). A value
   * the agent located by its own text ("$238.05") is re-located by test id or position instead: that text
   * is exactly what changes when the bug is fixed, so the replay and the exported test would break (P2).
   */
  async storedCheck(check: AgentCheck): Promise<Check> {
    const stored = await mapCheckLocators(check, async (loc: AgentLoc, use) =>
      isRef(loc) ? (await this.resolve(loc, use === "items" ? "items" : "read")).locator : loc,
    );
    return mapValueReads(stored, (loc) => this.#stableRead(loc));
  }

  async #stableRead(loc: Locator): Promise<Locator> {
    if (loc.by !== "text" || !/\d/.test(loc.text) || loc.within) return loc;
    const pw = toPlaywright(this.#o.page, loc);
    if ((await pw.count().catch(() => 0)) !== 1) return loc;
    const handle = await pw.elementHandle({ timeout: 1_000 }).catch(() => null);
    if (!handle) return loc;
    try {
      const testId = await handle.getAttribute("data-testid").catch(() => null);
      if (testId && (await this.#o.page.getByTestId(testId).count()) === 1)
        return { by: "testId", id: testId };
      return { by: "css", selector: await cssPath(handle) };
    } finally {
      await handle.dispose().catch(() => undefined);
    }
  }

  /** Resolves a ref (or checks a given locator is present) for the given purpose. */
  async resolve(
    loc: AgentLoc,
    purpose: LocatorPurpose,
  ): Promise<{ locator: Locator; target?: StepTarget }> {
    if (isRef(loc)) return stableLocatorForRef(this.#o.page, loc.ref, purpose);
    return { locator: loc };
  }

  /** Records the initial state (before any action), e.g. right after the context opens. */
  async snapshotNow(): Promise<void> {
    const mark = this.#o.recorder.mark();
    await this.#record(undefined, mark, false);
  }

  // -------------------------------------------------------------------------------------------

  async #prepare(
    action: AgentAction,
  ): Promise<{ action: Action; target?: StepTarget; blockedReason?: string }> {
    const { page, mode } = this.#o;
    switch (action.type) {
      case "click":
      case "fill":
      case "select": {
        const { locator, target } = await this.resolve(action.target, "act");
        const pw = toPlaywright(page, locator);
        const n = await pw.count();
        if (n !== 1)
          throw new RefError(
            `${n === 0 ? "No element" : `${n} elements`} matched the target; it must be exactly one.`,
          );
        const stored: Action =
          action.type === "click"
            ? {
                type: "click",
                target: locator,
                ...(action.clickCount === 2 ? { clickCount: 2 } : {}),
              }
            : action.type === "fill"
              ? { type: "fill", target: locator, value: action.value }
              : { type: "select", target: locator, option: action.option };
        if (action.type === "click") {
          const label = target?.name || (await pw.innerText({ timeout: 2_000 }).catch(() => ""));
          const reason = destructiveBlock(label, mode);
          if (reason) return { action: stored, target, blockedReason: reason };
        }
        return { action: stored, target };
      }
      case "goto": {
        const path = sameOriginPath(action.path, this.#o.policy.origin);
        if (!path) {
          return {
            action: { type: "goto", path: action.path },
            blockedReason: "goto only accepts paths on the site being tested (e.g. /account).",
          };
        }
        return { action: { type: "goto", path } };
      }
      case "press":
        if (!ALLOWED_KEYS.has(action.key)) {
          return {
            action: { type: "press", key: action.key },
            blockedReason: `only these keys are allowed: ${[...ALLOWED_KEYS].join(", ")}.`,
          };
        }
        return { action: { type: "press", key: action.key } };
      case "wait":
        return {
          action: { type: "wait", ms: Math.min(Math.max(0, Math.round(action.ms)), 3_000) },
        };
      case "reload":
      case "scroll":
        return { action };
    }
  }

  async #perform(action: Action): Promise<void> {
    const { page } = this.#o;
    const timeout = LIMITS.actionTimeoutMs;
    switch (action.type) {
      case "click":
        await toPlaywright(page, action.target).click({
          timeout,
          clickCount: action.clickCount ?? 1,
        });
        return;
      case "fill":
        await toPlaywright(page, action.target).fill(this.#resolveValue(action.value), { timeout });
        return;
      case "select": {
        const loc = toPlaywright(page, action.target);
        await loc
          .selectOption({ label: action.option }, { timeout })
          .catch(() => loc.selectOption(action.option, { timeout }));
        return;
      }
      case "press":
        await page.keyboard.press(action.key);
        return;
      case "goto":
        await page.goto(new URL(action.path, this.#o.policy.origin).href, {
          waitUntil: "domcontentloaded",
        });
        return;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded" });
        return;
      case "scroll":
        await page.mouse.wheel(0, action.direction === "down" ? 600 : -600);
        return;
      case "wait":
        await page.waitForTimeout(action.ms);
        return;
      case "check":
        return; // checks go through check()
    }
  }

  /** {{secret:password}} → the vault value; {{secret:username}} → the account name. Only at typing time. */
  #resolveValue(value: string): string {
    return value.replace(/\{\{secret:([a-zA-Z0-9_-]+)\}\}/g, (_m, name: string) => {
      const creds = this.#o.credentials;
      if (name === "username") {
        if (!creds) throw new Error("No username was provided for this scan.");
        return creds.username;
      }
      if (name === "password") {
        if (!creds) throw new Error("No password was provided for this scan.");
        return this.#o.vault.get(creds.passwordRef);
      }
      return this.#o.vault.get(name);
    });
  }

  /** Captures evidence for the page as it is now, registers the state, runs step detectors. */
  async #record(
    step: Step | undefined,
    mark: RecorderMark,
    happy: boolean,
  ): Promise<{ candidates: Candidate[]; capture?: StateCapture; state?: PageState }> {
    const { page, recorder, evidence, states, session } = this.#o;
    if (page.isClosed() || this.#o.captureSteps === false) return { candidates: [] };
    let capture: StateCapture;
    const proposedId = newId("st");
    try {
      capture = await captureState(page, recorder, mark, evidence, proposedId, {
        timing: step?.action.type === "goto" || step?.action.type === "reload",
      });
    } catch {
      return { candidates: [] };
    }
    const { state, isNew } = states.register({
      id: proposedId,
      url: capture.url,
      snapshot: capture.snapshot,
      title: capture.title,
      session,
      evidenceIds: evidenceList(capture),
    });
    if (step) step.afterEvidenceIds = evidenceList(capture);
    this.#last = { capture, state };
    this.snapshots.set(capture.evidence.snapshot, capture.snapshot);
    if (this.#o.detectors === "off" || capture.url.startsWith("chrome-error://")) {
      return { candidates: [], capture, state };
    }
    const ctxState: PageState = { ...state, url: capture.url, evidenceIds: evidenceList(capture) };
    const detected = await runStepDetectors(
      {
        page,
        state: ctxState,
        capture,
        origin: this.#o.policy.origin,
        evidence,
        mobileViewport: this.#o.mobileViewport,
      },
      { newState: isNew && this.#o.detectors !== "log", happy, desktopViewport: this.#o.viewport },
    );
    const stepIds = this.steps.map((s) => s.id);
    const candidates = detected.candidates.map((c) => ({
      ...c,
      journeyId: this.#o.journeyId,
      stepIds,
      session,
    }));
    return { candidates, capture, state };
  }
}

/** A recorded action as the executor accepts it again (replays, edge variants). Checks go through check(). */
export function toAgentAction(a: Action): AgentAction | undefined {
  switch (a.type) {
    case "check":
      return undefined;
    case "click":
      return { type: "click", target: a.target, clickCount: a.clickCount };
    default:
      return a;
  }
}

export function evidenceList(c: StateCapture): string[] {
  const e = c.evidence;
  return [e.screenshot, e.snapshot, e.network, e.console, e.pageErrors, e.timing];
}

/** A same-origin path for `goto`, or undefined if the input points elsewhere. */
export function sameOriginPath(input: string, origin: string): string | undefined {
  try {
    const url = new URL(input, origin);
    if (url.origin !== new URL(origin).origin) return undefined;
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function fallbackAction(a: AgentAction): Action {
  switch (a.type) {
    case "click":
    case "fill":
    case "select":
      return a.type === "click"
        ? {
            type: "click",
            target: isRef(a.target)
              ? { by: "css", selector: `[aria-ref=${a.target.ref}]` }
              : a.target,
          }
        : a.type === "fill"
          ? {
              type: "fill",
              target: isRef(a.target)
                ? { by: "css", selector: `[aria-ref=${a.target.ref}]` }
                : a.target,
              value: a.value,
            }
          : {
              type: "select",
              target: isRef(a.target)
                ? { by: "css", selector: `[aria-ref=${a.target.ref}]` }
                : a.target,
              option: a.option,
            };
    default:
      return a as Action;
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function firstLine(err: unknown): string {
  return ((err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "").slice(0, 200);
}
