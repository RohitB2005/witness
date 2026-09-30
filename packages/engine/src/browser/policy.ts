// Safety policy enforced at the network layer (ARCHITECTURE.md §5, SECURITY.md T1/T2/T3).
// Never relies on the model behaving: every request from every page in the context passes `decide`.
import type { BrowserContext, Request, Route, WebSocketRoute } from "playwright";
import type { ScanMode } from "../types";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type BlockReason =
  | "off-origin-navigation"
  | "production-write"
  | "production-websocket"
  | "blocked-scheme"
  | "off-origin-subresource";

export interface BlockedRequest {
  reason: BlockReason;
  method: string;
  url: string;
  at: string;
}

export interface RequestFacts {
  url: string;
  method: string;
  /** A top-level navigation of a page's main frame (not an iframe, not a sub-resource). */
  isMainFrameNavigation: boolean;
  /** The address of the page that sent it, when known (the login window only admits the login page's). */
  frameUrl?: string;
}

export type Decision =
  { allow: true; asLoginRequest?: boolean } | { allow: false; reason: BlockReason };

export interface PolicyOptions {
  /** The scan origin, e.g. "http://localhost:3000". */
  origin: string;
  mode: ScanMode;
  /** Also block sub-resources (scripts, images, fetches) from other origins. Off by default: apps need CDNs. */
  strictSubresources?: boolean;
  onBlock?: (blocked: BlockedRequest) => void;
}

export interface WriteAllowance {
  /** Defaults to the scan origin. A login may post to another service (e.g. a hosted auth API). */
  origin?: string;
  method: string;
  path: string;
}

export class SafetyPolicy {
  readonly origin: string;
  readonly mode: ScanMode;
  readonly blocked: BlockedRequest[] = [];
  readonly #strict: boolean;
  readonly #onBlock?: (b: BlockedRequest) => void;
  readonly #allowedWrites: WriteAllowance[] = [];
  readonly #blockedRequests = new WeakSet<Request>();
  #loginWindowArmed = false;
  /** origin + pathname of the login page while the window is armed ("" = any page, for pure tests). */
  #loginPage = "";
  readonly #loginRequests: Required<WriteAllowance>[] = [];

  constructor(opts: PolicyOptions) {
    this.origin = new URL(opts.origin).origin;
    this.mode = opts.mode;
    this.#strict = opts.strictSubresources ?? false;
    this.#onBlock = opts.onBlock;
  }

  /**
   * Preflight calls this just before submitting the login form and disarms it once the login has settled.
   * While it's armed, write requests *sent from the login page* to any origin are allowed (even in
   * production mode: a login may post to a hosted auth service on another origin) and each is recorded as
   * a login request; later writes to the same origin + method + path stay allowed (replays log in again).
   * Writes from the page the login lands on (a dashboard's tracking call) stay blocked (D87).
   */
  armLoginWindow(loginPageUrl?: string): void {
    this.#loginWindowArmed = true;
    this.#loginPage = loginPageUrl ? pageKey(loginPageUrl) : "";
  }

  disarmLoginWindow(): void {
    this.#loginWindowArmed = false;
  }

  /** The write requests made while the login window was armed (in order, no duplicates). */
  get loginRequests(): readonly Required<WriteAllowance>[] {
    return this.#loginRequests;
  }

