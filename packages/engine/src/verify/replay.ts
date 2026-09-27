// Replay verification (SPEC FR-8, ARCHITECTURE.md §6). A candidate's recorded steps run again in a fresh
// browser, with no LLM (the gateway throws inside `withoutLlm`), and code checks whether the same signature
// shows up again: the same failing check, the same request status, the same page error, the same detector
// finding.
//
// - Logged-in candidates log in first (the preamble); a replay never reuses a session captured earlier (D37).
// - Candidates from one recorded path share a replay: the longest path runs once per attempt and each
//   candidate is judged at the step where it arose.
// - Two attempts; a third only when they disagree (D49). A static finding (no steps) is re-run once on a
//   fresh load (FR-8).
// - Paths that wrote data (a same-origin POST/PUT/PATCH/DELETE when recorded) replay one at a time, after
//   the read-only ones, so two replays never change the same account's data at once (D50's reasoning).
import type { Browser, BrowserContext, Page } from "playwright";
import { LIMITS } from "../config/budgets";
import { createContext } from "../browser/context";
import type { SafetyPolicy } from "../browser/policy";
import type { SecretVault } from "../browser/vault";
import { routePattern } from "../crawl/normalise";
import { fetchWithoutLogin, shapeHash } from "../detectors/authz";
import { brokenLinkCandidate, isBrokenStatus } from "../detectors/brokenlink";
import { findDbError } from "../detectors/dberror";
import { findSecrets } from "../detectors/secrets";
import { http4xxDetector } from "../detectors/http4xx";
import { PAGE_DETECTORS, toCandidate } from "../detectors/registry";
import { secHeaderCandidates } from "../detectors/secheaders";
import type { PageDetector } from "../detectors/types";
import type { EventSink } from "../events";
import { Executor, evidenceList, toAgentAction } from "../explore/executor";
import type { StateRegistry } from "../explore/states";
import { newId } from "../ids";
import { withoutLlm } from "../llm/guard";
import { evaluateCheck, type CheckResult } from "../oracle/evaluate";
import { logIn } from "../preflight/preflight";
import { captureState, type EvidenceWriter } from "../record/evidence";
import { PageRecorder, type NetworkEntry, type RecorderMark } from "../record/recorder";
import type { RunStore } from "../store/run-store";
import type { Candidate, PageState, ScanMode, Step } from "../types";

export interface ReplayDeps {
  browser: Browser;
  policy: SafetyPolicy;
  evidence: EvidenceWriter;
  store: RunStore;
  runId: string;
  vault: SecretVault;
  sink: EventSink;
  mode: ScanMode;
  viewport: { width: number; height: number };
  mobileViewport: { width: number; height: number };
  credentials?: { username: string; passwordRef: string };
  loginUrl?: string;
  states: StateRegistry;
  /** Every recorded step, by id. */
  steps: Map<string, Step>;
  /** Epoch ms: no attempt starts after this. */
  deadline: number;
  /** Parallel read-only replays (default 3). Write replays always run one at a time. */
  lanes?: number;
  /** Called as soon as a target's replays are finished (the judge and skeptic can start right away). */
  onDone?: (key: string, result: ReplayResult) => void;
}

export interface ReplayTarget {
  key: string;
  candidate: Candidate;
  /** Lower replays first: what could reach Confirmed goes before what can't. */
  priority: number;
}

export interface ReplayResult {
  attempts: number;
  reproduced: number;
  skipped?: string;
  notes: string[];
  /** Evidence recorded during the replays (check results, captured states). */
  evidenceIds: string[];
}

interface UnitTarget {
  target: ReplayTarget;
  /** Index in the unit's steps after which this candidate is judged (-1: static). */
  at: number;
}

interface Unit {
  kind: "path" | "static";
  session: Candidate["session"];
  steps: Step[];
  targets: UnitTarget[];
  writes: boolean;
  priority: number;
}

interface AttemptOutcome {
  ok: boolean;
  note?: string;
  evidenceId?: string;
}

