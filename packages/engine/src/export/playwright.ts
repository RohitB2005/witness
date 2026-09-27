// Regression-test exporter (SPEC FR-11, ARCHITECTURE.md §6). For every Confirmed or Likely bug that can be
// replayed without the LLM, write a Playwright Test file from the recorded steps (stored locators and
// values) and the finding's check or universal signature. Each test asserts the *correct* behaviour, so it
// fails while the bug exists and passes once it's fixed. Deterministic: the same run gives the same files.
//
// Secrets never appear in a file (SECURITY T14): typed login details become `secret("password")`, which
// reads WITNESS_TEST_USER / WITNESS_TEST_PASSWORD; the base URL is WITNESS_BASE_URL.
import type { Check, Locator, NumExpr, TextExpr } from "../oracle/language";
import type { Finding, RunResult, Step } from "../types";
import { CONFIG_SOURCE, HELPERS_SOURCE } from "./helpers-source";
import { DB_ERROR_SIGNATURES } from "../detectors/dberror";
import { SECRET_PATTERNS } from "../detectors/secrets";

export interface ExportedFile {
  name: string;
  content: string;
}

export interface ExportResult {
  files: ExportedFile[];
  /** finding id → spec file name */
  tests: Map<string, string>;
  skipped: { findingId: string; reason: string }[];
}

const q = (s: string) => JSON.stringify(s);

export function loc(l: Locator, root = "page"): string {
  const scope = l.within ? `${loc(l.within, root)}.first()` : root;
  let out: string;
  switch (l.by) {
    case "role": {
      const opts = [
        ...(l.name !== undefined ? [`name: ${q(l.name)}`] : []),
        ...(l.exact !== undefined ? [`exact: ${l.exact}`] : []),
      ];
      out = `${scope}.getByRole(${q(l.role)}${opts.length ? `, { ${opts.join(", ")} }` : ""})`;
      break;
    }
    case "label":
      out = `${scope}.getByLabel(${q(l.text)}${l.exact !== undefined ? `, { exact: ${l.exact} }` : ""})`;
      break;
    case "placeholder":
      out = `${scope}.getByPlaceholder(${q(l.text)})`;
      break;
    case "testId":
      out = `${scope}.getByTestId(${q(l.id)})`;
      break;
    case "text":
      out = `${scope}.getByText(${q(l.text)}${l.exact !== undefined ? `, { exact: ${l.exact} }` : ""})`;
      break;
    case "css":
      out = `${scope}.locator(${q(l.selector)})`;
      break;
  }
  return l.nth !== undefined ? `${out}.nth(${l.nth})` : out;
}

