// Breadth-first crawler (SPEC FR-3). Visits same-origin links, records evidence for each distinct state,
// and runs the page detectors on it.
//
// Two passes when credentials exist: an anonymous pass, then a logged-in pass that visits the start page,
// anything not yet visited, and anything whose anonymous visit ended on a login form or a redirect (i.e.
// login-gated pages). States are deduplicated by route pattern + aria structure hash.
import type { Browser, Page } from "playwright";
import { LIMITS } from "../config/budgets";
import { createContext, RateLimiter } from "../browser/context";
import type { SafetyPolicy } from "../browser/policy";
import { runPageDetectors } from "../detectors/registry";
import { isBrokenStatus, type LinkTarget } from "../detectors/brokenlink";
import { log, type EventSink } from "../events";
import { newId } from "../ids";
import { captureState, ariaSnapshot, type EvidenceWriter } from "../record/evidence";
import { PageRecorder } from "../record/recorder";
import type { StorageState } from "../preflight/preflight";
import { LOGOUT_TEXT } from "../preflight/preflight";
import type { Candidate, PageState } from "../types";
import { canonicalUrl, routePattern, structureHash } from "./normalise";

/** Login / sign-up pages: they show a password form by design, so they aren't "login-gated" content. */
export const AUTH_PAGE =
  /\/(login|log-in|signin|sign-in|sign_in|signup|sign-up|sign_up|register|auth)(\/|$)/i;

/** Links to files, not pages: never navigated to. */
const NON_PAGE =
  /\.(pdf|zip|gz|tar|rar|7z|dmg|exe|msi|apk|png|jpe?g|gif|webp|svg|ico|mp4|mp3|wav|mov|avi|csv|xlsx?|docx?|pptx?)$/i;

export interface CrawlDeps {
  browser: Browser;
  policy: SafetyPolicy;
  evidence: EvidenceWriter;
  sink: EventSink;
  startUrl: string;
  viewport: { width: number; height: number };
  mobileViewport: { width: number; height: number };
  pageBudget: number;
  deadline: number; // epoch ms: stop starting new visits after this
  session?: StorageState;
  /** Where the login landed: the logged-in pass starts there too (P3, found on an external app). */
  landingUrl?: string;
}

export interface CrawlResult {
  states: PageState[];
  candidates: Candidate[];
  links: LinkTarget[];
  notVisited: string[];
  capsHit: string[];
  detectorErrors: { detectorId: string; message: string }[];
  /** AI-mode snapshot text per state id, kept in memory for the Planner and grounding checks. */
  snapshots: Map<string, string>;
}

interface Visit {
  status: number;
  finalUrl: string;
  gated: boolean; // ended on a login form or was redirected elsewhere
  evidenceId?: string;
}

interface PageLink {
  href: string;
  text: string;
  download: boolean;
}

