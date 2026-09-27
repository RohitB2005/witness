// Run-level response observer (ADDENDUM A1, A3, A4). Attached to every browser context a scan opens (except
// replays and preflight, browser/context.ts), it sees each same-origin response once and keeps only what the
// security detectors need:
// - DET-SECRETS and DET-DBERROR: text bodies (documents, scripts, JSON, ≤ 2 MB) are scanned in memory. Only
//   redacted matches are kept; a body is never stored or written anywhere.
// - DET-AUTHZ: which GET endpoints answered 2xx without a login, and the first JSON body of each GET endpoint
//   that answered 200 while logged in (in memory only, for the no-cookie comparison).
import { createHash } from "node:crypto";
import type { BrowserContext, Response } from "playwright";
import { routePattern } from "../crawl/normalise";
import { findDbError, type DbErrorHit } from "../detectors/dberror";
import { findSecrets, type SecretHit } from "../detectors/secrets";
import { pathOf, pathPattern } from "../detectors/util";
import type { EvidenceWriter } from "./evidence";

export type SessionLabel = "anonymous" | "authenticated";

/** Bodies larger than this aren't scanned (ADDENDUM A1). */
export const MAX_SCAN_BYTES = 2 * 1024 * 1024;
/** At most this many logged-in endpoints are remembered for DET-AUTHZ. */
const MAX_AUTH_APIS = 40;

const TEXT_TYPE = /text\/|javascript|json|xml/i;

export interface AuthApiObservation {
  url: string;
  path: string;
  pattern: string;
  /** The page that made the request, and its route pattern. */
  pageUrl: string;
  pageRoute: string;
  body: unknown;
}

export class ResponseObserver {
  readonly secretHits: (SecretHit & { session: SessionLabel; pageUrl: string })[] = [];
  readonly dbHits: (DbErrorHit & { session: SessionLabel; pageUrl: string })[] = [];
  /** GET path patterns (no query) that answered 2xx with no login. */
  readonly anonymousOk = new Set<string>();
  /** Logged-in GET JSON endpoints that answered 200, by path pattern without the query (first seen). */
  readonly authApis = new Map<string, AuthApiObservation>();
  readonly #pending = new Set<Promise<void>>();
  readonly #scanned = new Set<string>();
  readonly #secretSeen = new Set<string>();
  readonly #dbSeen = new Set<string>();
  #stopped = false;

  constructor(
    readonly origin: string,
    private readonly evidence: EvidenceWriter,
  ) {}

  attach(context: BrowserContext, session: SessionLabel): void {
    // A context that starts logged out may log in (a journey that signs in, a form that creates an
    // account). From its first same-origin write request on, it's no longer evidence of "without a
    // login". Marked when the request starts: a login's redirect may never surface as a response.
    const ctx = { session, wrote: false };
    context.on("request", (req) => {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method())) return;
      try {
        if (new URL(req.url()).origin === this.origin) ctx.wrote = true;
      } catch {
        // unparsable URL: not ours
      }
    });
    context.on("response", (res) => {
      if (this.#stopped) return;
      const p = this.#onResponse(res, ctx).catch(() => undefined);
      this.#pending.add(p);
      void p.finally(() => this.#pending.delete(p));
    });
  }

  /** Waits for bodies still being read, then stops observing (the scan's detectors run next). */
  async settle(): Promise<void> {
    while (this.#pending.size) await Promise.all([...this.#pending]);
    this.#stopped = true;
  }

  /** Page text (e.g. a crawled page's accessibility snapshot) for DET-DBERROR. */
  async scanPageText(
    page: { url: string; route: string; session: SessionLabel },
    text: string,
  ): Promise<void> {
    const match = findDbError(text);
    const key = `page|${page.route}`;
    if (!match || this.#dbSeen.has(key)) return;
    this.#dbSeen.add(key);
    const evidenceId = await this.evidence.put("dom_probe", {
      kind: "db-error-text",
      url: page.url,
      db: match.db,
      excerpt: match.excerpt,
    });
    this.dbHits.push({
      match,
      pageRoute: page.route,
      evidenceId,
      session: page.session,
      pageUrl: page.url,
    });
  }

  async #onResponse(res: Response, ctx: { session: SessionLabel; wrote: boolean }): Promise<void> {
    const session = ctx.session;
    let url: URL;
    try {
      url = new URL(res.url());
    } catch {
      return;
    }
    if (url.origin !== this.origin) return;
    const request = res.request();
    const method = request.method();
    const status = res.status();
    // Path only: query keys don't change who may read an endpoint (a public list with ?q&sort is public).
    const pattern = pathPattern(url.pathname);
    const pageUrl = pageOf(res);

    const loggedOut = session === "anonymous" && !ctx.wrote;
    if (method === "GET" && loggedOut && status >= 200 && status < 300)
      this.anonymousOk.add(pattern);

    const headers = await res.allHeaders().catch(() => ({}) as Record<string, string>);
    const type = headers["content-type"] ?? "";
    if (!TEXT_TYPE.test(type) || status === 204 || (status >= 300 && status < 400)) return;
    if (Number(headers["content-length"] ?? 0) > MAX_SCAN_BYTES) return;
    const body = await res.text().catch(() => undefined);
    if (body === undefined || body.length > MAX_SCAN_BYTES) return;

    const req = { method, url: url.href, path: url.pathname + url.search, status };
    const bodyKey = `${method} ${url.href} ${status} ${hash(body)}`;
    if (!this.#scanned.has(bodyKey)) {
      this.#scanned.add(bodyKey);
      for (const match of findSecrets(body)) {
        const key = `${match.hash}|${url.pathname}`;
        if (this.#secretSeen.has(key)) continue;
        this.#secretSeen.add(key);
        const evidenceId = await this.evidence.put("network", {
          kind: "secret-match",
          url: url.href,
          method,
          status,
          contentType: type,
          secret: match.label,
          redacted: match.redacted,
        });
        this.secretHits.push({ match, request: req, evidenceId, session, pageUrl });
      }
      const db = findDbError(body);
      const dbKey = `${method} ${pattern} ${status >= 500}`;
      if (db && !this.#dbSeen.has(dbKey)) {
        this.#dbSeen.add(dbKey);
        const evidenceId = await this.evidence.put("network", {
          kind: "db-error-response",
          url: url.href,
          method,
          status,
          db: db.db,
          excerpt: db.excerpt,
        });
        this.dbHits.push({ match: db, request: req, evidenceId, session, pageUrl });
      }
    }

    if (
      method === "GET" &&
      session === "authenticated" &&
      status === 200 &&
      /json/i.test(type) &&
      !this.authApis.has(pattern) &&
      this.authApis.size < MAX_AUTH_APIS
    ) {
      try {
        const parsed: unknown = JSON.parse(body);
        this.authApis.set(pattern, {
          url: url.href,
          path: req.path,
          pattern,
          pageUrl,
          pageRoute: pageUrl ? pathOf(routePattern(pageUrl)) : "",
          body: parsed,
        });
      } catch {
        // not JSON after all
      }
    }
  }
}

function pageOf(res: Response): string {
  try {
    return res.frame().page().url();
  } catch {
    return "";
  }
}

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