/** Couldn't even start (e.g. the login failed), or took too long: not counted as an attempt. */
class ReplayInfraError extends Error {}

/** Hard caps per attempt (SECURITY T9): a replay can never hang the run. */
const ATTEMPT_TIMEOUT_MS = { static: 45_000, path: 90_000 } as const;

/** The browser context an attempt opened, so a timeout can close it. */
interface Holder {
  context?: BrowserContext;
}

async function withTimeout<T>(ms: number, holder: Holder, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void holder.context?.close().catch(() => undefined);
      reject(new ReplayInfraError(`the replay took longer than ${ms / 1000} s and was stopped`));
    }, ms);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALL_DETECTORS: readonly PageDetector[] = [...PAGE_DETECTORS, http4xxDetector];

export async function replayTargets(
  targets: ReplayTarget[],
  deps: ReplayDeps,
): Promise<Map<string, ReplayResult>> {
  const results = new Map<string, ReplayResult>(
    targets.map((t) => [t.key, { attempts: 0, reproduced: 0, notes: [], evidenceIds: [] }]),
  );
  return withoutLlm("replay verification", async () => {
    const units = await buildUnits(targets, deps, results);
    const done = (u: Unit) => {
      for (const t of u.targets) deps.onDone?.(t.target.key, results.get(t.target.key)!);
    };
    // Priority bands (what could reach Confirmed first): within a band, read-only replays run in parallel,
    // then the ones that write data run one at a time, so no two replays change the same data at once.
    for (const band of [...new Set(units.map((u) => u.priority))].sort((a, b) => a - b)) {
      const inBand = units.filter((u) => u.priority === band);
      await lanes(
        inBand.filter((u) => !u.writes),
        deps.lanes ?? 3,
        async (u) => {
          await runUnit(u, deps, results);
          done(u);
        },
      );
      await lanes(
        inBand.filter((u) => u.writes),
        1,
        async (u) => {
          await runUnit(u, deps, results);
          done(u);
        },
      );
    }
    for (const r of results.values())
      if (r.attempts === 0 && !r.skipped) r.skipped = "the time for verifying ran out";
    return results;
  });
}

// ---------------------------------------------------------------------------------------------
// Units

async function buildUnits(
  targets: ReplayTarget[],
  deps: ReplayDeps,
  results: Map<string, ReplayResult>,
): Promise<Unit[]> {
  const units: Unit[] = [];
  // Longest paths first, so shorter paths from the same recording attach to them.
  const withSteps = targets
    .map((t) => ({ t, steps: pathOf(t.candidate, deps.steps) }))
    .sort((a, b) => (b.steps?.length ?? -1) - (a.steps?.length ?? -1));
  for (const { t, steps } of withSteps) {
    const unrepeatable = unrepeatableRequest(t.candidate);
    if (unrepeatable) {
      results.get(t.key)!.skipped = unrepeatable;
      continue;
    }
    if (!t.candidate.stepIds.length) {
      units.push({
        kind: "static",
        session: t.candidate.session,
        steps: [],
        targets: [{ target: t, at: -1 }],
        writes: false,
        priority: t.priority,
      });
      continue;
    }
    if (!steps || !steps.length) {
      results.get(t.key)!.skipped = "its steps weren't recorded";
      continue;
    }
    const host = units.find(
      (u) =>
        u.kind === "path" &&
        u.session === t.candidate.session &&
        u.steps.length >= steps.length &&
        steps.every((s, i) => u.steps[i]!.id === s.id),
    );
    if (host) {
      host.targets.push({ target: t, at: steps.length - 1 });
      host.priority = Math.min(host.priority, t.priority);
    } else {
      units.push({
        kind: "path",
        session: t.candidate.session,
        steps,
        targets: [{ target: t, at: steps.length - 1 }],
        writes: await pathWrites(steps, deps),
        priority: t.priority,
      });
    }
  }
  return units.sort((a, b) => a.priority - b.priority || a.steps.length - b.steps.length);
}

