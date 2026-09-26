// Check evaluator (SPEC FR-7): runs a Check against the live page and the journey's captured values.
// Deterministic: no LLM, no randomness. Three outcomes:
// - pass  — the expectation holds;
// - fail  — it doesn't (this becomes a candidate);
// - error — it couldn't be evaluated (target missing, no number to read). Never a candidate by itself.
import type { Locator as PwLocator, Page } from "playwright";
import type { Check, Locator, NumExpr, TextExpr } from "./language";
import { describeLocator, toPlaywright } from "./locate";
import { fmt, normaliseText, parseAmount } from "./parse";

export type Captured = number | string;

export interface ErrorsSince {
  pageErrors: string[];
  serverErrors: string[];
  consoleErrors: string[];
}

export interface RequestFact {
  method: string;
  path: string;
  status?: number;
}

export interface EvalContext {
  page: Page;
  /** Named values from `capture` checks; `capture` writes here. */
  captures: Map<string, Captured>;
  /** For noNewErrors: what went wrong since the journey's previous assert. */
  errorsSince?: () => ErrorsSince;
  /** For maxRequests: same-origin requests since the current step began. */
  requestsSince?: () => RequestFact[];
  /** For fieldRejected: the form's success signature. If it doesn't hold after submit, the value was rejected. */
  successCheck?: Check;
  /** How long to wait for a target to appear (ms). */
  waitMs?: number;
}

export interface CheckResult {
  status: "pass" | "fail" | "error";
  /** Plain-language outcome, used as the finding's "actual" text. */
  message: string;
  /** The values that were read, for evidence and the report. */
  observed: Record<string, unknown>;
  /** Type of the check that decided the outcome (for `all`, the first leaf that failed or errored). */
  leaf: string;
}

class EvalError extends Error {}
/** The target isn't on the page (as opposed to: it's there but shows no number). */
class MissingError extends EvalError {}

const DEFAULT_WAIT_MS = 1_500;

export async function evaluateCheck(check: Check, ctx: EvalContext): Promise<CheckResult> {
  const observed: Record<string, unknown> = {};
  try {
    return await evaluate(check, ctx, observed);
  } catch (err) {
    const message = err instanceof EvalError ? err.message : `Couldn't evaluate: ${firstLine(err)}`;
    return { status: "error", message, observed, leaf: check.type };
  }
}

