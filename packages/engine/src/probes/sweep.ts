// Safe interaction sweep (P3, D46; staging mode only): on each page the crawl saw, click every collapsed
// accordion, disclosure or tab once — never a link, never a submit button, never a destructive control —
// and watch for page errors, server errors and console errors. A crash after one click becomes a finding
// whose steps are "open the page, click that control", so it replays and exports like any other.
// A write-blocking policy is used even in staging: nothing the sweep clicks can change data.
import { log } from "../events";
import type { Locator } from "../oracle/language";
import type { Candidate, Journey } from "../types";
import {
  automaticJourney,
  CSS_PATH_FN,
  firstUnique,
  openProbe,
  pathAndQuery,
  type ProbeDeps,
} from "./common";

const MAX_PAGES = 8;
const MAX_PER_PAGE = 12;
const MAX_CLICKS = 40;

interface Control {
  role: string;
  name: string;
  css: string;
}

// Collapsed controls: aria-expanded="false", a closed <details>' summary, an unselected tab. Links,
// submit buttons (including a button with no type inside a form) and disabled controls are left alone.
const FIND_CONTROLS = `(() => {
  const cssPath = ${CSS_PATH_FN};
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const out = [];
  const found = document.querySelectorAll(
    '[aria-expanded="false"], details:not([open]) > summary, [role="tab"][aria-selected="false"]',
  );
  for (const el of Array.from(found)) {
    if (!visible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.tagName === "A" || el.closest("a[href]")) continue;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "submit" || type === "image") continue;
    if (el.tagName === "BUTTON" && !type && el.closest("form")) continue;
    if (el.tagName === "INPUT") continue;
    const role = el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : "");
    const name = (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    out.push({ role, name, css: cssPath(el) });
  }
  return out;
})()`;

export async function sweepProbe(
  deps: ProbeDeps,
): Promise<{ candidates: Candidate[]; journey?: Journey; metrics: Record<string, number> }> {
  const metrics = { pages: 0, clicks: 0, candidates: 0 };
  const pages = new Map<string, (typeof deps.crawl.states)[number]>();
  for (const s of deps.crawl.states) {
    if ((s.status ?? 200) >= 400 && !s.appRendered) continue;
    const key = `${s.routePattern}|${s.session}`;
    if (!pages.has(key)) pages.set(key, s);
  }
  if (!pages.size) return { candidates: [], metrics };
  const journey = automaticJourney(
    "Interaction sweep (automatic check)",
    "Open each collapsed accordion, disclosure or tab once and watch for errors.",
    "/",
  );
  const candidates: Candidate[] = [];
  let clicks = 0;
  for (const state of [...pages.values()].slice(0, MAX_PAGES)) {
    if (Date.now() > deps.deadline || clicks >= MAX_CLICKS) break;
    const path = pathAndQuery(state.url);
    const { context, page, ex } = await openProbe(deps, journey, {
      session: state.session,
      readOnly: true,
    });
    try {
      let open = await ex.act({ type: "goto", path });
      if (!open.ok) continue;
      const controls = ((await page.evaluate(FIND_CONTROLS).catch(() => [])) as Control[]).slice(
        0,
        MAX_PER_PAGE,
      );
      if (!controls.length) continue;
      metrics.pages++;
      for (const c of controls) {
        if (Date.now() > deps.deadline || clicks >= MAX_CLICKS) break;
        const list: Locator[] =
          c.role && c.name ? [{ by: "role", role: c.role, name: c.name, exact: true }] : [];
        if (!c.role && c.name) list.push({ by: "text", text: c.name, exact: true });
        const target = await firstUnique(page, list, c.css);
        const r = await ex.act({ type: "click", target });
        clicks++;
        metrics.clicks++;
        for (const cand of r.candidates) {
          // Each crash is reproduced by opening the page and clicking this one control.
          candidates.push({ ...cand, journeyId: journey.id, stepIds: [open.step.id, r.step.id] });
          metrics.candidates++;
        }
        // A click that navigated (or a blocked control): start again from the page.
        if (new URL(page.url()).pathname !== new URL(state.url).pathname) {
          open = await ex.act({ type: "goto", path });
          if (!open.ok) break;
        }
      }
    } catch (err) {
      log(
        deps.sink,
        "warn",
        `The interaction sweep on ${path} stopped: ${String(err).split("\n")[0]}`,
      );
    } finally {
      journey.steps!.push(...ex.steps);
      await context.close().catch(() => undefined);
    }
  }
  journey.startRoute = journey.steps![0] ? pathAndQuery(journey.steps![0].urlAfter) : "/";
  return { candidates, journey: journey.steps!.length ? journey : undefined, metrics };
}
