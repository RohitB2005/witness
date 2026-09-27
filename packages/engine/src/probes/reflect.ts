// Reflected-input probe (P3, D46): put the inert XSS canary (SECURITY.md §3 — an empty <i> element, never a
// script) into the GET query parameters the crawl saw and into GET search forms, then run DET-XSS: if an
// element carrying the canary's attribute exists, the input was inserted into the page as HTML. GET only,
// under a write-blocking policy, so it's allowed in production mode too.
//
// Each parameter and search box also gets one ordinary input full of quote characters (ADDENDUM A4). Nothing
// is checked here: the run-level response observer sees the reply, and DET-DBERROR reports a database error
// in it. No attack payloads, only punctuation a real name or search could contain.
import { routePattern } from "../crawl/normalise";
import { log } from "../events";
import { newId } from "../ids";
import { xssGroupKey } from "../explore/edge";
import type { Check, Locator } from "../oracle/language";
import type { Candidate, Journey } from "../types";
import {
  automaticJourney,
  CSS_PATH_FN,
  firstUnique,
  openProbe,
  pathAndQuery,
  type ProbeDeps,
} from "./common";

const MAX_PARAMS = 6;
const MAX_FORMS = 3;

/** Plain text with apostrophes and double quotes, as a real name or search could contain. */
export const QUOTE_INPUT = `O'Neill's "quoted" test`;

export function canary(token: string): string {
  return `"><i data-witness-canary="${token}"></i>`;
}