  /** Allows a previously recorded login request (e.g. in a fresh context for replay). */
  allowWrite(allowance: WriteAllowance): void {
    this.#allowedWrites.push({
      origin: allowance.origin ?? this.origin,
      method: allowance.method.toUpperCase(),
      path: allowance.path,
    });
  }

  /** True if Witness itself aborted this request — DET-REQFAIL must ignore it. */
  wasBlocked(request: Request): boolean {
    return this.#blockedRequests.has(request);
  }

  /** Pure decision for one request. Exposed for table-driven tests. */
  decide(req: RequestFacts): Decision {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return { allow: false, reason: "blocked-scheme" };
    }
    if (url.protocol === "data:" || url.protocol === "blob:") return { allow: true };
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { allow: false, reason: "blocked-scheme" };
    }
    const sameOrigin = url.origin === this.origin;
    if (!sameOrigin && req.isMainFrameNavigation) {
      return { allow: false, reason: "off-origin-navigation" };
    }
    // Production mode is read-only everywhere, not just on the app's own origin: many small apps write
    // straight from the browser to another service (a hosted database, a form or payment API) (D87).
    const method = req.method.toUpperCase();
    if (WRITE_METHODS.has(method)) {
      const fromLoginPage =
        !this.#loginPage ||
        (req.frameUrl !== undefined && pageKey(req.frameUrl) === this.#loginPage);
      if (this.#loginWindowArmed && fromLoginPage) return { allow: true, asLoginRequest: true };
      if (this.mode === "production") {
        const allowed = this.#allowedWrites.some(
          (a) => a.origin === url.origin && a.method === method && a.path === url.pathname,
        );
        if (!allowed) return { allow: false, reason: "production-write" };
      }
    }
    if (!sameOrigin && this.#strict) return { allow: false, reason: "off-origin-subresource" };
    return { allow: true };
  }

  /**
   * Installs the policy on a context: every request from every page (including popups) is routed. In
   * production mode every WebSocket is refused too: its messages can't be told apart as reads or writes,
   * and some hosted databases write over one (D87).
   */
  async install(context: BrowserContext): Promise<void> {
    await context.route("**/*", (route) => this.#handle(route));
    if (this.mode === "production")
      await context.routeWebSocket(
        () => true,
        (ws) => this.#refuseSocket(ws),
      );
  }

  async #refuseSocket(ws: WebSocketRoute): Promise<void> {
    const blocked: BlockedRequest = {
      reason: "production-websocket",
      method: "WEBSOCKET",
      url: ws.url(),
      at: new Date().toISOString(),
    };
    this.blocked.push(blocked);
    this.#onBlock?.(blocked);
    // Never connected to the server: the page sees the socket close with "policy violation".
    await ws
      .close({ code: 1008, reason: "Blocked by Witness (read-only mode)" })
      .catch(() => undefined);
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request();
    const decision = this.decide({
      url: request.url(),
      method: request.method(),
      isMainFrameNavigation: isMainFrameNavigation(request),
      frameUrl: frameUrl(request),
    });
    try {
      if (decision.allow) {
        if (decision.asLoginRequest) this.#recordLogin(request);
        await route.continue();
        return;
      }
      this.#blockedRequests.add(request);
      const blocked: BlockedRequest = {
        reason: decision.reason,
        method: request.method(),
        url: request.url(),
        at: new Date().toISOString(),
      };
      this.blocked.push(blocked);
      this.#onBlock?.(blocked);
      await route.abort("blockedbyclient");
    } catch {
      // The page closed while the request was in flight; nothing to do.
    }
  }

  #recordLogin(request: Request): void {
    const url = new URL(request.url());
    const allowance = {
      origin: url.origin,
      method: request.method().toUpperCase(),
      path: url.pathname,
    };
    const same = (a: Required<WriteAllowance>) =>
      a.origin === allowance.origin && a.method === allowance.method && a.path === allowance.path;
    if (this.#loginRequests.some(same)) return;
    this.#loginRequests.push(allowance);
    this.allowWrite(allowance);
  }
}

/**
 * The hosts whose write requests production mode blocked, for the report's "What wasn't tested" list.
 * Some services read over POST too (a hosted database's query channel), so a block can hide more than a
 * write; the note says so in plain words. Pure (tested).
 */
export function blockedWriteNote(blocked: readonly BlockedRequest[]): string | undefined {
  const sockets = blocked.some((b) => b.reason === "production-websocket");
  const hosts = [
    ...new Set(
      blocked
        .filter((b) => b.reason === "production-write" || b.reason === "production-websocket")
        .map((b) => {
          try {
            return new URL(b.url).host;
          } catch {
            return undefined;
          }
        })
        .filter((h): h is string => !!h),
    ),
  ].sort();
  if (!hosts.length) return undefined;
  const list =
    hosts.length <= 5
      ? hosts.join(", ")
      : `${hosts.slice(0, 5).join(", ")} and ${hosts.length - 5} more`;
  return `Read-only mode blocked requests that send data${sockets ? " (including live connections)" : ""} to ${list}. Some services also read data this way, so parts of the app that rely on ${hosts.length === 1 ? "it" : "them"} may not have been fully tested.`;
}

/** origin + pathname: the same page whatever its query or hash. */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** The committed address of the frame that sent the request ("" when there is none, e.g. a worker). */
function frameUrl(request: Request): string {
  try {
    return request.frame().url();
  } catch {
    return "";
  }
}

function isMainFrameNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame().parentFrame() === null;
  } catch {
    return false; // service-worker requests have no frame (service workers are blocked anyway)
  }
}