/** The candidate's recorded steps that did something (failed actions and unevaluable checks are skipped). */
function pathOf(c: Candidate, all: Map<string, Step>): Step[] | undefined {
  const steps: Step[] = [];
  for (const id of c.stepIds) {
    const s = all.get(id);
    if (!s) return undefined;
    const isOwnCheck =
      s.action.type === "check" &&
      c.signature.kind === "check_failed" &&
      s.action.expectationId === c.signature.expectationId;
    if (s.ok || isOwnCheck) steps.push(s);
  }
  return steps;
}

async function pathWrites(steps: Step[], deps: ReplayDeps): Promise<boolean> {
  for (const s of steps) {
    const id = s.afterEvidenceIds[2];
    if (!id) continue;
    const ev = await deps.store.getEvidence(deps.runId, id).catch(() => undefined);
    const entries = ((ev?.data as { entries?: NetworkEntry[] } | undefined)?.entries ??
      []) as NetworkEntry[];
    if (
      entries.some((e) => e.sameOrigin && WRITE.has(e.method.toUpperCase()) && !e.blockedByPolicy)
    )
      return true;
  }
  return false;
}

async function lanes<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, queue.length)) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

async function runUnit(u: Unit, deps: ReplayDeps, results: Map<string, ReplayResult>) {
  const maxAttempts = u.kind === "static" ? 1 : 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const disagreeing = (t: UnitTarget) => {
      const r = results.get(t.target.key)!;
      return r.attempts === 2 && r.reproduced === 1;
    };
    // D49: a third attempt only for candidates whose first two disagreed.
    const active = attempt === 3 ? u.targets.filter(disagreeing) : u.targets;
    if (!active.length) return;
    if (Date.now() > deps.deadline) {
      for (const t of active)
        if (results.get(t.target.key)!.attempts === 0)
          results.get(t.target.key)!.skipped = "the time for verifying ran out";
      return;
    }
    let outcome: Map<string, AttemptOutcome>;
    const holder: Holder = {};
    try {
      outcome = await withTimeout(ATTEMPT_TIMEOUT_MS[u.kind], holder, () =>
        u.kind === "static" ? attemptStatic(u, deps, holder) : attemptPath(u, active, deps, holder),
      );
    } catch (err) {
      const why =
        err instanceof ReplayInfraError
          ? err.message
          : `the replay failed to run (${firstLine(err)})`;
      for (const t of active) {
        const r = results.get(t.target.key)!;
        if (r.attempts === 0) r.skipped = why;
        else r.notes.push(`Attempt ${attempt}: ${why}`);
      }
      return;
    }
    for (const t of active) {
      const r = results.get(t.target.key)!;
      const o = outcome.get(t.target.key) ?? { ok: false, note: "not evaluated" };
      r.attempts++;
      if (o.ok) r.reproduced++;
      if (o.note) r.notes.push(`Attempt ${attempt}: ${o.note}`);
      if (o.evidenceId) r.evidenceIds.push(o.evidenceId);
      deps.sink({
        t: "verify",
        candidateId: t.target.candidate.id,
        stage: "replay",
        detail: `Replay ${attempt}: ${o.ok ? "reproduced" : "not reproduced"}${o.note ? ` (${o.note})` : ""}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Attempts

async function openPage(deps: ReplayDeps, session: Candidate["session"], holder: Holder) {
  const context = await createContext(deps.browser, {
    policy: deps.policy,
    viewport: deps.viewport,
    observe: false,
  });
  holder.context = context;
  const page = await context.newPage();
  const recorder = new PageRecorder(page, deps.policy);
  if (session === "authenticated") {
    if (!deps.credentials || !deps.loginUrl) {
      await context.close().catch(() => undefined);
      throw new ReplayInfraError("no login details, so the logged-in steps couldn't be replayed");
    }
    const login = await logIn(
      page,
      recorder,
      {
        policy: deps.policy,
        vault: deps.vault,
        evidence: deps.evidence,
        credentials: deps.credentials,
      },
      deps.loginUrl,
    );
    if (!login.ok) {
      await context.close().catch(() => undefined);
      throw new ReplayInfraError("the replay couldn't log in");
    }
  }
  return { context, page, recorder };
}

async function attemptPath(
  u: Unit,
  active: UnitTarget[],
  deps: ReplayDeps,
  holder: Holder,
): Promise<Map<string, AttemptOutcome>> {
  const out = new Map<string, AttemptOutcome>();
  const { context, page, recorder } = await openPage(deps, u.session, holder);
  try {
    const start = recorder.mark();
    const ex = new Executor({
      page,
      recorder,
      evidence: deps.evidence,
      vault: deps.vault,
      policy: deps.policy,
      mode: deps.mode,
      journeyId: "replay",
      kind: "happy",
      session: u.session,
      states: deps.states,
      viewport: deps.viewport,
      mobileViewport: deps.mobileViewport,
      credentials: deps.credentials,
      detectors: "off",
      captureSteps: false,
    });
    const last = Math.max(...active.map((t) => t.at));
    for (let i = 0; i <= last; i++) {
      const step = u.steps[i]!;
      const here = active.filter((t) => t.at === i);
      let own: { result: CheckResult; evidenceId: string } | undefined;
      if (step.action.type === "check") {
        const expectationId = step.action.expectationId;
        const successCheck = here.find(
          (t) =>
            t.target.candidate.successCheck &&
            t.target.candidate.source.kind === "check" &&
            t.target.candidate.source.expectationId === expectationId,
        )?.target.candidate.successCheck;
        const r = await ex.check(step.action.check, { expectationId, successCheck });
        own = { result: r.result, evidenceId: r.evidenceId };
      } else {
        const r = await ex.act(toAgentAction(step.action)!, { kind: step.kind });
        if (!r.ok) {
          for (const t of active)
            if (t.at >= i && !out.has(t.target.key))
              out.set(t.target.key, {
                ok: false,
                note: `step ${i + 1} ("${step.description}") failed: ${r.message}`,
              });
          break;
        }
      }
      for (const t of here) {
        out.set(
          t.target.key,
          await judgeTarget(t.target.candidate, { page, recorder, start, ex, own, step, deps }),
        );
      }
    }
    return out;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function attemptStatic(
  u: Unit,
  deps: ReplayDeps,
  holder: Holder,
): Promise<Map<string, AttemptOutcome>> {
  const t = u.targets[0]!.target;
  const c = t.candidate;
  const { context, page, recorder } = await openPage(deps, u.session, holder);
  try {
    const start = recorder.mark();
    const id = c.source.kind === "detector" ? c.source.id : undefined;
    if (id === "DET-BROKENLINK" && c.signals.request && !c.check) {
      const res = await context.request
        .get(new URL(c.signals.request.path, deps.policy.origin).href, { maxRedirects: 5 })
        .catch(() => undefined);
      const status = res?.status() ?? 0;
      return new Map([
        [
          t.key,
          {
            ok: isBrokenStatus(status),
            note: `the link target returned ${status || "no response"}`,
            evidenceId: await deps.evidence.put("network", {
              kind: "replay-link-target",
              path: c.signals.request.path,
              status,
            }),
          },
        ],
      ]);
    }
    const byRequest = await attemptByRequest(c, context, page, deps);
    if (byRequest) return new Map([[t.key, byRequest]]);
    const response = await page.goto(c.url, { waitUntil: "domcontentloaded" });
    await recorder.waitForQuiet(LIMITS.crawlQuietCapMs, LIMITS.quietWindowMs);
    if (id === "DET-SECHEADERS") {
      const headers = (await response?.allHeaders()) ?? {};
      const cookies = (await context.cookies(c.url)).map((k) => ({
        name: k.name,
        httpOnly: k.httpOnly,
        secure: k.secure,
        sameSite: k.sameSite,
      }));
      const evidenceId = await deps.evidence.put("network", {
        kind: "document-headers",
        url: page.url(),
        status: response?.status(),
        headers,
      });
      const again = secHeaderCandidates({ url: c.url, headers, cookies, evidenceId });
      return new Map([[t.key, { ok: again.some((d) => d.groupKey === c.groupKey), evidenceId }]]);
    }
    if (c.check) {
      const r = await evaluateCheck(c.check, { page, captures: new Map() });
      const evidenceId = await deps.evidence.put("check_result", {
        url: page.url(),
        replay: true,
        check: c.check,
        status: r.status,
        message: r.message,
        observed: r.observed,
      });
      return new Map([[t.key, { ok: r.status === "fail", note: noteFor(r), evidenceId }]]);
    }
    return new Map([[t.key, await detectAgain(c, { page, recorder, start, deps })]]);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * A DB error seen in the response to a write request (from an edge input) can't be re-sent on its own:
 * replays never repeat a write outside its recorded journey. Such a finding stays "not replayed".
 */
function unrepeatableRequest(c: Candidate): string | undefined {
  if (c.source.kind !== "detector" || c.source.id !== "DET-DBERROR") return undefined;
  if (c.signature.kind !== "detector") return undefined;
  const [where, method] = c.signature.key.split("|");
  return where === "response" && method !== "GET"
    ? `it came from a ${method} request, which replay doesn't send again on its own`
    : undefined;
}

/**
 * Detectors that are re-checked by requesting a URL again (ADDENDUM A1, A3, A4): a secret in a file, a
 * database error in a response or on a page, private data without a login. Undefined for everything else.
 */
async function attemptByRequest(
  c: Candidate,
  context: BrowserContext,
  page: Page,
  deps: ReplayDeps,
): Promise<AttemptOutcome | undefined> {
  if (c.source.kind !== "detector" || c.signature.kind !== "detector") return undefined;
  const key = c.signature.key;
  const origin = deps.policy.origin;
  if (c.source.id === "DET-SECRETS" && c.signals.request) {
    const url = new URL(c.signals.request.path, origin).href;
    const res = await context.request.get(url, { failOnStatusCode: false }).catch(() => undefined);
    const body = (await res?.text().catch(() => "")) ?? "";
    const found = findSecrets(body).some((m) => `${m.patternId}|${m.hash}` === key);
    return {
      ok: found,
      note: found ? "the key is still in the file" : "the key is no longer in the file",
      evidenceId: await deps.evidence.put("network", {
        kind: "replay-secret",
        url,
        status: res?.status(),
        found,
      }),
    };
  }
  if (c.source.id === "DET-DBERROR") {
    const [where, , ...rest] = key.split("|");
    const url = rest.join("|");
    let text: string;
    let status: number | undefined;
    if (where === "response" && url) {
      const res = await context.request
        .get(url, { failOnStatusCode: false })
        .catch(() => undefined);
      status = res?.status();
      text = (await res?.text().catch(() => "")) ?? "";
    } else {
      await page.goto(c.url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
      text = await page
        .locator("body")
        .innerText()
        .catch(() => "");
    }
    const match = findDbError(text);
    return {
      ok: !!match,
      note: match ? `the ${match.db} error is still shown` : "no database error this time",
      evidenceId: await deps.evidence.put("network", {
        kind: "replay-db-error",
        url: where === "response" ? url : page.url(),
        status,
        db: match?.db,
        excerpt: match?.excerpt,
      }),
    };
  }
  if (c.source.id === "DET-AUTHZ") {
    // This attempt's context has no login (the candidate's session is anonymous): no cookies are sent.
    const probe = await fetchWithoutLogin(context.request, c.url).catch(() => ({
      status: 0,
      body: undefined,
    }));
    const expected = key.split("|").pop();
    const ok =
      probe.status === 200 && probe.body !== undefined && shapeHash(probe.body) === expected;
    return {
      ok,
      note: `without a login it returned ${probe.status || "no response"}${ok ? " with the same data" : ""}`,
      evidenceId: await deps.evidence.put("network", {
        kind: "replay-authz",
        url: c.url,
        status: probe.status,
        sameShape: ok,
      }),
    };
  }
  return undefined;
}

async function judgeTarget(
  c: Candidate,
  x: {
    page: Page;
    recorder: PageRecorder;
    start: RecorderMark;
    ex: Executor;
    own?: { result: CheckResult; evidenceId: string };
    step: Step;
    deps: ReplayDeps;
  },
): Promise<AttemptOutcome> {
  // The candidate's own check step was just evaluated at the same point.
  if (
    x.own &&
    c.signature.kind === "check_failed" &&
    x.step.action.type === "check" &&
    x.step.action.expectationId === c.signature.expectationId
  ) {
    return {
      ok: x.own.result.status === "fail",
      note: noteFor(x.own.result),
      evidenceId: x.own.evidenceId,
    };
  }
  // A detector finding that is equivalent to a check (DET-TOTALS, DET-SORT, DET-XSS), or a check candidate
  // judged after its step.
  if (c.check && c.signature.kind !== "http" && c.signature.kind !== "page_error") {
    const r = await x.ex.check(c.check, { successCheck: c.successCheck });
    return { ok: r.result.status === "fail", note: noteFor(r.result), evidenceId: r.evidenceId };
  }
  if (c.signature.kind === "judgement") {
    const same = routePattern(x.page.url()) === c.route;
    return {
      ok: same,
      note: same
        ? "the steps reach the same page"
        : `the steps ended on ${routePattern(x.page.url())}`,
    };
  }
  return detectAgain(c, x);
}

/** Captures the page now and re-runs the detector that found the candidate over everything the replay saw. */
async function detectAgain(
  c: Candidate,
  x: { page: Page; recorder: PageRecorder; start: RecorderMark; deps: ReplayDeps },
): Promise<AttemptOutcome> {
  const id =
    c.source.kind === "detector"
      ? c.source.id
      : c.signature.kind === "page_error"
        ? "DET-PAGEERROR"
        : c.signature.kind === "http"
          ? c.signature.statusClass === "5xx"
            ? "DET-HTTP5XX"
            : "DET-HTTP4XX"
          : undefined;
  const detector = ALL_DETECTORS.find((d) => d.id === id);
  if (!detector) return { ok: false, note: `nothing can re-check ${id ?? c.source.kind}` };
  const stateId = newId("st");
  const capture = await captureState(x.page, x.recorder, x.start, x.deps.evidence, stateId, {
    timing: detector.id === "DET-PERF",
  });
  const state: PageState = {
    id: stateId,
    url: capture.url,
    routePattern: routePattern(capture.url),
    structureHash: "",
    title: capture.title,
    session: c.session,
    evidenceIds: evidenceList(capture),
    discoveredBy: "agent",
  };
  const ctx = {
    page: x.page,
    state,
    capture,
    origin: x.deps.policy.origin,
    evidence: x.deps.evidence,
    mobileViewport: x.deps.mobileViewport,
  };
  if (detector.viewport === "mobile") {
    await x.page.setViewportSize(x.deps.mobileViewport);
    await x.page.waitForTimeout(250);
  }
  const drafts = await detector.run(ctx).catch(() => []);
  if (detector.viewport === "mobile") await x.page.setViewportSize(x.deps.viewport);
  const again = drafts.map((d) => toCandidate(d, state, detector.viewport));
  const hit = again.some((d) => d.groupKey === c.groupKey);
  return {
    ok: hit,
    note: hit ? undefined : `${detector.id} didn't find it again`,
    evidenceId: capture.evidence.screenshot,
  };
}

function noteFor(r: CheckResult): string | undefined {
  if (r.status === "fail") return undefined;
  return r.status === "error"
    ? `couldn't evaluate: ${r.message}`
    : `the check passed: ${r.message}`;
}

function firstLine(err: unknown): string {
  return ((err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "").slice(0, 200);
}

/** Re-exported for tests: a broken-link draft for a target path. */
export { brokenLinkCandidate };
