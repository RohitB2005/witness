// @witness/engine — public entry point: runScan(config, deps) → RunResult.
// Phases run in order and emit typed events. P1 implements preflight → map (crawl + detectors) → report;
// the AI stages (plan, explore) and verification arrive in P2/P3.
import type { Browser } from "playwright";
import { BUDGETS } from "./config/budgets";
import { launchBrowser } from "./browser/context";
import { SafetyPolicy } from "./browser/policy";
import type { SecretVault } from "./browser/vault";
import { crawl } from "./crawl/crawler";
import { brokenLinkCandidate, isBrokenStatus } from "./detectors/brokenlink";
import { toCandidate } from "./detectors/registry";
import { secHeaderCandidates } from "./detectors/secheaders";
import { fanOut, log, type EventSink, type Phase } from "./events";
import { newRunId } from "./ids";
import { preflight } from "./preflight/preflight";
import { EvidenceWriter } from "./record/evidence";
import { buildFindings } from "./report/findings";
import { readinessVerdict } from "./report/verdict";
import type { RunStore } from "./store/run-store";
import type { Candidate, RunResult, ScanConfig } from "./types";

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
export { readinessVerdict } from "./report/verdict";
export { newRunId, RUN_ID_PATTERN } from "./ids";

export const ENGINE_PHASE = "P1-deterministic" as const;

export interface RunScanDeps {
  store: RunStore;
  vault: SecretVault;
  sink?: EventSink;
  runId?: string;
  /** Inject a browser (tests); otherwise one is launched and closed by the scan. */
  browser?: Browser;
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
      candidates.push(toCandidate(draft, siteState));
    }

    // ---- AI stages: not built yet (P2). Degrade to deterministic findings, and say so (NFR-3).
    let aiStagesSkipped: string | undefined;
    if (config.pipeline !== "deterministic") {
      aiStagesSkipped =
        "The AI stages (plan and explore) aren't built yet, so this run used the deterministic pipeline only.";
      log(sink, "warn", aiStagesSkipped);
    }

    // ---- Report
    phase("report");
    const findings = buildFindings(candidates, {
      accountLabel: credentials ? `the account ${credentials.username}` : undefined,
      mobileViewport: config.mobileViewport,
    });
    for (const c of candidates) {
      sink({
        t: "candidate",
        candidate: { id: c.id, category: c.category, summary: c.summary, route: c.route },
      });
    }
    for (const f of findings) {
      sink({
        t: "finding",
        finding: { id: f.id, title: f.title, tier: f.tier, severity: f.severity, kind: f.kind },
      });
    }
    const notTested = whatWasntTested({
      loginDetected: pre.loginDetected,
      loggedIn: !!pre.session,
      notVisited: crawled.notVisited,
      capsHit: crawled.capsHit,
      pageBudget: budget.pages,
    });
    const result: RunResult = {
      ...base,
      states: crawled.states,
      finishedAt: new Date().toISOString(),
      verdict: readinessVerdict({ findings, journeys: [], journeysAttempted: false }),
      notTested,
      findings,
      stats: stats({
        pages: crawled.states.length,
        candidates: candidates.length,
        capsHit: crawled.capsHit,
      }),
      aiStagesSkipped,
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
    if (!deps.browser) await browser.close().catch(() => undefined);
  }
}

export function whatWasntTested(i: {
  loginDetected: boolean;
  loggedIn: boolean;
  notVisited: string[];
  capsHit: string[];
  pageBudget: number;
}): string[] {
  const out = [
    "User journeys (filling forms, buttons, multi-step flows): only page loads were checked in this run.",
  ];
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
