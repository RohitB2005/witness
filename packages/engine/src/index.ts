// @witness/engine — public entry point: runScan(config, deps) → RunResult.
// Phases run in order and emit typed events. P1 implements preflight → map (crawl + detectors) → report;
// the AI stages (plan, explore) and verification arrive in P2/P3.
import type { Browser } from "playwright";
import { BUDGETS, TIME_SPLIT } from "./config/budgets";
import { launchBrowser, observeContexts } from "./browser/context";
import { SafetyPolicy } from "./browser/policy";
import type { SecretVault } from "./browser/vault";
import { crawl } from "./crawl/crawler";
import { brokenLinkCandidate, isBrokenStatus } from "./detectors/brokenlink";
import { toCandidate } from "./detectors/registry";
import { secHeaderCandidates } from "./detectors/secheaders";
import { securityCandidates } from "./detectors/security";
import { ResponseObserver } from "./record/responses";
import { fanOut, log, type EventSink, type Phase } from "./events";
import { newRunId } from "./ids";
import { preflight } from "./preflight/preflight";
import { EvidenceWriter } from "./record/evidence";
import { buildFindings, compareFindings } from "./report/findings";
import { writeFindings, type WriterMetrics } from "./report/writer";
import { uxReview } from "./report/ux";
import { readinessVerdict } from "./report/verdict";
import type { RunStore } from "./store/run-store";
import type { Candidate, Journey, PageState, RunResult, ScanConfig } from "./types";
import { runAiStages, type AiStagesOutput } from "./ai-stages";
import type { Models } from "./llm/settings";
import { StateRegistry } from "./explore/states";
import { verify, type VerifyOutput } from "./verify";
import { runProbes, type ProbeResult } from "./probes";
import { injectionNotes } from "./report/notes";
import { criteriaCoverage, notFoundCandidates, type NotFoundResult } from "./report/requirements";

export * from "./types";
export * from "./events";
export { BUDGETS } from "./config/budgets";
export { resolveScanConfig, ConfigError, parseTargetUrl, defaultMode } from "./config/schema";
export type { ScanInput } from "./config/schema";
export { SecretVault } from "./browser/vault";
export { SafetyPolicy } from "./browser/policy";
export { JsonRunStore } from "./store/json-store";
export type { RunStore, Suppression, RunSummary } from "./store/run-store";
export { renderMarkdown } from "./report/markdown";
export { renderHtml } from "./report/html";
export { exportTests } from "./export/playwright";
export { writeRunExports, type ExportFormat } from "./export/write";
export { readinessVerdict } from "./report/verdict";
export { newRunId, RUN_ID_PATTERN } from "./ids";

export { llmSettingsFromEnv, createModels, LlmConfigError } from "./llm/settings";
export type { LlmSettings, Models } from "./llm/settings";
export { CheckSchema as StoredCheckSchema, CHECK_LANGUAGE_DOC } from "./oracle/language";

export const ENGINE_PHASE = "P3-verification" as const;

export interface RunScanDeps {
  store: RunStore;
  vault: SecretVault;
  sink?: EventSink;
  runId?: string;
  /** Inject a browser (tests); otherwise one is launched and closed by the scan. */
  browser?: Browser;
  /** LLM models for the AI stages. Without them, AI pipelines degrade to deterministic (NFR-3). */
  models?: Models;
  /** Why models are missing (e.g. no API key), for the report. */
  modelsUnavailable?: string;
  /** Response cache folder (default: .witness-cache in the working directory). */
  llmCacheDir?: string;
  /** WITNESS_MAX_COST_USD: the run's cap is the lower of this and the budget preset's. */
  maxCostUsd?: number;
}

