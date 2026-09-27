// Browser + context factory (ARCHITECTURE.md §5). Every context is fresh, non-persistent and locked down.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { LIMITS } from "../config/budgets";
import type { SafetyPolicy } from "./policy";

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export interface DialogRecord {
  type: string;
  message: string;
  url: string;
  at: string;
}

/** Something that watches every context a scan opens (record/responses.ts). */
export interface ContextObserver {
  attach(context: BrowserContext, session: "anonymous" | "authenticated"): void;
}

const observers = new WeakMap<Browser, ContextObserver>();

/**
 * Registers an observer for every context created on `browser` from now on (unless the context opts out),
 * so a run-level view of responses needs no plumbing through each stage. Returns the unregister function.
 */
export function observeContexts(browser: Browser, observer: ContextObserver): () => void {
  observers.set(browser, observer);
  return () => {
    if (observers.get(browser) === observer) observers.delete(browser);
  };
}

export interface ContextOptions {
  policy: SafetyPolicy;
  viewport: { width: number; height: number };
  /** In-memory session (cookies + storage) from preflight login; never written to disk. */
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>;
  onDialog?: (dialog: DialogRecord) => void;
  /**
   * false: the run-level observer doesn't see this context (replays, which repeat what was already seen, and
   * preflight, whose login changes the session mid-context). Default true.
   */
  observe?: boolean;
}

export async function createContext(
  browser: Browser,
  opts: ContextOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: opts.viewport,
    acceptDownloads: false,
    permissions: [],
    reducedMotion: "reduce",
    serviceWorkers: "block",
    storageState: opts.storageState,
  });
  context.setDefaultTimeout(LIMITS.actionTimeoutMs);
  context.setDefaultNavigationTimeout(LIMITS.navigationTimeoutMs);
  await opts.policy.install(context);
  if (opts.observe !== false)
    observers.get(browser)?.attach(context, opts.storageState ? "authenticated" : "anonymous");
  const attach = (page: Page) => {
    // alert/confirm/prompt are dismissed so a page can never block the scan; each one is logged.
    page.on("dialog", (dialog) => {
      opts.onDialog?.({
        type: dialog.type(),
        message: dialog.message(),
        url: page.url(),
        at: new Date().toISOString(),
      });
      dialog.dismiss().catch(() => undefined);
    });
  };
  context.pages().forEach(attach);
  context.on("page", attach);
  return context;
}

/** Enforces a minimum gap between actions against the target (SECURITY.md T10). */
export class RateLimiter {
  #last = 0;
  constructor(readonly minGapMs: number = LIMITS.minActionGapMs) {}

  async wait(): Promise<void> {
    const gap = Date.now() - this.#last;
    if (gap < this.minGapMs) await new Promise((r) => setTimeout(r, this.minGapMs - gap));
    this.#last = Date.now();
  }
}