async function evaluate(
  check: Check,
  ctx: EvalContext,
  observed: Record<string, unknown>,
): Promise<CheckResult> {
  const done = (pass: boolean, message: string): CheckResult => ({
    status: pass ? "pass" : "fail",
    message,
    observed,
    leaf: check.type,
  });
  switch (check.type) {
    case "visible": {
      const n = await visibleCount(ctx, check.target, "appear");
      observed.visibleCount = n;
      return done(
        n > 0,
        n > 0
          ? `${cap(describeLocator(check.target))} is visible.`
          : `${cap(describeLocator(check.target))} isn't visible.`,
      );
    }
    case "notVisible": {
      const n = await visibleCount(ctx, check.target, "disappear");
      observed.visibleCount = n;
      return done(
        n === 0,
        n === 0
          ? `${cap(describeLocator(check.target))} isn't visible.`
          : `${cap(describeLocator(check.target))} is still visible (${n} match${n === 1 ? "" : "es"}).`,
      );
    }
    case "textMatches":
    case "textNotMatches": {
      const text = await readText(ctx, check.target);
      observed.text = text;
      const matches = new RegExp(check.pattern, check.flags).test(text);
      const want = check.type === "textMatches";
      return done(
        matches === want,
        `${cap(describeLocator(check.target))} reads "${clip(text)}", which ${matches ? "matches" : "doesn't match"} /${check.pattern}/${check.flags ?? ""}.`,
      );
    }
    case "urlMatches": {
      const url = new URL(ctx.page.url());
      observed.url = `${url.pathname}${url.search}`;
      const re = new RegExp(check.pattern);
      const ok = re.test(url.href) || re.test(`${url.pathname}${url.search}`);
      return done(
        ok,
        `The address is ${url.pathname}${url.search}, which ${ok ? "matches" : "doesn't match"} /${check.pattern}/.`,
      );
    }
    case "numericRelation": {
      const left = await num(check.left, ctx);
      const right = await num(check.right, ctx);
      const money = left.money || right.money;
      const tol = check.tolerance ?? (money ? 0.01 : 1e-9);
      observed.left = left.value;
      observed.right = right.value;
      observed.tolerance = tol;
      const l = left.value;
      const r = right.value;
      const ok =
        check.op === "eq"
          ? Math.abs(l - r) <= tol
          : check.op === "lt"
            ? l < r
            : check.op === "lte"
              ? l <= r + tol
              : check.op === "gt"
                ? l > r
                : l >= r - tol;
      const sym = { eq: "=", lt: "<", lte: "≤", gt: ">", gte: "≥" }[check.op];
      const notSym = { eq: "≠", lt: "≥", lte: ">", gt: "≤", gte: "<" }[check.op];
      return done(
        ok,
        `${left.text} is ${fmt(l, money)}; ${right.text} is ${fmt(r, money)}. Expected ${fmt(l, money)} ${sym} ${fmt(r, money)}${check.op === "eq" ? ` (±${fmt(tol, false)})` : ""}, ${ok ? "and it holds" : `but ${fmt(l, money)} ${notSym} ${fmt(r, money)}`}.`,
      );
    }
    case "ordered": {
      const loc = toPlaywright(ctx.page, check.items);
      await waitAttached(loc, ctx.waitMs);
      const items = await loc.filter({ visible: true }).all();
      if (items.length < 2)
        throw new EvalError(
          `Need at least 2 items to check order; found ${items.length} (${describeLocator(check.items)}). If a search or filter is narrowing the list, clear it and check the full list.`,
        );
      const texts = await Promise.all(items.map((i) => innerText(i)));
      const keys: (number | string)[] = texts.map((t, i) => {
        if (check.read === "text") return normaliseText(t.split("\n")[0] ?? t);
        const a = parseAmount(t);
        if (!a) throw new EvalError(`Item ${i + 1} ("${clip(t)}") has no number to compare.`);
        return a.value;
      });
      observed.values = keys;
      for (let i = 1; i < keys.length; i++) {
        const cmp = compare(keys[i - 1]!, keys[i]!);
        const bad = check.direction === "asc" ? cmp > 0 : cmp < 0;
        if (bad) {
          return done(
            false,
            `Not in ${check.direction === "asc" ? "ascending" : "descending"} order: item ${i + 1} (${show(keys[i]!)}) comes after item ${i} (${show(keys[i - 1]!)}). Order seen: ${keys.slice(0, 10).map(show).join(", ")}${keys.length > 10 ? ", …" : ""}.`,
          );
        }
      }
      return done(
        true,
        `${keys.length} items are in ${check.direction === "asc" ? "ascending" : "descending"} order.`,
      );
    }
    case "capture": {
      const v = await value(check.value, ctx);
      ctx.captures.set(check.name, v.value);
      observed[check.name] = v.value;
      return done(true, `Captured ${check.name} = ${show(v.value)} (${v.text}).`);
    }
    case "equalsCaptured": {
      if (!ctx.captures.has(check.name))
        throw new EvalError(`Nothing was captured as "${check.name}" earlier in this journey.`);
      const before = ctx.captures.get(check.name)!;
      let now: Awaited<ReturnType<typeof value>>;
      try {
        now = await value(check.value, ctx);
      } catch (err) {
        // The value was captured earlier and the thing that showed it is gone now: that is a change,
        // not "can't evaluate" (e.g. a search in different letter case returns nothing).
        if (!(err instanceof MissingError)) throw err;
        observed.captured = before;
        observed.now = null;
        return done(
          false,
          `It was ${show(before)} when captured as "${check.name}", but now ${err.message.replace(/^Couldn't find /, "").replace(/ on the page\.$/, "")} isn't on the page at all.`,
        );
      }
      observed.captured = before;
      observed.now = now.value;
      let ok: boolean;
      if (typeof before === "number" && typeof now.value === "number") {
        const tol = check.tolerance ?? (now.money ? 0.01 : 1e-9);
        ok = Math.abs(before - now.value) <= tol;
      } else {
        ok = normaliseText(String(before)) === normaliseText(String(now.value));
      }
      return done(
        ok,
        ok
          ? `${cap(now.text)} is still ${show(now.value)}, as captured earlier.`
          : `${cap(now.text)} is now ${show(now.value)}, but it was ${show(before)} when captured as "${check.name}".`,
      );
    }
    case "fieldRejected": {
      const signal = await rejectionSignal(ctx, check.field);
      observed.rejection = signal ?? "none";
      return done(
        signal !== undefined,
        signal
          ? `The form refused the value: ${signal}.`
          : `The form accepted the value for ${describeLocator(check.field)}: no error was shown and the submission went through.`,
      );
    }
    case "noNewErrors": {
      const e = ctx.errorsSince?.() ?? { pageErrors: [], serverErrors: [], consoleErrors: [] };
      const all = [
        ...e.pageErrors.map((m) => `page error: ${m}`),
        ...e.serverErrors.map((m) => `server error: ${m}`),
        ...e.consoleErrors.map((m) => `console error: ${m}`),
      ];
      observed.errors = all;
      return done(
        all.length === 0,
        all.length === 0
          ? "No new errors."
          : `New errors: ${all
              .slice(0, 3)
              .map((s) => clip(s, 120))
              .join("; ")}.`,
      );
    }
    case "maxRequests": {
      const re = new RegExp(check.pathPattern);
      const hits = (ctx.requestsSince?.() ?? []).filter(
        (r) =>
          r.method.toUpperCase() === check.method.toUpperCase() &&
          re.test(r.path) &&
          r.status !== undefined &&
          r.status >= 200 &&
          r.status < 400,
      );
      observed.count = hits.length;
      return done(
        hits.length <= check.max,
        `${hits.length} successful ${check.method.toUpperCase()} request${hits.length === 1 ? "" : "s"} to ${hits[0]?.path ?? check.pathPattern} (expected at most ${check.max}).`,
      );
    }
    case "all": {
      const messages: string[] = [];
      for (const c of check.checks) {
        const r = await evaluate(c, ctx, observed);
        if (r.status !== "pass") return r;
        messages.push(r.message);
      }
      return done(true, messages.join(" "));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reading values

interface NumValue {
  value: number;
  money: boolean;
  /** How it was obtained, for messages: `"Total" ($178.54)`, `135.00 × 1.15`. */
  text: string;
}

async function num(e: NumExpr, ctx: EvalContext): Promise<NumValue> {
  if ("const" in e) return { value: e.const, money: false, text: fmt(e.const) };
  if ("captured" in e) {
    const v = ctx.captures.get(e.captured);
    if (typeof v !== "number") throw new EvalError(`No number was captured as "${e.captured}".`);
    return { value: v, money: false, text: `captured ${e.captured}` };
  }
  if ("count" in e) {
    const n = await visibleCount(ctx, e.count, "appear");
    return { value: n, money: false, text: `the number of ${plural(describeLocator(e.count))}` };
  }
  if ("read" in e) return readNumber(ctx, e.read);
  const a = await num(e.a, ctx);
  const b = await num(e.b, ctx);
  if (e.op === "div" && b.value === 0) throw new EvalError("Division by zero.");
  const value =
    e.op === "add"
      ? a.value + b.value
      : e.op === "sub"
        ? a.value - b.value
        : e.op === "mul"
          ? a.value * b.value
          : a.value / b.value;
  const sym = { add: "+", sub: "−", mul: "×", div: "÷" }[e.op];
  return { value, money: a.money || b.money, text: `${a.text} ${sym} ${b.text}` };
}

async function value(
  v: NumExpr | TextExpr,
  ctx: EvalContext,
): Promise<{ value: Captured; money: boolean; text: string }> {
  if ("capturedText" in v) {
    const c = ctx.captures.get(v.capturedText);
    if (c === undefined) throw new EvalError(`Nothing was captured as "${v.capturedText}".`);
    return { value: String(c), money: false, text: `captured ${v.capturedText}` };
  }
  if ("text" in v)
    return { value: await readText(ctx, v.text), money: false, text: describeLocator(v.text) };
  return num(v, ctx);
}

/**
 * The number an element shows. Rule (deterministic, documented in DEVLOG): the first non-percentage amount
 * in the element's own text (or an input's value). If the element is a label with no number of its own
 * ("Total"), the first amount that follows its text in the nearest enclosing row (up to 3 levels up).
 */
async function readNumber(ctx: EvalContext, target: Locator): Promise<NumValue> {
  const loc = await firstVisible(ctx, target);
  const facts = await loc.evaluate((el) => {
    const own =
      el instanceof HTMLSelectElement
        ? (el.selectedOptions[0]?.text ?? el.value)
        : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value
          : ((el as HTMLElement).innerText ?? el.textContent ?? "");
    const ancestors: string[] = [];
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) ancestors.push(p.innerText ?? "");
    return { own, ancestors };
  });
  const label = describeLocator(target);
  const direct = parseAmount(facts.own);
  if (direct)
    return { value: direct.value, money: direct.isMoney, text: `${label} (${direct.raw})` };
  const ownText = normaliseText(facts.own);
  for (const row of facts.ancestors) {
    const t = normaliseText(row);
    const at = ownText ? t.indexOf(ownText) : -1;
    if (at < 0) continue;
    const after = parseAmount(t.slice(at + ownText.length));
    if (after) return { value: after.value, money: after.isMoney, text: `${label} (${after.raw})` };
  }
  throw new EvalError(`${cap(label)} shows no number ("${clip(facts.own)}").`);
}

async function readText(ctx: EvalContext, target: Locator): Promise<string> {
  const loc = await firstVisible(ctx, target);
  const raw = await loc.evaluate((el) =>
    el instanceof HTMLSelectElement
      ? (el.selectedOptions[0]?.text ?? el.value)
      : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value
        : ((el as HTMLElement).innerText ?? el.textContent ?? ""),
  );
  return normaliseText(raw);
}

// ---------------------------------------------------------------------------------------------
// Locating

async function waitAttached(loc: PwLocator, waitMs = DEFAULT_WAIT_MS): Promise<void> {
  await loc
    .first()
    .waitFor({ state: "attached", timeout: waitMs })
    .catch(() => undefined);
}

/** The first visible match (respecting nth); an EvalError when there is none. */
async function firstVisible(ctx: EvalContext, target: Locator): Promise<PwLocator> {
  const loc = toPlaywright(ctx.page, target);
  const visible = loc.filter({ visible: true }).first();
  try {
    await visible.waitFor({ state: "visible", timeout: ctx.waitMs ?? DEFAULT_WAIT_MS });
  } catch {
    throw new MissingError(`Couldn't find ${describeLocator(target)} on the page.`);
  }
  return visible;
}

/**
 * Visible matches. "appear": wait up to waitMs for at least one (a check right after an action may race
 * rendering). "disappear": wait up to waitMs for none.
 */
async function visibleCount(
  ctx: EvalContext,
  target: Locator,
  mode: "appear" | "disappear",
): Promise<number> {
  const loc = toPlaywright(ctx.page, target).filter({ visible: true });
  const deadline = Date.now() + (ctx.waitMs ?? DEFAULT_WAIT_MS);
  let n = await loc.count();
  while (Date.now() < deadline && (mode === "appear" ? n === 0 : n > 0)) {
    await new Promise((r) => setTimeout(r, 100));
    n = await loc.count();
  }
  return n;
}

async function innerText(loc: PwLocator): Promise<string> {
  return loc.evaluate((el) => (el as HTMLElement).innerText ?? el.textContent ?? "");
}

/**
 * Why the form refused the field's value, or undefined if it didn't. Signals, in order: the field is
 * aria-invalid; the browser's own validation failed; an associated error message is visible; the form's
 * success signature didn't appear after submitting.
 */
async function rejectionSignal(ctx: EvalContext, field: Locator): Promise<string | undefined> {
  const loc = toPlaywright(ctx.page, field).first();
  if ((await loc.count()) > 0) {
    const s = await loc.evaluate((el) => {
      if (el.getAttribute("aria-invalid") === "true")
        return "the field is marked invalid (aria-invalid)";
      const v = (el as HTMLInputElement).validity;
      if (v && !v.valid)
        return `the browser's own validation stopped it (${(el as HTMLInputElement).validationMessage || "invalid"})`;
      const ids = [
        ...(el.getAttribute("aria-errormessage") ?? "").split(/\s+/),
        ...(el.getAttribute("aria-describedby") ?? "").split(/\s+/),
      ].filter(Boolean);
      for (const id of ids) {
        const m = document.getElementById(id) as HTMLElement | null;
        if (!m || !m.offsetParent) continue;
        const text = (m.innerText || "").trim();
        const errorish =
          id === el.getAttribute("aria-errormessage") ||
          m.getAttribute("role") === "alert" ||
          /error|invalid/i.test(m.className) ||
          /\b(required|invalid|must|please|can't|cannot|not valid|enter a valid|too (long|short))\b/i.test(
            text,
          );
        if (text && errorish) return `an error message is shown ("${text.slice(0, 100)}")`;
      }
      return undefined;
    });
    if (s) return s;
  }
  if (ctx.successCheck) {
    const success = await evaluateCheck(ctx.successCheck, {
      ...ctx,
      successCheck: undefined,
      waitMs: 500,
    });
    if (success.status !== "pass") return "the submission didn't reach its success state";
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

function compare(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

function show(v: Captured): string {
  return typeof v === "number" ? fmt(v) : `"${clip(v, 60)}"`;
}

function clip(s: string, max = 80): string {
  const t = normaliseText(s);
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(desc: string): string {
  return desc.replace(/^the /, "") + "s";
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}