/** Distinct (path, parameter) pairs from same-origin URLs, e.g. /books?genre=x → ("/books", "genre"). */
export function queryParams(
  urls: string[],
  origin: string,
): { path: string; param: string; url: URL }[] {
  const out: { path: string; param: string; url: URL }[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    for (const param of new Set(url.searchParams.keys())) {
      const key = `${url.pathname}|${param}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: url.pathname, param, url });
    }
  }
  return out;
}

interface SearchForm {
  label?: string;
  placeholder?: string;
  name?: string;
  css: string;
}

// GET search forms: role=search, or a form with a search box, with no password field and at most two
// text-like fields. Returns how to find the search field.
const FIND_SEARCH_FORMS = `(() => {
  const cssPath = ${CSS_PATH_FN};
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const out = [];
  for (const form of Array.from(document.querySelectorAll("form"))) {
    const method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") continue;
    if (form.querySelector('input[type="password"]')) continue;
    const fields = Array.from(form.querySelectorAll('input:not([type]), input[type="text"], input[type="search"]')).filter(visible);
    if (!fields.length || fields.length > 2) continue;
    const isSearch = form.getAttribute("role") === "search" || fields.some((f) => f.type === "search" || /^(q|query|search|s|keywords?)$/i.test(f.name || ""));
    if (!isSearch) continue;
    const f = fields.find((x) => x.type === "search") || fields[0];
    out.push({
      label: ((f.labels && f.labels[0] && f.labels[0].innerText) || f.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim() || undefined,
      placeholder: f.getAttribute("placeholder") || undefined,
      name: f.getAttribute("name") || undefined,
      css: cssPath(f),
    });
  }
  return out;
})()`;

export async function reflectProbe(
  deps: ProbeDeps,
): Promise<{ candidates: Candidate[]; journey?: Journey; metrics: Record<string, number> }> {
  const metrics = { params: 0, forms: 0, candidates: 0 };
  const origin = deps.policy.origin;
  const params = queryParams(
    [...deps.crawl.states.map((s) => s.url), ...deps.crawl.linkUrls],
    origin,
  ).slice(0, MAX_PARAMS);
  const journey = automaticJourney(
    "Reflected input (automatic check)",
    "Put an inert HTML marker into address parameters and search boxes and check it's shown as text.",
    "/",
  );
  const candidates: Candidate[] = [];
  const found = (
    session: Candidate["session"],
    where: string,
    /** The page path the input was on, and the field or parameter name (for the group key). */
    origin: { path: string; field: string },
    stepIds: string[],
    token: string,
    url: string,
    evidenceIds: string[],
    stateId?: string,
  ) => {
    const route = routePattern(url);
    const check: Check = {
      type: "notPresent",
      target: { by: "css", selector: `[data-witness-canary="${token}"]` },
    };
    candidates.push({
      id: newId("cd"),
      kind: "bug",
      source: { kind: "detector", id: "DET-XSS" },
      category: "security",
      route,
      url,
      stateId,
      session,
      viewport: "desktop",
      journeyId: journey.id,
      stepIds,
      evidenceIds,
      signature: { kind: "detector", detectorId: "DET-XSS", key: `${route}|${where}` },
      groupKey: xssGroupKey(origin.path, origin.field),
      signals: {},
      detail: {
        title: `${where} is inserted into the page as HTML (XSS risk)`,
        impact: "An attacker could make the page run their own code in other people's browsers.",
        expected: `${where} is shown as plain text.`,
        actual: `An inert marker element put into ${where.charAt(0).toLowerCase()}${where.slice(1)} appeared as a real element on ${route}.`,
        whyFlagged:
          "DET-XSS: an inert canary element was rendered as HTML instead of text (it's never a script).",
      },
      summary: `Unescaped input: ${where}`,
      check,
    });
    metrics.candidates++;
  };

  // Group the work by session so each probe browser is opened once.
  const seenForms = new Set<string>();
  const sessions = new Set(deps.crawl.states.map((s) => s.session));
  for (const session of sessions) {
    if (Date.now() > deps.deadline) break;
    const { context, page, ex } = await openProbe(deps, journey, { session, readOnly: true });
    try {
      // 1. Query parameters.
      for (const p of params) {
        if (Date.now() > deps.deadline) break;
        if (
          !deps.crawl.states.some(
            (s) => s.session === session && new URL(s.url).pathname === p.path,
          )
        )
          continue;
        const token = Math.random().toString(36).slice(2, 10);
        const url = new URL(p.url.href);
        url.searchParams.set(p.param, canary(token));
        metrics.params++;
        const go = await ex.act({ type: "goto", path: pathAndQuery(url.href) });
        if (!go.ok) continue;
        if (
          (await page
            .locator(`[data-witness-canary="${token}"]`)
            .count()
            .catch(() => 0)) > 0
        ) {
          const evidenceId = await deps.evidence.put("dom_probe", {
            kind: "xss-canary",
            url: page.url(),
            param: p.param,
            found: true,
          });
          found(
            session,
            `The "${p.param}" address parameter`,
            { path: p.path, field: `param:${p.param}` },
            [go.step.id],
            token,
            page.url(),
            [evidenceId, ...(ex.current ? [ex.current.capture.evidence.screenshot] : [])],
            ex.current?.state.id,
          );
        }
        const quoted = new URL(p.url.href);
        quoted.searchParams.set(p.param, QUOTE_INPUT);
        await ex.act({ type: "goto", path: pathAndQuery(quoted.href) });
      }
      // 2. GET search forms (the same form often repeats across pages, e.g. in a header: test it once).
      let forms = 0;
      for (const state of deps.crawl.states.filter((s) => s.session === session).slice(0, 12)) {
        if (Date.now() > deps.deadline || forms >= MAX_FORMS) break;
        if ((state.status ?? 200) >= 400 && !state.appRendered) continue;
        const path = pathAndQuery(state.url);
        const go = await ex.act({ type: "goto", path });
        if (!go.ok) continue;
        const list = (await page.evaluate(FIND_SEARCH_FORMS).catch(() => [])) as SearchForm[];
        for (const f of list) {
          const formKey = `${f.label ?? ""}|${f.placeholder ?? ""}|${f.name ?? ""}`;
          if (seenForms.has(formKey) || forms >= MAX_FORMS) continue;
          seenForms.add(formKey);
          forms++;
          metrics.forms++;
          const candidatesFor: Locator[] = [
            ...(f.label ? [{ by: "label", text: f.label, exact: true } as const] : []),
            ...(f.placeholder ? [{ by: "placeholder", text: f.placeholder } as const] : []),
            ...(f.name && /^[\w-]+$/.test(f.name)
              ? [{ by: "css", selector: `[name="${f.name}"]` } as const]
              : []),
          ];
          const field = await firstUnique(page, candidatesFor, f.css);
          const token = Math.random().toString(36).slice(2, 10);
          const typed = await ex.act({ type: "fill", target: field, value: canary(token) });
          if (!typed.ok) continue;
          const sent = await ex.act({ type: "press", key: "Enter" });
          if (!sent.ok) continue;
          if (
            (await page
              .locator(`[data-witness-canary="${token}"]`)
              .count()
              .catch(() => 0)) > 0
          ) {
            const evidenceId = await deps.evidence.put("dom_probe", {
              kind: "xss-canary",
              url: page.url(),
              field: f.label ?? f.placeholder ?? f.name,
              found: true,
            });
            found(
              session,
              `Text typed into the "${f.label ?? f.placeholder ?? f.name ?? "search"}" search box`,
              {
                path: new URL(state.url).pathname,
                field: f.label ?? f.placeholder ?? f.name ?? "search",
              },
              [go.step.id, typed.step.id, sent.step.id],
              token,
              page.url(),
              [evidenceId, ...(ex.current ? [ex.current.capture.evidence.screenshot] : [])],
              ex.current?.state.id,
            );
          }
          if ((await ex.act({ type: "fill", target: field, value: QUOTE_INPUT })).ok)
            await ex.act({ type: "press", key: "Enter" });
        }
      }
    } catch (err) {
      log(deps.sink, "warn", `The reflected-input check stopped: ${String(err).split("\n")[0]}`);
    } finally {
      journey.steps!.push(...ex.steps);
      await context.close().catch(() => undefined);
    }
  }
  journey.startRoute = journey.steps![0] ? pathAndQuery(journey.steps![0].urlAfter) : "/";
  return { candidates, journey: journey.steps!.length ? journey : undefined, metrics };
}