export async function crawl(deps: CrawlDeps): Promise<CrawlResult> {
  const origin = deps.policy.origin;
  const out: CrawlResult = {
    states: [],
    candidates: [],
    links: [],
    notVisited: [],
    capsHit: [],
    detectorErrors: [],
    snapshots: new Map(),
  };
  const visits = new Map<string, Visit>(); // canonical URL → outcome (anonymous pass)
  const stateKeys = new Set<string>();
  const linkGraph = new Map<string, LinkTarget>();
  const limiter = new RateLimiter();
  const budget = { pages: deps.pageBudget };

  const passes: { session: PageState["session"]; storage?: StorageState }[] = [
    { session: "anonymous" },
  ];
  if (deps.session) passes.push({ session: "authenticated", storage: deps.session });

  for (const pass of passes) {
    const context = await createContext(deps.browser, {
      policy: deps.policy,
      viewport: deps.viewport,
      storageState: pass.storage,
      onDialog: (d) =>
        log(deps.sink, "info", `Dismissed a ${d.type} dialog on ${d.url}: "${d.message}"`),
    });
    try {
      const page = await context.newPage();
      const recorder = new PageRecorder(page, deps.policy);
      const passVisited = new Set<string>();
      const start = canonicalUrl(deps.startUrl);
      const queue: string[] = [start];
      if (pass.session === "authenticated") {
        for (const [url, v] of visits) if (v.gated) queue.push(url);
        if (deps.landingUrl && new URL(deps.landingUrl).origin === origin) {
          const landing = canonicalUrl(deps.landingUrl);
          if (!queue.includes(landing)) queue.splice(1, 0, landing);
        }
      }

      while (queue.length) {
        const url = queue.shift()!;
        if (passVisited.has(url)) continue;
        if (pass.session === "authenticated" && url !== start) {
          if (AUTH_PAGE.test(new URL(url).pathname)) continue; // login/sign-up pages: nothing new when logged in
          const anon = visits.get(url);
          const landing = deps.landingUrl ? canonicalUrl(deps.landingUrl) : undefined;
          if (anon && !anon.gated && url !== landing) continue; // same page as when logged out: covered
        }
        if (budget.pages <= 0) {
          addCap(out, "pages");
          out.notVisited.push(url, ...queue.filter((u) => !passVisited.has(u)));
          break;
        }
        if (Date.now() > deps.deadline) {
          addCap(out, "wall-clock");
          out.notVisited.push(url, ...queue.filter((u) => !passVisited.has(u)));
          break;
        }
        passVisited.add(url);

        await limiter.wait();
        const mark = recorder.mark();
        let status = 0;
        try {
          const response = await page.goto(url, { waitUntil: "domcontentloaded" });
          status = response?.status() ?? 0;
        } catch (err) {
          log(
            deps.sink,
            "warn",
            `Couldn't open ${url}: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
          );
          if (pass.session === "anonymous")
            visits.set(url, { status: 0, finalUrl: url, gated: false });
          continue;
        }
        await recorder.waitForQuiet(LIMITS.crawlQuietCapMs, LIMITS.quietWindowMs);
        const finalUrl = canonicalUrl(page.url());
        if (new URL(finalUrl).origin !== origin) continue; // policy already aborted it; nothing to record
        const hasLoginForm = (await page.locator("input[type=password]:visible").count()) > 0;
        const redirected = new URL(finalUrl).pathname !== new URL(url).pathname;
        const isAuthPage = AUTH_PAGE.test(new URL(url).pathname);
        const visit: Visit = {
          status,
          finalUrl,
          gated: !isAuthPage && (hasLoginForm || redirected),
        };
        const snapshot = await ariaSnapshot(page);
        const pattern = routePattern(finalUrl);
        // An error status with a working app page (SPA deep link on a static host) counts as a page, and
        // a link to it isn't a broken link: people reach it inside the app.
        const appRendered = status >= 400 && rendersAppPage(snapshot);
        const errorPage = status >= 400 && !appRendered;
        if (isBrokenStatus(status) && !appRendered) {
          visit.evidenceId = await deps.evidence.put("network", {
            kind: "link-target",
            url,
            status,
          });
        }
        if (pass.session === "anonymous") visits.set(url, visit);
        recordLinkStatus(linkGraph, url, appRendered ? 200 : status, visit.evidenceId);

        // Dedupe states: same route pattern + same structure = same state.
        const key = `${pattern}|${structureHash(snapshot)}|${errorPage ? status : ""}`;
        if (stateKeys.has(key)) continue;
        stateKeys.add(key);
        budget.pages--;

        const stateId = newId("st");
        const capture = await captureState(page, recorder, mark, deps.evidence, stateId);
        const state: PageState = {
          id: stateId,
          url: finalUrl,
          routePattern: pattern,
          structureHash: structureHash(capture.snapshot),
          title: capture.title,
          status,
          ...(appRendered ? { appRendered: true } : {}),
          session: pass.session,
          // screenshot first: candidates cite it as the page's picture
          evidenceIds: [
            capture.evidence.screenshot,
            capture.evidence.snapshot,
            capture.evidence.network,
            capture.evidence.console,
            capture.evidence.pageErrors,
            capture.evidence.timing,
          ],
          discoveredBy: "crawl",
        };
        out.states.push(state);
        out.snapshots.set(state.id, capture.snapshot);
        deps.sink({
          t: "page",
          state: {
            id: state.id,
            url: state.url,
            routePattern: state.routePattern,
            title: state.title,
          },
        });

        const detected = await runPageDetectors(
          {
            page,
            state,
            capture,
            origin,
            evidence: deps.evidence,
            mobileViewport: deps.mobileViewport,
          },
          { desktopViewport: deps.viewport, errorDocument: errorPage },
        );
        out.detectorErrors.push(...detected.errors);
        for (const c of detected.candidates) {
          out.candidates.push(c);
          deps.sink({
            t: "detector",
            candidateId: c.id,
            detectorId: c.source.kind === "detector" ? c.source.id : c.source.kind,
            summary: c.summary,
          });
        }
        if (errorPage) continue; // don't follow links out of an error page

        for (const link of await extractLinks(page)) {
          const target = followable(link, origin);
          if (!target) continue;
          addLinkSource(linkGraph, target, {
            url: finalUrl,
            routePattern: pattern,
            linkText: link.text,
          });
          if (!passVisited.has(target) && !queue.includes(target)) queue.push(target);
        }
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  out.links = [...linkGraph.values()].filter((l) => l.status > 0 && l.sources.length > 0);
  out.notVisited = [...new Set(out.notVisited)];
  return out;
}

const ERROR_WORDS =
  /\b(not found|404|page (doesn'?t|does not|cannot be found|could not be found)|error|forbidden|unavailable)\b/i;

/**
 * An error-status document that still shows a working app page: no error wording in its headings, and at
 * least 5 interactive controls in the main content. (A real "Not found" page has the wording, or little else.)
 */
export function rendersAppPage(snapshot: string): boolean {
  const lines = snapshot.split("\n");
  const headings = lines.filter((l) => /^\s*- heading\b/.test(l)).join(" ");
  if (ERROR_WORDS.test(headings)) return false;
  const main = snapshot.includes("- main") ? snapshot.slice(snapshot.indexOf("- main")) : snapshot;
  if (ERROR_WORDS.test(main.split("\n").slice(0, 8).join(" "))) return false;
  const controls = main
    .split("\n")
    .filter((l) =>
      /^\s*- (button|link|textbox|combobox|checkbox|searchbox|spinbutton|radio)\b/.test(l),
    );
  return controls.length >= 5;
}

async function extractLinks(page: Page): Promise<PageLink[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLElement).innerText || a.getAttribute("aria-label") || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 80),
        download: a.hasAttribute("download"),
      })),
    )
    .catch(() => []);
}

/** Canonical URL to crawl, or undefined if the link must not be followed. */
export function followable(link: PageLink, origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.origin !== origin) return undefined;
  if (link.download || NON_PAGE.test(url.pathname)) return undefined;
  // Never follow a log-out link: it would end the logged-in pass (and is a state change).
  if (LOGOUT_TEXT.test(link.text) || /\/(logout|log-out|signout|sign-out)\b/i.test(url.pathname)) {
    return undefined;
  }
  return canonicalUrl(url);
}

function addCap(out: CrawlResult, cap: string): void {
  if (!out.capsHit.includes(cap)) out.capsHit.push(cap);
}

function recordLinkStatus(
  graph: Map<string, LinkTarget>,
  url: string,
  status: number,
  evidenceId?: string,
): void {
  const t = graph.get(url) ?? {
    url,
    path: new URL(url).pathname,
    status,
    evidenceId: "",
    sources: [],
  };
  t.status = status;
  if (evidenceId) t.evidenceId = evidenceId;
  graph.set(url, t);
}

function addLinkSource(
  graph: Map<string, LinkTarget>,
  url: string,
  source: LinkTarget["sources"][number],
) {
  const t = graph.get(url) ?? {
    url,
    path: new URL(url).pathname,
    status: 0,
    evidenceId: "",
    sources: [],
  };
  if (!t.sources.some((s) => s.routePattern === source.routePattern)) t.sources.push(source);
  graph.set(url, t);
}