export async function runScan(config: ScanConfig, deps: RunScanDeps): Promise<RunResult> {
  const runId = deps.runId ?? newRunId();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const budget = BUDGETS[config.budget];
  const origin = new URL(config.url).origin;
  await deps.store.createRun(runId, { url: config.url, startedAt });
  const sink = fanOut(
    (e) => void deps.store.appendEvent(runId, e).catch(() => undefined),
    deps.sink ?? (() => {}),
  );
  const phase = (p: Phase) => sink({ t: "phase", phase: p, at: new Date().toISOString() });
  const evidence = new EvidenceWriter(deps.store, runId);
  const policy = new SafetyPolicy({
    origin,
    mode: config.mode,
    onBlock: (b) => log(sink, "info", `Blocked ${b.method} ${b.url} (${b.reason})`),
  });

  const { credentials, ...publicConfig } = config;
  const base: Omit<RunResult, "finishedAt" | "verdict" | "notTested" | "findings" | "stats"> = {
    runId,
    config: { ...publicConfig, loggedInAs: credentials?.username },
    scope: origin,
    startedAt,
    journeys: [],
    states: [],
  };
  const stats = (extra: Partial<RunResult["stats"]> = {}): RunResult["stats"] => ({
    pages: 0,
    steps: 0,
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    candidates: 0,
    discarded: 0,
    durationMs: Date.now() - started,
    capsHit: [],
    ...extra,
  });

  const browser = deps.browser ?? (await launchBrowser());
  // Sees every response of the run (not replays) for the security detectors (ADDENDUM A1, A3, A4).
  const observer = new ResponseObserver(origin, evidence);
  const unobserve = observeContexts(browser, observer);
  try {
    // ---- Preflight
    phase("preflight");
    const pre = await preflight({ browser, config, policy, vault: deps.vault, evidence });
    if (!pre.ok) {
      const result: RunResult = {
        ...base,
        finishedAt: new Date().toISOString(),
        verdict: { level: "not_ready", reason: `The scan couldn't run: ${pre.message}` },
        notTested: ["Everything: the scan stopped at preflight."],
        findings: [],
        stats: stats(),
        error: pre.message,
      };
      sink({ t: "error", message: pre.message });
      await deps.store.saveResult(result);
      phase("done");
      sink({ t: "done", verdict: result.verdict });
      return result;
    }
    if (pre.session) log(sink, "info", `Logged in. ${pre.session.signal}`);

    // ---- Map: crawl + page detectors
    phase("map");
    const crawled = await crawl({
      browser,
      policy,
      evidence,
      sink,
      startUrl: pre.startUrl,
      viewport: config.viewport,
      mobileViewport: config.mobileViewport,
      pageBudget: budget.pages,
      deadline: started + budget.wallClockMs - 30_000, // keep time to write the report
      session: pre.session?.storageState,
      landingUrl: pre.session?.landingUrl,
    });
    for (const e of crawled.detectorErrors)
      log(sink, "warn", `${e.detectorId} failed on a page: ${e.message}`);

    // Site-level detectors
    const candidates: Candidate[] = [...crawled.candidates];
    const startState = crawled.states[0];
    const siteState = {
      id: startState?.id ?? "",
      url: pre.startUrl,
      routePattern: startState?.routePattern ?? new URL(pre.startUrl).pathname,
      session: "anonymous" as const,
      evidenceIds: startState ? [startState.evidenceIds[0]!] : [],
    };
    for (const link of crawled.links.filter((l) => isBrokenStatus(l.status))) {
      const src = link.sources[0]!;
      candidates.push(
        toCandidate(brokenLinkCandidate(link), {
          ...siteState,
          url: src.url,
          routePattern: src.routePattern,
          evidenceIds: [],
        }),
      );
    }
    for (const draft of secHeaderCandidates({
      url: pre.startUrl,
      headers: pre.headers,
      cookies: pre.cookies,
      evidenceId: pre.headersEvidenceId,
    })) {
      // Preflight reads cookies after logging in, so a cookie finding is re-checked logged in too.
      const cookie =
        draft.signature.kind === "detector" && draft.signature.key.startsWith("cookie|");
      candidates.push(
        toCandidate(draft, {
          ...siteState,
          session: cookie && pre.session ? "authenticated" : "anonymous",
        }),
      );
    }

    for (const c of candidates) {
      sink({
        t: "candidate",
        candidate: { id: c.id, category: c.category, summary: c.summary, route: c.route },
      });
    }

    // ---- Automatic probes (sort, sweep, reflected input) run alongside the AI stages: their own
    // read-only browsers, no LLM (D46).
    const registry = new StateRegistry(crawled.states);
    const probing: Promise<ProbeResult | undefined> = runProbes({
      browser,
      policy,
      evidence,
      store: deps.store,
      runId,
      vault: deps.vault,
      sink,
      mode: config.mode,
      viewport: config.viewport,
      mobileViewport: config.mobileViewport,
      credentials: config.credentials,
      session: pre.session?.storageState,
      states: registry,
      crawl: {
        states: crawled.states,
        snapshots: crawled.snapshots,
        linkUrls: crawled.links.map((l) => l.url),
      },
      deadline: started + Math.round(budget.wallClockMs * TIME_SPLIT.edgeEnd),
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === "ReplayGuardError") throw err;
      log(sink, "warn", `The automatic checks failed: ${String(err).split("\n")[0]}`);
      return undefined;
    });

    // ---- AI stages: plan → explore → edge inputs. Any failure degrades to deterministic findings (NFR-3).
    let aiStagesSkipped: string | undefined;
    let ai: AiStagesOutput | undefined;
    if (config.pipeline !== "deterministic") {
      if (!deps.models) {
        aiStagesSkipped = `The AI stages were skipped: ${deps.modelsUnavailable ?? "no LLM is configured"}. This report has the deterministic findings only.`;
        log(sink, "warn", aiStagesSkipped);
      } else {
        try {
          ai = await runAiStages({
            config,
            budget,
            started,
            runId,
            browser,
            policy,
            evidence,
            store: deps.store,
            vault: deps.vault,
            sink,
            pre,
            crawled,
            states: registry,
            crawlCandidates: [...candidates],
            models: deps.models,
            cacheDir: deps.llmCacheDir ?? ".witness-cache",
            costCapUsd: Math.min(budget.llmUsd, deps.maxCostUsd ?? Infinity),
          });
          candidates.push(...ai.candidates);
          aiStagesSkipped = ai.aiStagesSkipped;
        } catch (err) {
          // A secret-leak or replay-guard error is a bug: fail loudly rather than degrade quietly.
          if (
            err instanceof Error &&
            (err.name === "SecretLeakError" || err.name === "ReplayGuardError")
          )
            throw err;
          aiStagesSkipped = `The AI stages stopped with an error (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). This report has the deterministic findings only.`;
          log(sink, "warn", aiStagesSkipped);
        }
      }
    }
    const probes = await probing;
    if (probes) candidates.push(...probes.candidates);

    // ---- Security detectors over everything the run saw: secrets, DB errors, private data without login.
    const security = await securityCandidates({
      observer,
      browser,
      policy,
      evidence,
      viewport: config.viewport,
      states: crawled.states,
      snapshots: crawled.snapshots,
      deadline: started + budget.wallClockMs - TIME_SPLIT.reportReserveMs,
    }).catch((err: unknown) => {
      log(sink, "warn", `The security checks failed: ${String(err).split("\n")[0]}`);
      return undefined;
    });
    unobserve();

    // ---- Requirements the app doesn't seem to have (ADDENDUM A5): every recorded page is searched.
    let notFound: NotFoundResult | undefined;
    if (ai?.criteria?.length) {
      const pages = [
        ...crawled.states.map((s) => ({
          url: s.url,
          route: s.routePattern,
          text: crawled.snapshots.get(s.id) ?? "",
        })),
        ...registry.added.map((s) => ({
          url: s.url,
          route: s.routePattern,
          text: registry.texts.get(s.id) ?? "",
        })),
      ];
      notFound = await notFoundCandidates({
        criteria: ai.criteria,
        pages,
        startUrl: pre.startUrl,
        session: pre.session ? "authenticated" : "anonymous",
        evidence,
      });
      candidates.push(...notFound.candidates);
    }
    if (security) {
      candidates.push(...security.candidates);
      for (const c of security.candidates)
        sink({
          t: "candidate",
          candidate: { id: c.id, category: c.category, summary: c.summary, route: c.route },
        });
    }
    const journeys = [...(ai?.journeys ?? []), ...(probes?.journeys ?? [])];
    const allStates = [...crawled.states, ...registry.added];

    // ---- Verify: evidence, replay (no LLM), judge, skeptic, suppression → tiers (FR-8)
    phase("verify");
    let verification: VerifyOutput | undefined;
    try {
      verification = await verify({
        candidates,
        journeys,
        states: allStates,
        pipeline: config.pipeline,
        gateway: ai?.gateway,
        replay: {
          browser,
          policy,
          evidence,
          store: deps.store,
          runId,
          vault: deps.vault,
          sink,
          mode: config.mode,
          viewport: config.viewport,
          mobileViewport: config.mobileViewport,
          credentials: config.credentials,
          loginUrl: pre.loginUrl,
          states: registry,
        },
        deadline: started + budget.wallClockMs - TIME_SPLIT.reportReserveMs,
        suppressions: await deps.store.getSuppressions(origin).catch(() => []),
      });
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "SecretLeakError" || err.name === "ReplayGuardError")
      )
        throw err;
      log(
        sink,
        "warn",
        `Verification stopped with an error (${err instanceof Error ? err.message.split("\n")[0] : String(err)}); findings are reported as not verified.`,
      );
    }

    // ---- Report: findings, then the writer (fact-checked) and the UX reviewer, side by side
    phase("report");
    const buildCtx = {
      accountLabel: credentials ? `the account ${credentials.username}` : undefined,
      mobileViewport: config.mobileViewport,
      pipeline: config.pipeline,
      journeys,
      verdicts: verification?.verdicts,
    };
    const findings = buildFindings(candidates, buildCtx);
    const criteria = ai?.criteria
      ? criteriaCoverage({
          criteria: ai.criteria,
          journeys,
          candidates,
          findings,
          mentioned: notFound?.mentioned ?? new Map(),
        })
      : undefined;
    const gateway = ai?.gateway;
    const reportDeadline = started + budget.wallClockMs - 3_000;
    let writer: WriterMetrics | undefined;
    const reportMetrics: Record<string, number> = {};
    if (gateway && config.pipeline !== "deterministic") {
      const uxPages = keyPages(crawled, journeys).map((state) => ({
        state,
        snapshot: crawled.snapshots.get(state.id) ?? "",
      }));
      const [w, ux] = await Promise.all([
        writeFindings(
          gateway,
          findings.filter((f) => f.kind === "bug" && f.tier !== "discarded").slice(0, 16),
          reportDeadline,
        ).catch(() => undefined),
        config.budget === "quick" || Date.now() > reportDeadline - 15_000
          ? undefined
          : uxReview(gateway, uxPages).catch(() => undefined),
      ]);
      writer = w;
      if (ux) {
        findings.push(...buildFindings(ux.candidates, buildCtx));
        findings.sort(compareFindings);
        reportMetrics["ux.proposed"] = ux.proposed;
        reportMetrics["ux.dropped"] = ux.dropped;
      }
      if (writer) {
        reportMetrics["reporter.written"] = writer.written;
        reportMetrics["reporter.factCheckFailures"] = writer.factCheckFailures;
        reportMetrics["reporter.templateFallbacks"] = writer.templateFallbacks;
      }
    }
    for (const f of findings) {
      sink({
        t: "finding",
        finding: { id: f.id, title: f.title, tier: f.tier, severity: f.severity, kind: f.kind },
      });
    }
    const capsHit = [...new Set([...crawled.capsHit, ...(ai?.capsHit ?? [])])];
    const notTested = whatWasntTested({
      loginDetected: pre.loginDetected,
      loggedIn: !!pre.session,
      notVisited: crawled.notVisited,
      capsHit,
      pageBudget: budget.pages,
      journeys,
      aiStagesSkipped,
    });
    notTested.push(...(probes?.notTested ?? []));
    if (config.requirements?.trim() && !criteria)
      notTested.push(
        "The requirements weren't checked: the AI stages that split them into criteria didn't run.",
      );
    const untested = criteria?.filter((c) => c.status === "not_tested").length ?? 0;
    if (untested)
      notTested.push(
        `${untested} acceptance criteri${untested === 1 ? "on was" : "a were"} not tested (see Requirements coverage).`,
      );
    const notReplayed = verification?.funnel["verify.notReplayed"] ?? 0;
    if (notReplayed && config.pipeline !== "ai-no-verify")
      notTested.push(
        `${notReplayed} finding${notReplayed === 1 ? " wasn't" : "s weren't"} replayed, because the time for verifying ran out; ${notReplayed === 1 ? "it is" : "they are"} marked Needs review.`,
      );
    const journeysAttempted = journeys.some((j) => !j.automatic && (j.steps?.length ?? 0) > 0);
    await ai?.flushLogs();
    const llm = ai?.gateway.totals;
    const result: RunResult = {
      ...base,
      journeys,
      states: allStates,
      finishedAt: new Date().toISOString(),
      verdict: readinessVerdict({ findings, journeys, journeysAttempted, criteria }),
      notTested,
      findings,
      stats: stats({
        pages: crawled.states.length,
        steps: ai?.steps ?? 0,
        llmCalls: llm?.calls ?? 0,
        inputTokens: llm?.inputTokens ?? 0,
        outputTokens: llm?.outputTokens ?? 0,
        costUsd: llm?.costUsd ?? 0,
        candidates: candidates.length,
        discarded: findings.filter((f) => f.tier === "discarded").length,
        capsHit,
      }),
      aiStagesSkipped,
      loginPath: pre.loginUrl ? new URL(pre.loginUrl).pathname : undefined,
      notes: injectionNotes(
        crawled.states.map((s) => ({
          route: s.routePattern,
          snapshot: crawled.snapshots.get(s.id) ?? "",
        })),
      ),
      aiMetrics:
        ai?.metrics || verification || probes || security
          ? {
              ...(ai?.metrics ?? {}),
              ...(probes?.metrics ?? {}),
              ...(security?.metrics ?? {}),
              ...(verification?.funnel ?? {}),
              ...reportMetrics,
            }
          : undefined,
      appModel: ai?.appModel,
      ...(criteria
        ? {
            requirements: {
              criteria,
              droppedCriteria: Number(ai?.metrics["plan.criteriaDroppedQuote"] ?? 0),
            },
          }
        : {}),
    };
    await deps.store.saveResult(result);
    phase("done");
    sink({ t: "done", verdict: result.verdict });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sink({ t: "error", message });
    const result: RunResult = {
      ...base,
      finishedAt: new Date().toISOString(),
      verdict: { level: "not_ready", reason: `The scan failed: ${message}` },
      notTested: ["Everything after the failure."],
      findings: [],
      stats: stats(),
      error: message,
    };
    await deps.store.saveResult(result).catch(() => undefined);
    return result;
  } finally {
    unobserve();
    if (!deps.browser) await browser.close().catch(() => undefined);
  }
}

