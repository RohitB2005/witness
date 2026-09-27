// Shared plumbing for the automatic probes (P3, D46): a locked-down browser, a recording executor and a
// synthetic "automatic check" journey that holds the recorded steps, so replay and test export treat
// probe findings exactly like journey findings.
import type { Browser, BrowserContext, Page } from "playwright";
import { createContext } from "../browser/context";
import { SafetyPolicy } from "../browser/policy";
import type { SecretVault } from "../browser/vault";
import { log, type EventSink } from "../events";
import { Executor } from "../explore/executor";
import type { StateRegistry } from "../explore/states";
import { newId } from "../ids";
import type { Locator } from "../oracle/language";
import { toPlaywright } from "../oracle/locate";
import type { StorageState } from "../preflight/preflight";
import type { EvidenceWriter } from "../record/evidence";
import { PageRecorder } from "../record/recorder";
import type { RunStore } from "../store/run-store";
import type { Journey, PageState, ScanMode } from "../types";

export interface ProbeDeps {
  browser: Browser;
  /** The run's policy (origin guard; production write block). */
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
  /** Logged-in cookies/storage from preflight (memory only), for logged-in pages. */
  session?: StorageState;
  states: StateRegistry;
  /** What the crawl saw: states and their AI-mode snapshots. */
  crawl: { states: PageState[]; snapshots: Map<string, string>; linkUrls: string[] };
  /** Epoch ms: no new probe action starts after this. */
  deadline: number;
}

export function automaticJourney(title: string, goal: string, startRoute: string): Journey {
  return {
    id: newId("jr"),
    title,
    goal,
    priority: "secondary",
    startRoute,
    suggestedSteps: [],
    expectations: [],
    status: "completed",
    steps: [],
    automatic: true,
  };
}

/**
 * A fresh context and executor for one probe session. `readOnly` uses a separate write-blocking policy, so
 * nothing the probe clicks or types can change data, whatever the scan mode (the executor's destructive-verb
 * rules then also use production strictness).
 */
export async function openProbe(
  deps: ProbeDeps,
  journey: Journey,
  opts: { session: PageState["session"]; readOnly: boolean },
): Promise<{ context: BrowserContext; page: Page; ex: Executor }> {
  const policy = opts.readOnly
    ? new SafetyPolicy({ origin: deps.policy.origin, mode: "production" })
    : deps.policy;
  const context = await createContext(deps.browser, {
    policy,
    viewport: deps.viewport,
    storageState: opts.session === "authenticated" ? deps.session : undefined,
    onDialog: (d) => log(deps.sink, "info", `Dismissed a ${d.type} dialog: "${d.message}"`),
  });
  const page = await context.newPage();
  const recorder = new PageRecorder(page, policy);
  const ex = new Executor({
    page,
    recorder,
    evidence: deps.evidence,
    vault: deps.vault,
    policy,
    mode: opts.readOnly ? "production" : deps.mode,
    journeyId: journey.id,
    kind: "edge",
    session: opts.session,
    states: deps.states,
    viewport: deps.viewport,
    mobileViewport: deps.mobileViewport,
    credentials: deps.credentials,
    detectors: "log",
  });
  return { context, page, ex };
}

/** The first of these locators that matches exactly one element, else the CSS path. */
export async function firstUnique(page: Page, list: Locator[], css: string): Promise<Locator> {
  for (const loc of list) {
    const n = await toPlaywright(page, loc)
      .count()
      .catch(() => 0);
    if (n === 1) return loc;
  }
  return { by: "css", selector: css };
}

/** In-page helper (as source text): a structural CSS path for an element, anchored on a unique id. */
export const CSS_PATH_FN = String.raw`(el) => {
  const parts = [];
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    const id = node.getAttribute("id");
    if (id && /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll("#" + id).length === 1) {
      parts.unshift("#" + id);
      return parts.join(" > ");
    }
    let sel = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
    }
    parts.unshift(sel);
    node = parent;
  }
  return "body > " + parts.join(" > ");
}`;

export function pathAndQuery(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}
