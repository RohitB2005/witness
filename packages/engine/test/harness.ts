// Test harness: a real browser + a temp JSON run store, and a helper that loads a page, records the
// standard evidence and runs detectors on it — the same path the crawler uses.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser } from "playwright";
import { createContext, launchBrowser } from "../src/browser/context";
import { SafetyPolicy } from "../src/browser/policy";
import { routePattern, structureHash } from "../src/crawl/normalise";
import { runPageDetectors } from "../src/detectors/registry";
import type { PageDetector } from "../src/detectors/types";
import { newId, newRunId } from "../src/ids";
import { captureState, EvidenceWriter } from "../src/record/evidence";
import { PageRecorder } from "../src/record/recorder";
import { JsonRunStore } from "../src/store/json-store";
import type { Candidate, PageState, ScanMode } from "../src/types";
import type { CandidateDraft } from "../src/detectors/types";

export const DESKTOP = { width: 1280, height: 800 };
export const MOBILE = { width: 375, height: 667 };

export interface Harness {
  browser: Browser;
  store: JsonRunStore;
  runId: string;
  writer: EvidenceWriter;
  dir: string;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), "witness-test-"));
  const store = new JsonRunStore({
    runsDir: path.join(dir, "runs"),
    dataDir: path.join(dir, "data"),
  });
  const runId = newRunId();
  await store.createRun(runId, { url: "http://fixture", startedAt: new Date().toISOString() });
  const browser = await launchBrowser();
  return {
    browser,
    store,
    runId,
    writer: new EvidenceWriter(store, runId),
    dir,
    close: async () => {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface DetectOptions {
  mode?: ScanMode;
  /** Run only these detectors (called directly); default: the full registry via runPageDetectors. */
  only?: PageDetector[];
  quietCapMs?: number;
}

/** Loads `url`, captures the state and runs detectors — returns drafts (only) or candidates (registry). */
export async function detect(
  h: Harness,
  url: string,
  opts: DetectOptions = {},
): Promise<{ drafts: CandidateDraft[]; candidates: Candidate[]; errors: unknown[] }> {
  const origin = new URL(url).origin;
  const policy = new SafetyPolicy({ origin, mode: opts.mode ?? "staging" });
  const context = await createContext(h.browser, { policy, viewport: DESKTOP });
  try {
    const page = await context.newPage();
    const recorder = new PageRecorder(page, policy);
    const mark = recorder.mark();
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    await recorder.waitForQuiet(opts.quietCapMs ?? 4_000, 300);
    const stateId = newId("st");
    const capture = await captureState(page, recorder, mark, h.writer, stateId);
    const state: PageState = {
      id: stateId,
      url: page.url(),
      routePattern: routePattern(page.url()),
      structureHash: structureHash(capture.snapshot),
      title: capture.title,
      status: response?.status(),
      session: "anonymous",
      evidenceIds: [capture.evidence.screenshot],
      discoveredBy: "crawl",
    };
    const ctx = { page, state, capture, origin, evidence: h.writer, mobileViewport: MOBILE };
    if (opts.only) {
      const drafts: CandidateDraft[] = [];
      for (const d of opts.only) {
        if (d.viewport === "mobile") await page.setViewportSize(MOBILE);
        drafts.push(...(await d.run(ctx)));
        if (d.viewport === "mobile") await page.setViewportSize(DESKTOP);
      }
      return { drafts, candidates: [], errors: [] };
    }
    const result = await runPageDetectors(ctx, {
      desktopViewport: DESKTOP,
      errorDocument: (response?.status() ?? 200) >= 400,
    });
    return { drafts: [], candidates: result.candidates, errors: result.errors };
  } finally {
    await context.close();
  }
}