/** Up to 6 key pages for the UX reviewer: the start page, then pages on core journeys, then the rest. */
function keyPages(crawled: { states: PageState[] }, journeys: Journey[]): PageState[] {
  const core = new Set(
    journeys
      .filter((j) => j.priority === "core" && !j.automatic)
      .flatMap((j) => (j.steps ?? []).map((s) => new URL(s.urlAfter).pathname)),
  );
  const ok = crawled.states.filter((s) => (s.status ?? 200) < 400 || s.appRendered);
  const ordered = [
    ...ok.slice(0, 1),
    ...ok.filter((s) => core.has(new URL(s.url).pathname)),
    ...ok,
  ];
  const seen = new Set<string>();
  return ordered.filter((s) => !seen.has(s.routePattern) && !!seen.add(s.routePattern)).slice(0, 6);
}

export function whatWasntTested(i: {
  loginDetected: boolean;
  loggedIn: boolean;
  notVisited: string[];
  capsHit: string[];
  pageBudget: number;
  journeys?: Journey[];
  aiStagesSkipped?: string;
}): string[] {
  const out: string[] = [];
  const journeys = i.journeys ?? [];
  if (!journeys.some((j) => !j.automatic && (j.steps?.length ?? 0) > 0)) {
    out.push(
      "User journeys (filling forms, buttons, multi-step flows): only page loads were checked in this run.",
    );
  }
  for (const j of journeys) {
    if (j.status === "completed") continue;
    const what = j.status === "skipped" ? "wasn't run" : "wasn't completed";
    out.push(
      `Journey "${j.title}" (${j.priority}) ${what}${j.incompleteReason ? `: ${j.incompleteReason}` : "."}`,
    );
  }
  if (i.aiStagesSkipped && journeys.length) out.push(i.aiStagesSkipped);
  if (i.capsHit.includes("llm-spend"))
    out.push("The AI spend cap was reached, so some AI work was not done.");
  if (i.loginDetected && !i.loggedIn) {
    out.push("Pages behind the login: no credentials were given.");
  }
  if (i.notVisited.length) {
    const why = i.capsHit.includes("wall-clock")
      ? "the time limit was reached"
      : `the page budget (${i.pageBudget}) was reached`;
    const sample = i.notVisited
      .slice(0, 5)
      .map((u) => new URL(u).pathname)
      .join(", ");
    out.push(
      `${i.notVisited.length} linked page(s) weren't visited because ${why}: ${sample}${i.notVisited.length > 5 ? ", …" : ""}`,
    );
  }
  return out;
}
