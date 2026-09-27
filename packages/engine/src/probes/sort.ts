// DET-SORT (P3, D46): for every sort control the crawl saw, open its page without any search or filter,
// apply each option whose order can be read from its label ("Price: low to high", "Name (Z to A)"), and
// check the list is in that order with the `ordered` check. The option's own label is the grounding.
// Options with no checkable order ("Recommended", "Newest") are skipped. Read-only: a write-blocking
// policy is used, whatever the scan mode.
import type { Page } from "playwright";
import { routePattern } from "../crawl/normalise";
import { log } from "../events";
import { newId } from "../ids";
import { indexSnapshot } from "../explore/locators";
import type { Check, Locator } from "../oracle/language";
import type { Candidate, Expectation, Journey, PageState } from "../types";
import { automaticJourney, CSS_PATH_FN, firstUnique, openProbe, type ProbeDeps } from "./common";

export interface SortOrder {
  read: "number" | "text";
  direction: "asc" | "desc";
  key: string;
}

const DASH = "(?:to|-|–|—|→)";
const NUMBER_KEY = /price|cost|cheap|expensive|\bfees?\b|\brate\b|amount/i;
const TEXT_KEY = new RegExp(
  `\\bname\\b|\\btitle\\b|alphabetical|\\ba\\s?${DASH}\\s?z\\b|\\bz\\s?${DASH}\\s?a\\b`,
  "i",
);
const ASC = new RegExp(
  `low(est)?\\s*${DASH}\\s*high|ascending|\\basc\\b|cheapest|lowest first|\\ba\\s?${DASH}\\s?z\\b`,
  "i",
);
const DESC = new RegExp(
  `high(est)?\\s*${DASH}\\s*low|descending|\\bdesc\\b|most expensive|highest first|\\bz\\s?${DASH}\\s?a\\b`,
  "i",
);

/** The order an option label promises, or undefined if it promises none that code can check. */
export function sortOrder(label: string): SortOrder | undefined {
  const asc = ASC.test(label);
  const desc = DESC.test(label);
  if (asc === desc) return undefined;
  const direction = asc ? "asc" : "desc";
  if (NUMBER_KEY.test(label)) return { read: "number", direction, key: "price" };
  if (TEXT_KEY.test(label)) return { read: "text", direction, key: "name" };
  return undefined;
}

export interface SortControl {
  state: PageState;
  name: string;
  options: string[];
}

/** Sort dropdowns in a snapshot: named like a sort control, or with ≥ 2 options that promise an order. */
export function sortControls(snapshot: string): { name: string; options: string[] }[] {
  const out: { name: string; options: string[] }[] = [];
  const lines = snapshot.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = clean(lines[i]!);
    const m = /^combobox(?: "((?:[^"\\]|\\.)*)")?/.exec(t);
    if (!m) continue;
    const indent = lines[i]!.length - lines[i]!.trimStart().length;
    const options: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.length - line.trimStart().length <= indent) break;
      const o = /^option "((?:[^"\\]|\\.)*)"/.exec(clean(line));
      if (o) options.push(unescape(o[1]!));
    }
    const name = unescape(m[1] ?? "");
    const ordered = options.filter((o) => sortOrder(o)).length;
    if ((/sort|order by|arrange/i.test(name) && ordered >= 1) || ordered >= 2)
      out.push({ name, options });
  }
  return out;
}

function clean(line: string): string {
  return line
    .trim()
    .replace(/^- /, "")
    .replace(/^'(.*)'$/, "$1");
}

