// Live page recorder: network, console and uncaught errors, in order, with marks so a state (or a step)
// can take exactly the entries that happened while it was loading.
import type { Page, Request } from "playwright";
import type { SafetyPolicy } from "../browser/policy";

export interface NetworkEntry {
  seq: number;
  method: string;
  url: string;
  path: string;
  resourceType: string;
  sameOrigin: boolean;
  isNavigation: boolean;
  startedAt: number; // epoch ms
  status?: number;
  durationMs?: number; // request start → finished/failed (or → now, if still pending)
  pending?: boolean;
  failure?: string;
  blockedByPolicy: boolean;
}

export interface ConsoleEntry {
  seq: number;
  type: string;
  text: string;
  sourceUrl?: string;
  at: number;
  /** Host of a request Witness blocked earlier on the same page (see `PageRecorder.blockedHost`). */
  afterBlocked?: string;
}

export interface PageErrorEntry {
  seq: number;
  /** "<name>: <message>", e.g. "TypeError: Cannot read properties of undefined (reading 'x')". */
  text: string;
  name: string;
  message: string;
  stack?: string;
  at: number;
  /** Host of a request Witness blocked earlier on the same page (see `PageRecorder.blockedHost`). */
  afterBlocked?: string;
}

export interface RecorderMark {
  network: number;
  console: number;
  errors: number;
}

export interface RecordedSlice {
  network: NetworkEntry[];
  console: ConsoleEntry[];
  errors: PageErrorEntry[];
}

export class PageRecorder {
  readonly network: NetworkEntry[] = [];
  readonly console: ConsoleEntry[] = [];
  readonly errors: PageErrorEntry[] = [];
  readonly #byRequest = new Map<Request, NetworkEntry>();
  readonly #origin: string;
  /** Requests made since the main frame last navigated (including in-page history changes). */
  #sinceNavigation: { request: Request; host: string }[] = [];
  #seq = 0;

  constructor(
    readonly page: Page,
    private readonly policy: SafetyPolicy,
  ) {
    this.#origin = policy.origin;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.#sinceNavigation = [];
    });
    page.on("request", (r) => this.#onRequest(r));
    page.on("response", (res) => {
      const e = this.#byRequest.get(res.request());
      if (e) e.status = res.status();
    });
    page.on("requestfinished", (r) => this.#finish(r));
    page.on("requestfailed", (r) => this.#finish(r, r.failure()?.errorText ?? "failed"));
    page.on("console", (msg) => {
      if (msg.type() !== "error" && msg.type() !== "warning") return;
      this.console.push({
        seq: this.#seq++,
        type: msg.type(),
        text: msg.text(),
        sourceUrl: msg.location().url || undefined,
        at: Date.now(),
        ...this.#afterBlocked(),
      });
    });
    page.on("pageerror", (err) => {
      // Playwright puts the error type in `name`, not `message` (DEVLOG P0 notes).
      const name = err.name || "Error";
      this.errors.push({
        seq: this.#seq++,
        text: `${name}: ${err.message}`,
        name,
        message: err.message,
        stack: err.stack,
        at: Date.now(),
        ...this.#afterBlocked(),
      });
    });
  }

  /**
   * The host of the latest request Witness's safety policy blocked on this page since it last navigated,
   * if any. An error or a failed check after it may be caused by the block rather than by the app, so the
   * finding is capped at Needs review (D87). The policy marks a request as blocked before aborting it, so
   * anything the abort causes is always seen after the mark.
   */
  blockedHost(): string | undefined {
    for (let i = this.#sinceNavigation.length - 1; i >= 0; i--) {
      const r = this.#sinceNavigation[i]!;
      if (this.policy.wasBlocked(r.request)) return r.host;
    }
    return undefined;
  }

  #afterBlocked(): { afterBlocked?: string } {
    const host = this.blockedHost();
    return host ? { afterBlocked: host } : {};
  }

  mark(): RecorderMark {
    return {
      network: this.network.length,
      console: this.console.length,
      errors: this.errors.length,
    };
  }

  /** Entries recorded since `mark`. Pending requests get their elapsed time so far. */
  since(mark: RecorderMark): RecordedSlice {
    const now = Date.now();
    return {
      network: this.network
        .slice(mark.network)
        .map((e) =>
          e.durationMs === undefined
            ? { ...e, pending: true, durationMs: now - e.startedAt }
            : { ...e },
        ),
      console: this.console.slice(mark.console),
      errors: this.errors.slice(mark.errors),
    };
  }

  inFlightSameOrigin(): number {
    let n = 0;
    for (const e of this.#byRequest.values()) if (e.sameOrigin && e.durationMs === undefined) n++;
    return n;
  }

  /**
   * Waits until no same-origin request has been in flight for `windowMs`, or `capMs` passes.
   * Returns true if the page went quiet, false if the cap was hit.
   */
  async waitForQuiet(capMs: number, windowMs = 500): Promise<boolean> {
    const deadline = Date.now() + capMs;
    let quietSince = this.inFlightSameOrigin() === 0 ? Date.now() : 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      if (this.page.isClosed()) return true;
      if (this.inFlightSameOrigin() === 0) {
        quietSince ||= Date.now();
        if (Date.now() - quietSince >= windowMs) return true;
      } else {
        quietSince = 0;
      }
    }
    return false;
  }

  #onRequest(request: Request): void {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    this.#sinceNavigation.push({ request, host: url.host });
    const entry: NetworkEntry = {
      seq: this.#seq++,
      method: request.method(),
      url: stripQueryValues(url),
      path: url.pathname,
      resourceType: request.resourceType(),
      sameOrigin: url.origin === this.#origin,
      isNavigation: request.isNavigationRequest(),
      startedAt: Date.now(),
      blockedByPolicy: false,
    };
    this.#byRequest.set(request, entry);
    this.network.push(entry);
  }

  #finish(request: Request, failure?: string): void {
    const e = this.#byRequest.get(request);
    if (!e) return;
    e.durationMs = Date.now() - e.startedAt;
    if (failure) {
      e.failure = failure;
      e.blockedByPolicy = this.policy.wasBlocked(request);
    }
    this.#byRequest.delete(request);
  }
}

/**
 * Keeps query keys but drops their values: evidence shows `?q=…&token=…` without leaking what was in
 * them (tokens, emails). The path is what detectors and the scorer use.
 */
export function stripQueryValues(url: URL): string {
  if (!url.search) return `${url.origin}${url.pathname}`;
  const keys = [...new Set([...url.searchParams.keys()])].sort();
  return `${url.origin}${url.pathname}?${keys.map((k) => `${k}=…`).join("&")}`;
}
