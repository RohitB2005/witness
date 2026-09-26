// Evidence writer: gives every recorded artifact an `ev_` ID (the only IDs an LLM may ever cite) and
// stores it. Also captures the standard evidence bundle for a page state.
import type { Page } from "playwright";
import { newId } from "../ids";
import type { RunStore } from "../store/run-store";
import type { Evidence, EvidenceKind } from "../types";
import type { PageRecorder, RecordedSlice, RecorderMark } from "./recorder";

export class EvidenceWriter {
  constructor(
    readonly store: RunStore,
    readonly runId: string,
  ) {}

  async put(
    kind: EvidenceKind,
    data: unknown,
    opts: { stateId?: string; stepId?: string; path?: string } = {},
  ): Promise<string> {
    const evidence: Evidence = {
      id: newId("ev"),
      kind,
      createdAt: new Date().toISOString(),
      data,
      ...opts,
    };
    await this.store.putEvidence(this.runId, evidence);
    return evidence.id;
  }

  /** JPEG, quality 60, viewport-sized (≤ 1280 px wide); password inputs are always masked (T5). */
  async screenshot(page: Page, opts: { stateId?: string; stepId?: string; label?: string } = {}) {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 60,
      mask: [page.locator("input[type=password]")],
      animations: "disabled",
    });
    const id = newId("ev");
    const path = await this.store.putArtifact(this.runId, `${id}.jpg`, buffer);
    await this.store.putEvidence(this.runId, {
      id,
      kind: "screenshot",
      stateId: opts.stateId,
      stepId: opts.stepId,
      createdAt: new Date().toISOString(),
      path,
      data: { url: page.url(), label: opts.label },
    });
    return id;
  }
}

export interface Timing {
  ttfbMs?: number;
  domContentLoadedMs?: number;
  loadMs?: number;
  lcpMs?: number;
}

export interface StateCapture {
  url: string;
  title: string;
  snapshot: string;
  slice: RecordedSlice;
  timing: Timing;
  evidence: {
    screenshot: string;
    snapshot: string;
    network: string;
    console: string;
    pageErrors: string;
    timing: string;
  };
}

/** Records the standard evidence bundle for the page as it is now. */
export async function captureState(
  page: Page,
  recorder: PageRecorder,
  mark: RecorderMark,
  writer: EvidenceWriter,
  stateId: string,
  opts: { timing?: boolean } = {},
): Promise<StateCapture> {
  const slice = recorder.since(mark);
  const snapshot = await ariaSnapshot(page);
  // Navigation timing + LCP (waits up to 250 ms) only matter for page loads, not for every agent step.
  const timing = opts.timing === false ? {} : await readTiming(page);
  const title = await page.title().catch(() => "");
  const snapshotId = newId("ev");
  const snapshotPath = await writer.store.putArtifact(writer.runId, `${snapshotId}.yaml`, snapshot);
  await writer.store.putEvidence(writer.runId, {
    id: snapshotId,
    kind: "aria_snapshot",
    stateId,
    createdAt: new Date().toISOString(),
    path: snapshotPath,
    data: { url: page.url(), bytes: snapshot.length },
  });
  const evidence = {
    screenshot: await writer.screenshot(page, { stateId }),
    snapshot: snapshotId,
    network: await writer.put("network", { entries: slice.network }, { stateId }),
    console: await writer.put("console", { entries: slice.console }, { stateId }),
    pageErrors: await writer.put("page_error", { entries: slice.errors }, { stateId }),
    timing: await writer.put("timing", timing, { stateId }),
  };
  return { url: page.url(), title, snapshot, slice, timing, evidence };
}

/** AI-mode aria snapshot (Playwright ≥ 1.59: `page.ariaSnapshot({ mode: "ai" })`, refs like [ref=e12]). */
export async function ariaSnapshot(page: Page): Promise<string> {
  try {
    return await page.ariaSnapshot({ mode: "ai" });
  } catch {
    return "";
  }
}

async function readTiming(page: Page): Promise<Timing> {
  const ms = (n: number | undefined) => (n === undefined || n <= 0 ? undefined : Math.round(n));
  try {
    const [ttfb, dcl, load, lcp] = await page.evaluate(async () => {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const lcp = await new Promise<number | undefined>((resolve) => {
        try {
          const po = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            resolve(entries[entries.length - 1]?.startTime);
          });
          po.observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => resolve(undefined), 250);
        } catch {
          resolve(undefined);
        }
      });
      // No helper functions in here: this body is serialised into the page.
      return [nav?.responseStart, nav?.domContentLoadedEventEnd, nav?.loadEventEnd, lcp];
    });
    return { ttfbMs: ms(ttfb), domContentLoadedMs: ms(dcl), loadMs: ms(load), lcpMs: ms(lcp) };
  } catch {
    return {};
  }
}