function unescape(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

// The item group a sort reorders: the largest set (≥ 3) of same-tag siblings; for a price sort every item
// must show a money amount. Returns the container's test id and CSS path, and the items' tag.
const LIST_SCRIPT = (wantMoney: boolean) => `(() => {
  const cssPath = ${CSS_PATH_FN};
  const MONEY = /[$€£¥]\\s?\\d|\\b\\d+\\.\\d{2}\\b/;
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  let best = null;
  for (const parent of Array.from(document.querySelectorAll("body *"))) {
    if (parent.closest("nav, header, footer, select, [role=navigation]")) continue;
    const kids = Array.from(parent.children).filter(visible);
    if (kids.length < 3) continue;
    const tag = kids[0].tagName;
    const same = kids.filter((k) => k.tagName === tag);
    if (same.length < 3 || same.length < kids.length * 0.8) continue;
    const money = same.filter((k) => MONEY.test(k.innerText || "")).length;
    if (${wantMoney} && money < same.length) continue;
    const score = same.length + (money === same.length ? 1000 : 0);
    if (!best || score > best.score) best = { parent, tag, score };
  }
  if (!best) return null;
  return {
    testId: best.parent.getAttribute("data-testid") || undefined,
    css: cssPath(best.parent),
    tag: best.tag.toLowerCase(),
  };
})()`;

async function itemsLocator(page: Page, wantMoney: boolean): Promise<Locator | undefined> {
  const found = (await page.evaluate(LIST_SCRIPT(wantMoney)).catch(() => null)) as {
    testId?: string;
    css: string;
    tag: string;
  } | null;
  if (!found) return undefined;
  const within = await firstUnique(
    page,
    found.testId ? [{ by: "testId", id: found.testId }] : [],
    found.css,
  );
  return { by: "css", selector: `:scope > ${found.tag}`, within };
}

export async function sortProbe(
  deps: ProbeDeps,
): Promise<{ candidates: Candidate[]; journey?: Journey; metrics: Record<string, number> }> {
  const metrics = { controls: 0, optionsChecked: 0, candidates: 0 };
  const controls: SortControl[] = [];
  const seen = new Set<string>();
  for (const state of deps.crawl.states) {
    if ((state.status ?? 200) >= 400 && !state.appRendered) continue;
    for (const c of sortControls(deps.crawl.snapshots.get(state.id) ?? "")) {
      const key = `${new URL(state.url).pathname}|${c.name}|${state.session}`;
      if (seen.has(key)) continue;
      seen.add(key);
      controls.push({ state, ...c });
    }
  }
  if (!controls.length) return { candidates: [], metrics };
  const journey = automaticJourney(
    "Sort controls (automatic check)",
    "Apply each sort option to the full, unfiltered list and check the order it promises.",
    new URL(controls[0]!.state.url).pathname,
  );
  const candidates: Candidate[] = [];
  for (const control of controls.slice(0, 3)) {
    metrics.controls++;
    const path = new URL(control.state.url).pathname; // unfiltered: no search or filter parameters
    const { context, page, ex } = await openProbe(deps, journey, {
      session: control.state.session,
      readOnly: true,
    });
    try {
      for (const option of control.options) {
        const order = sortOrder(option);
        if (!order) continue;
        if (Date.now() > deps.deadline) break;
        const start = ex.steps.length;
        const go = await ex.act({ type: "goto", path });
        if (!go.ok) break;
        const index = indexSnapshot(ex.current?.capture.snapshot ?? "");
        const ref = [...index.entries()].find(
          ([, n]) => n.role === "combobox" && n.name === control.name,
        )?.[0];
        if (!ref) break;
        const chose = await ex.act({ type: "select", target: { ref }, option });
        if (!chose.ok) continue;
        const items = await itemsLocator(page, order.read === "number");
        if (!items) continue;
        const check: Check = {
          type: "ordered",
          items,
          read: order.read,
          direction: order.direction,
        };
        const exp: Expectation = {
          id: newId("ex"),
          journeyId: journey.id,
          statement: `Choosing "${option}" lists the items in ${order.direction === "asc" ? "ascending" : "descending"} order of ${order.key}`,
          check,
          grounding: { kind: "ui_text", quote: option, verified: true },
          impact: "wrong-info",
          category: "functional",
          origin: "probe",
        };
        journey.expectations.push(exp);
        metrics.optionsChecked++;
        const r = await ex.check(check, { expectationId: exp.id, statement: exp.statement });
        if (r.result.status !== "fail") continue;
        const cur = ex.current;
        // The finding is about the control on its page, whether or not the app puts the choice in the URL,
        // so the route is the page's own path (stable across apps and runs).
        const route = routePattern(new URL(path, page.url()));
        candidates.push({
          id: newId("cd"),
          kind: "bug",
          source: { kind: "detector", id: "DET-SORT" },
          category: "functional",
          route,
          url: page.url(),
          stateId: cur?.state.id,
          session: control.state.session,
          viewport: "desktop",
          journeyId: journey.id,
          stepIds: ex.steps.slice(start).map((s) => s.id),
          evidenceIds: [r.evidenceId, ...(cur ? [cur.capture.evidence.screenshot] : [])],
          signature: {
            kind: "detector",
            detectorId: "DET-SORT",
            key: `${path}|${control.name}|${option}`,
          },
          groupKey: `sort|${path}|${option.toLowerCase()}`,
          signals: {},
          detail: {
            title: `"${option}" doesn't sort the list on ${path} in that order`,
            impact:
              "People are shown the list in the wrong order, so they may miss what they're looking for.",
            expected: `After choosing "${option}", the items are in ${order.direction === "asc" ? "ascending" : "descending"} order of ${order.key}.`,
            actual: r.result.message,
            whyFlagged: `DET-SORT: the sort option's own label ("${option}") promises an order, and the full list isn't in it.`,
          },
          summary: `"${option}" on ${path}: ${r.result.message}`,
          check,
          grounding: { kind: "ui_text", verified: true, quote: option },
        });
        metrics.candidates++;
      }
    } catch (err) {
      log(deps.sink, "warn", `The sort check on ${path} stopped: ${String(err).split("\n")[0]}`);
    } finally {
      journey.steps!.push(...ex.steps);
      await context.close().catch(() => undefined);
    }
  }
  return { candidates, journey, metrics };
}