/** A typed value as code: login details come from the environment. */
export function valueCode(value: string): string {
  if (!/\{\{secret:/.test(value)) return q(value);
  const parts = value.split(/(\{\{secret:[a-zA-Z0-9_-]+\}\})/).filter(Boolean);
  return parts
    .map((p) => {
      const m = /^\{\{secret:([a-zA-Z0-9_-]+)\}\}$/.exec(p);
      if (!m) return q(p);
      return m[1] === "username" ? `secret("username")` : `secret("password")`;
    })
    .join(" + ");
}

function num(e: NumExpr): string {
  if ("const" in e) return String(e.const);
  if ("read" in e) return `(await readNumber(${loc(e.read)}))`;
  if ("count" in e) return `(await ${loc(e.count)}.filter({ visible: true }).count())`;
  if ("captured" in e) return `Number(captures[${q(e.captured)}])`;
  const op = { add: "+", sub: "-", mul: "*", div: "/" }[e.op];
  return `(${num(e.a)} ${op} ${num(e.b)})`;
}

function value(v: NumExpr | TextExpr): { code: string; text: boolean } {
  if ("text" in v) return { code: `(await readText(${loc(v.text)}))`, text: true };
  if ("capturedText" in v) return { code: `String(captures[${q(v.capturedText)}])`, text: true };
  return { code: num(v), text: false };
}

/** Code that is true when a check holds (for a form's success signature). */
function holds(c: Check): string {
  switch (c.type) {
    case "urlMatches":
      return `(new RegExp(${q(c.pattern)}).test(page.url()) || new RegExp(${q(c.pattern)}).test(new URL(page.url()).pathname + new URL(page.url()).search))`;
    case "visible":
      return `(await ${loc(c.target)}.filter({ visible: true }).count()) > 0`;
    case "all":
      return c.checks.map((x) => `(${holds(x)})`).join(" && ");
    default:
      return "true";
  }
}

/** Assertion lines for the correct behaviour a check describes. */
export function assertCheck(c: Check, successCheck?: Check): string[] {
  switch (c.type) {
    case "visible":
      return [`await expect(${loc(c.target)}.filter({ visible: true }).first()).toBeVisible();`];
    case "notVisible":
      return [`await expect(${loc(c.target)}.filter({ visible: true })).toHaveCount(0);`];
    case "notPresent":
      return [`await expect(${loc(c.target)}).toHaveCount(0);`];
    case "textMatches":
    case "textNotMatches":
      return [
        `expect(await readText(${loc(c.target)}))${c.type === "textNotMatches" ? ".not" : ""}.toMatch(new RegExp(${q(c.pattern)}${c.flags ? `, ${q(c.flags)}` : ""}));`,
      ];
    case "urlMatches":
      return [`expect(${holds(c)}).toBe(true);`];
    case "numericRelation": {
      const lines = [`const left = ${num(c.left)};`, `const right = ${num(c.right)};`];
      const tol = c.tolerance ?? (c.op === "eq" ? 0.01 : 0);
      switch (c.op) {
        case "eq":
          lines.push(`expect(Math.abs(left - right)).toBeLessThanOrEqual(${tol} + 1e-9);`);
          break;
        case "lt":
          lines.push(`expect(left).toBeLessThan(right);`);
          break;
        case "lte":
          lines.push(`expect(left).toBeLessThanOrEqual(right + ${tol});`);
          break;
        case "gt":
          lines.push(`expect(left).toBeGreaterThan(right);`);
          break;
        case "gte":
          lines.push(`expect(left).toBeGreaterThanOrEqual(right - ${tol});`);
          break;
      }
      return lines;
    }
    case "ordered":
      return [
        `const values = await itemValues(${loc(c.items)}, ${q(c.read)});`,
        `expect(values.length).toBeGreaterThanOrEqual(2);`,
        `expect(inOrder(values, ${q(c.direction)}), "order: " + values.join(", ")).toBe(true);`,
      ];
    case "equalsCaptured": {
      const v = value(c.value);
      return v.text
        ? [`expect(norm(${v.code})).toBe(norm(String(captures[${q(c.name)}])));`]
        : [
            `expect(Math.abs(${v.code} - Number(captures[${q(c.name)}]))).toBeLessThanOrEqual(${c.tolerance ?? 0.01});`,
          ];
    }
    case "fieldRejected":
      return [
        `expect(await refused(page, ${loc(c.field)}, w${successCheck ? `, async () => ${holds(successCheck)}` : ""}), "the form should refuse this value").toBe(true);`,
      ];
    case "maxRequests":
      return [
        `const hits = w.responses.slice(w.mark).filter((r) => r.method === ${q(c.method.toUpperCase())} && new RegExp(${q(c.pathPattern)}).test(r.path) && r.status >= 200 && r.status < 400);`,
        `expect(hits.length).toBeLessThanOrEqual(${c.max});`,
      ];
    case "noNewErrors":
      return [`expect(w.pageErrors).toEqual([]);`];
    case "linkWorks":
      return [
        `const href = await ${loc(c.link)}.first().getAttribute("href");`,
        `expect(href, "the link exists").not.toBeNull();`,
        `const res = await page.request.get(new URL(href!, page.url()).href);`,
        `expect(res.status(), "the link leads to a working page").toBeLessThan(400);`,
      ];
    case "all":
      return c.checks.flatMap((x, i) => [
        `{ // part ${i + 1}`,
        ...assertCheck(x).map((l) => `  ${l}`),
        "}",
      ]);
    case "capture":
      return [];
  }
}

/** The action lines for one recorded step (checks other than captures are skipped). */
function stepLines(s: Step): string[] {
  const a = s.action;
  const lines = [`// ${s.description.replace(/\n/g, " ")}`];
  switch (a.type) {
    case "goto":
      lines.push(`await page.goto(BASE_URL + ${q(a.path)});`, "await settle(page, w);");
      break;
    case "click":
      lines.push(
        "w.mark = w.responses.length;",
        `await ${loc(a.target)}.click(${a.clickCount === 2 ? "{ clickCount: 2 }" : ""});`,
        "await settle(page, w);",
      );
      break;
    case "fill":
      lines.push(`await ${loc(a.target)}.fill(${valueCode(a.value)});`);
      break;
    case "select":
      lines.push(`await selectOption(${loc(a.target)}, ${q(a.option)});`, "await settle(page, w);");
      break;
    case "press":
      lines.push(
        "w.mark = w.responses.length;",
        `await page.keyboard.press(${q(a.key)});`,
        "await settle(page, w);",
      );
      break;
    case "reload":
      lines.push("await page.reload();", "await settle(page, w);");
      break;
    case "scroll":
      lines.push(`await page.mouse.wheel(0, ${a.direction === "down" ? 600 : -600});`);
      break;
    case "wait":
      lines.push(`await page.waitForTimeout(${a.ms});`);
      break;
    case "check":
      if (a.check.type !== "capture") return [];
      lines.push(`captures[${q(a.check.name)}] = ${value(a.check.value).code};`);
      break;
  }
  return lines;
}

/** Why a finding can't become a test, or undefined if it can. */
function unexportable(f: Finding, steps: Map<string, Step>): string | undefined {
  if (f.kind !== "bug") return "only bugs are exported";
  if (f.tier !== "confirmed" && f.tier !== "likely") return `tier ${f.tier}`;
  const r = f.repro;
  if (!r) return "no replay facts";
  if (r.stepIds.some((id) => !steps.has(id))) return "its steps weren't recorded";
  if (f.source.kind === "judgement") return "a judgement has no deterministic assertion";
  if (f.source.kind === "requirement")
    return "a feature missing from the app can't be a regression test (nothing to assert on)";
  if (!r.check) {
    const sig = r.signature;
    if (sig.kind === "check_failed") return "its check wasn't recorded";
    if (
      sig.kind === "detector" &&
      ![
        "DET-BROKENIMG",
        "DET-BROKENLINK",
        "DET-OVERFLOW",
        "DET-CONSOLE",
        "DET-SECRETS",
        "DET-DBERROR",
        "DET-AUTHZ",
      ].includes(sig.detectorId)
    )
      return `no exported assertion for ${sig.detectorId}`;
  }
  return undefined;
}

/** The final assertion for a finding without a check: its universal signature. */
function signatureLines(f: Finding): string[] {
  const sig = f.repro!.signature;
  switch (sig.kind) {
    case "page_error":
      return [
        `const crashes = w.pageErrors.filter((e) => messagePrefix(e).startsWith(${q(sig.messagePrefix)}));`,
        `expect(crashes, "uncaught errors in the page").toEqual([]);`,
      ];
    case "http":
      return [
        `const failed = w.responses.filter((r) => r.method === ${q(sig.method)} && routePattern(r.path) === ${q(sig.pathPattern.split("?")[0]!)} && r.status >= ${sig.statusClass === "5xx" ? 500 : 400} && r.status < ${sig.statusClass === "5xx" ? 600 : 500});`,
        `expect(failed, "responses with status ${sig.statusClass}").toEqual([]);`,
      ];
    case "detector":
      switch (sig.detectorId) {
        case "DET-BROKENIMG":
          return [
            `const broken = await page.locator("img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).map((i) => new URL((i as HTMLImageElement).src).pathname));`,
            `expect(broken).not.toContain(${q(sig.key)});`,
          ];
        case "DET-BROKENLINK":
          return [
            `const res = await page.request.get(BASE_URL + ${q(f.signals.request?.path ?? sig.key)});`,
            `expect(res.status()).toBeLessThan(400);`,
          ];
        case "DET-OVERFLOW":
          return [
            `await page.setViewportSize({ width: 375, height: 667 });`,
            `await page.waitForTimeout(250);`,
            `const fits = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) <= document.documentElement.clientWidth + 1);`,
            `expect(fits, "the page fits a phone-width screen").toBe(true);`,
          ];
        case "DET-CONSOLE":
          return [
            `const errors = w.consoleErrors.filter((e) => messagePrefix(e).startsWith(${q(sig.key)}));`,
            `expect(errors).toEqual([]);`,
          ];
        case "DET-SECRETS": {
          // The pattern, never the key itself.
          const pattern = SECRET_PATTERNS.find((p) => sig.key.startsWith(`${p.id}|`));
          if (!pattern || !f.signals.request) return [];
          return [
            `const res = await page.request.get(BASE_URL + ${q(f.signals.request.path)});`,
            `expect(await res.text(), "no ${pattern.label} in the file").not.toMatch(new RegExp(${q(pattern.re.source)}));`,
          ];
        }
        case "DET-DBERROR": {
          const any = DB_ERROR_SIGNATURES.map((d) => d.re.source).join("|");
          const text = f.signals.request
            ? [
                `const res = await page.request.get(BASE_URL + ${q(f.signals.request.path)});`,
                "const text = await res.text();",
              ]
            : [`const text = await page.locator("body").innerText();`];
          return [
            ...text,
            `expect(text, "no database error is shown").not.toMatch(new RegExp(${q(any)}, "i"));`,
          ];
        }
        case "DET-AUTHZ":
          if (!f.signals.request) return [];
          return [
            "// Not logged in: the page's browser context has no cookies.",
            `const res = await page.request.get(BASE_URL + ${q(f.signals.request.path)}, { maxRedirects: 0 });`,
            `expect(res.status(), "the API refuses a request without a login").toBeGreaterThanOrEqual(400);`,
          ];
      }
      return [];
    default:
      return [];
  }
}

export function exportTests(result: RunResult): ExportResult {
  const steps = new Map<string, Step>();
  for (const j of result.journeys) for (const s of j.steps ?? []) steps.set(s.id, s);
  const out: ExportResult = { files: [], tests: new Map(), skipped: [] };
  const origin = result.scope;
  for (const f of result.findings) {
    const why = unexportable(f, steps);
    if (why) {
      if (f.kind === "bug" && (f.tier === "confirmed" || f.tier === "likely"))
        out.skipped.push({ findingId: f.id, reason: why });
      continue;
    }
    const r = f.repro!;
    const recorded = r.stepIds
      .map((id) => steps.get(id)!)
      .filter((s) => s.ok || s.action.type === "check");
    const target = r.signature.kind === "check_failed" ? r.signature.expectationId : undefined;
    const body: string[] = [];
    if (r.session === "authenticated") {
      if (!result.loginPath) {
        out.skipped.push({ findingId: f.id, reason: "the login page isn't known" });
        continue;
      }
      body.push(`await logIn(page, BASE_URL + ${q(result.loginPath)});`);
    }
    body.push("w.mark = w.responses.length;");
    const path = recorded.length
      ? recorded.filter((s) => !(s.action.type === "check" && s.action.expectationId === target))
      : [];
    if (!path.length) {
      const u = new URL(r.url);
      body.push(
        `await page.goto(BASE_URL + ${q(u.pathname + u.search)});`,
        "await settle(page, w);",
      );
    }
    for (const s of path) body.push(...stepLines(s));
    body.push("// The correct behaviour (this fails while the bug exists):");
    body.push(...(r.check ? assertCheck(r.check, r.successCheck) : signatureLines(f)));
    const file = `${f.id}.spec.ts`;
    const needsCaptures = body.some((l) => l.includes("captures["));
    const content = [
      "// Generated by Witness from a verified finding. It asserts the correct behaviour: it fails while the",
      "// bug exists and passes once it's fixed. Set WITNESS_BASE_URL (and WITNESS_TEST_USER /",
      "// WITNESS_TEST_PASSWORD for logged-in steps) before running.",
      `// Finding ${f.id} (${f.fingerprint}) — ${f.tier}, ${f.severity}: ${f.title.replace(/\n/g, " ")}`,
      `import { test, expect } from "@playwright/test";`,
      `import { BASE_URL as ENV_URL, inOrder, itemValues, logIn, messagePrefix, norm, readNumber, readText, refused, routePattern, secret, selectOption, settle, watch } from "./witness-helpers";`,
      "",
      `const BASE_URL = ENV_URL || ${q(origin)};`,
      "",
      ...(r.viewport === "mobile"
        ? [`test.use({ viewport: { width: 375, height: 667 } });`, ""]
        : []),
      `test(${q(`${f.title.slice(0, 100)} [${f.id}]`)}, async ({ page }) => {`,
      "  const w = watch(page, BASE_URL);",
      ...(needsCaptures ? ["  const captures: Record<string, string | number> = {};"] : []),
      ...body.map((l) => `  ${l}`),
      "});",
      "",
    ].join("\n");
    out.files.push({ name: file, content });
    out.tests.set(f.id, file);
  }
  if (out.files.length) {
    out.files.push({ name: "witness-helpers.ts", content: HELPERS_SOURCE });
    out.files.push({ name: "playwright.config.ts", content: CONFIG_SOURCE });
  }
  return out;
}
