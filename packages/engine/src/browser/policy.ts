// Safety policy enforced at the network layer (ARCHITECTURE.md §5, SECURITY.md T1/T2/T3).
// Never relies on the model behaving: every request from every page in the context passes `decide`.
import type { BrowserContext, Request, Route } from "playwright";
import type { ScanMode } from "../types";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type BlockReason =
  "off-origin-navigation" | "production-write" | "blocked-scheme" | "off-origin-subresource";

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
  #loginRequest: WriteAllowance | undefined;

  constructor(opts: PolicyOptions) {
    this.origin = new URL(opts.origin).origin;
    this.mode = opts.mode;
    this.#strict = opts.strictSubresources ?? false;
    this.#onBlock = opts.onBlock;
  }

  /**
   * Preflight calls this just before submitting the login form. The next same-origin write request is
   * allowed (even in production mode) and recorded as *the* login request; later writes to the same
   * method + path are allowed too (replays log in again). Everything else stays blocked.
   */
  armLoginWindow(): void {
    this.#loginWindowArmed = true;
  }

  disarmLoginWindow(): void {
    this.#loginWindowArmed = false;
  }

  get loginRequest(): WriteAllowance | undefined {
    return this.#loginRequest;
  }

  /** Allows a previously recorded login request (e.g. in a fresh context for replay). */
  allowWrite(allowance: WriteAllowance): void {
    this.#allowedWrites.push({ method: allowance.method.toUpperCase(), path: allowance.path });
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
    if (!sameOrigin) {
      if (req.isMainFrameNavigation) return { allow: false, reason: "off-origin-navigation" };
      if (this.#strict) return { allow: false, reason: "off-origin-subresource" };
      return { allow: true };
    }
    const method = req.method.toUpperCase();
    if (!WRITE_METHODS.has(method)) return { allow: true };
    if (this.#loginWindowArmed) return { allow: true, asLoginRequest: true };
    if (this.mode === "staging") return { allow: true };
    const allowed = this.#allowedWrites.some((a) => a.method === method && a.path === url.pathname);
    return allowed ? { allow: true } : { allow: false, reason: "production-write" };
  }

  /** Installs the policy on a context: every request from every page (including popups) is routed. */
  async install(context: BrowserContext): Promise<void> {
    await context.route("**/*", (route) => this.#handle(route));
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request();
    const decision = this.decide({
      url: request.url(),
      method: request.method(),
      isMainFrameNavigation: isMainFrameNavigation(request),
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
    const allowance = {
      method: request.method().toUpperCase(),
      path: new URL(request.url()).pathname,
    };
    this.#loginRequest ??= allowance;
    this.allowWrite(allowance);
    this.#loginWindowArmed = false;
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
