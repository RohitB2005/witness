// The check language (AI_AGENT_SPEC.md §6): how an expectation says what "correct" looks like, as data.
// The LLM writes checks; only code evaluates them (oracle/evaluate.ts). Two variants share one shape:
// - `Check`: stored, replayable, ref-free (semantic locators only). This is what Planner output, steps,
//   candidates and exported tests use.
// - `AgentCheck`: what the Explorer may send, where `{ ref: "e14" }` can stand in for a locator. The
//   executor converts every ref to a stable locator before the check is stored (explore/locators.ts).
// This file depends only on zod so types.ts can import it without a cycle.
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Locators

type LocatorBase =
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "label"; text: string; exact?: boolean }
  | { by: "placeholder"; text: string }
  | { by: "testId"; id: string }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "css"; selector: string };
export type Locator = LocatorBase & { within?: Locator; nth?: number };

const locatorModifiers = {
  within: z.lazy((): z.ZodType<Locator> => LocatorSchema).optional(),
  nth: z.number().int().nonnegative().optional(),
};
export const LocatorSchema: z.ZodType<Locator> = z.union([
  z.strictObject({
    by: z.literal("role"),
    role: z.string().min(1),
    name: z.string().optional(),
    exact: z.boolean().optional(),
    ...locatorModifiers,
  }),
  z.strictObject({
    by: z.literal("label"),
    text: z.string().min(1),
    exact: z.boolean().optional(),
    ...locatorModifiers,
  }),
  z.strictObject({ by: z.literal("placeholder"), text: z.string().min(1), ...locatorModifiers }),
  z.strictObject({ by: z.literal("testId"), id: z.string().min(1), ...locatorModifiers }),
  z.strictObject({
    by: z.literal("text"),
    text: z.string().min(1),
    exact: z.boolean().optional(),
    ...locatorModifiers,
  }),
  z.strictObject({ by: z.literal("css"), selector: z.string().min(1), ...locatorModifiers }),
]);

/** A ref from the current AI-mode aria snapshot, e.g. `{ ref: "e14" }`. Never stored. */
export interface RefLoc {
  ref: string;
}
export const RefLocSchema: z.ZodType<RefLoc> = z.strictObject({
  ref: z.string().regex(/^[a-z0-9]+$/i, "a ref looks like e14 or f1e14"),
});

// ---------------------------------------------------------------------------------------------
// Expressions and checks, generic over the locator type

export type NumExprOf<L> =
  | { const: number }
  | { read: L }
  | { count: L }
  | { captured: string }
  | { op: "add" | "sub" | "mul" | "div"; a: NumExprOf<L>; b: NumExprOf<L> };

export type TextExprOf<L> = { text: L } | { capturedText: string };

export type CheckOf<L> =
  | { type: "visible"; target: L }
  | { type: "notVisible"; target: L }
  | { type: "textMatches"; target: L; pattern: string; flags?: "i" }
  | { type: "textNotMatches"; target: L; pattern: string; flags?: "i" }
  | { type: "urlMatches"; pattern: string }
  | {
      type: "numericRelation";
      left: NumExprOf<L>;
      op: "eq" | "lt" | "lte" | "gt" | "gte";
      right: NumExprOf<L>;
      tolerance?: number;
    }
  | { type: "ordered"; items: L; read: "number" | "text"; direction: "asc" | "desc" }
  | { type: "capture"; name: string; value: NumExprOf<L> | TextExprOf<L> }
  | {
      type: "equalsCaptured";
      name: string;
      value: NumExprOf<L> | TextExprOf<L>;
      tolerance?: number;
    }
  | { type: "fieldRejected"; field: L }
  /**
   * No element matches at all, visible or not (P3, DEVLOG D52): the inert XSS canary must never become a
   * real element. Stored checks only; not described to the LLM.
   */
  | { type: "notPresent"; target: L }
  /**
   * The link, as it is on the page now, leads to a working page (status < 400). Stored checks only (P3):
   * a fixed link may point somewhere new, so a replay or test must follow it rather than re-request the
   * old broken URL.
   */
  | { type: "linkWorks"; link: L }
  | { type: "noNewErrors" }
  /**
   * At most `max` same-origin requests with this method and path (regex) completed successfully (2xx/3xx)
   * since the step began. Added in P2 (DEVLOG D30) so duplicate submissions are a replayable check.
   */
  | { type: "maxRequests"; method: string; pathPattern: string; max: number }
  | { type: "all"; checks: CheckOf<L>[] };

export type NumExpr = NumExprOf<Locator>;
export type TextExpr = TextExprOf<Locator>;
export type Check = CheckOf<Locator>;
export type AgentLoc = Locator | RefLoc;
export type AgentCheck = CheckOf<AgentLoc>;

const Regex = z.string().refine(
  (p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  },
  { message: "not a valid regular expression" },
);
const Name = z.string().min(1).max(60);

function build<L>(loc: z.ZodType<L>) {
  const num: z.ZodType<NumExprOf<L>> = z.lazy(() =>
    z.union([
      z.strictObject({ const: z.number() }),
      z.strictObject({ read: loc }),
      z.strictObject({ count: loc }),
      z.strictObject({ captured: Name }),
      z.strictObject({ op: z.enum(["add", "sub", "mul", "div"]), a: num, b: num }),
    ]),
  );
  const text: z.ZodType<TextExprOf<L>> = z.union([
    z.strictObject({ text: loc }),
    z.strictObject({ capturedText: Name }),
  ]);
  const tolerance = z.number().nonnegative().optional();
  const check: z.ZodType<CheckOf<L>> = z.lazy(() =>
    z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("visible"), target: loc }),
      z.strictObject({ type: z.literal("notVisible"), target: loc }),
      z.strictObject({
        type: z.literal("textMatches"),
        target: loc,
        pattern: Regex,
        flags: z.literal("i").optional(),
      }),
      z.strictObject({
        type: z.literal("textNotMatches"),
        target: loc,
        pattern: Regex,
        flags: z.literal("i").optional(),
      }),
      z.strictObject({ type: z.literal("urlMatches"), pattern: Regex }),
      z.strictObject({
        type: z.literal("numericRelation"),
        left: num,
        op: z.enum(["eq", "lt", "lte", "gt", "gte"]),
        right: num,
        tolerance,
      }),
      z.strictObject({
        type: z.literal("ordered"),
        items: loc,
        read: z.enum(["number", "text"]),
        direction: z.enum(["asc", "desc"]),
      }),
      z.strictObject({ type: z.literal("capture"), name: Name, value: z.union([num, text]) }),
      z.strictObject({
        type: z.literal("equalsCaptured"),
        name: Name,
        value: z.union([num, text]),
        tolerance,
      }),
      z.strictObject({ type: z.literal("fieldRejected"), field: loc }),
      z.strictObject({ type: z.literal("notPresent"), target: loc }),
      z.strictObject({ type: z.literal("linkWorks"), link: loc }),
      z.strictObject({ type: z.literal("noNewErrors") }),
      z.strictObject({
        type: z.literal("maxRequests"),
        method: z.string().min(1),
        pathPattern: Regex,
        max: z.number().int().nonnegative(),
      }),
      z.strictObject({ type: z.literal("all"), checks: z.array(check).min(1).max(8) }),
    ]),
  );
  return { num, text, check };
}

export const {
  num: NumExprSchema,
  text: TextExprSchema,
  check: CheckSchema,
} = build(LocatorSchema);
const AgentLocSchema: z.ZodType<AgentLoc> = z.union([RefLocSchema, LocatorSchema]);
export const { check: AgentCheckSchema } = build(AgentLocSchema);

export function isRef(loc: AgentLoc): loc is RefLoc {
  return "ref" in loc;
}

/** The type of the check that decides the outcome, for reporting (`all` → its first leaf). */
export function leafType(check: CheckOf<unknown>): string {
  return check.type === "all" && check.checks[0] ? leafType(check.checks[0]) : check.type;
}

/** How a locator is used: one element, or every matching item (`ordered.items`, `count`). */
export type LocatorUse = "single" | "items";

/**
 * Rewrites every locator in a check (e.g. ref → stable locator). `mapLoc` is async because resolving a
 * ref needs the live page, and is told whether the position wants one element or a set of items.
 */
export async function mapCheckLocators<A, B>(
  check: CheckOf<A>,
  mapLoc: (loc: A, use: LocatorUse) => Promise<B>,
): Promise<CheckOf<B>> {
  const num = async (e: NumExprOf<A>): Promise<NumExprOf<B>> => {
    if ("read" in e) return { read: await mapLoc(e.read, "single") };
    if ("count" in e) return { count: await mapLoc(e.count, "items") };
    if ("op" in e) return { op: e.op, a: await num(e.a), b: await num(e.b) };
    return e;
  };
  const value = async (v: NumExprOf<A> | TextExprOf<A>): Promise<NumExprOf<B> | TextExprOf<B>> => {
    if ("text" in v) return { text: await mapLoc(v.text, "single") };
    if ("capturedText" in v) return v;
    return num(v);
  };
  switch (check.type) {
    case "visible":
    case "notVisible":
    case "notPresent":
      return { type: check.type, target: await mapLoc(check.target, "single") };
    case "textMatches":
    case "textNotMatches":
      return { ...check, target: await mapLoc(check.target, "single") };
    case "numericRelation":
      return { ...check, left: await num(check.left), right: await num(check.right) };
    case "ordered":
      return { ...check, items: await mapLoc(check.items, "items") };
    case "capture":
      return { type: "capture", name: check.name, value: await value(check.value) };
    case "equalsCaptured":
      return { ...check, value: await value(check.value) };
    case "fieldRejected":
      return { type: "fieldRejected", field: await mapLoc(check.field, "single") };
    case "linkWorks":
      return { type: "linkWorks", link: await mapLoc(check.link, "single") };
    case "all": {
      const checks: CheckOf<B>[] = [];
      for (const c of check.checks) checks.push(await mapCheckLocators(c, mapLoc));
      return { type: "all", checks };
    }
    case "urlMatches":
    case "noNewErrors":
    case "maxRequests":
      return check;
  }
}

/**
 * Rewrites only the locators a check *reads a value from* (`read` in numbers, `text` in captured values),
 * leaving targets of visible/notVisible/textMatches alone: their text is the thing being checked.
 */
export async function mapValueReads(
  check: Check,
  fn: (loc: Locator) => Promise<Locator>,
): Promise<Check> {
  const num = async (e: NumExpr): Promise<NumExpr> => {
    if ("read" in e) return { read: await fn(e.read) };
    if ("op" in e) return { op: e.op, a: await num(e.a), b: await num(e.b) };
    return e;
  };
  const value = async (v: NumExpr | TextExpr): Promise<NumExpr | TextExpr> =>
    "text" in v ? { text: await fn(v.text) } : "capturedText" in v ? v : num(v);
  switch (check.type) {
    case "numericRelation":
      return { ...check, left: await num(check.left), right: await num(check.right) };
    case "capture":
      return { ...check, value: await value(check.value) };
    case "equalsCaptured":
      return { ...check, value: await value(check.value) };
    case "all": {
      const checks: Check[] = [];
      for (const c of check.checks) checks.push(await mapValueReads(c, fn));
      return { type: "all", checks };
    }
    default:
      return check;
  }
}

/** Compact TypeScript-style description of the language, for prompts (keeps tool schemas small). */
export const CHECK_LANGUAGE_DOC = `type Loc = { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "label"; text: string; exact?: boolean } | { by: "placeholder"; text: string }
  | { by: "testId"; id: string } | { by: "text"; text: string; exact?: boolean } | { by: "css"; selector: string };
  // any Loc may add { within?: Loc; nth?: number }
type NumExpr = { const: number } | { read: Loc } | { count: Loc } | { captured: string }
  | { op: "add" | "sub" | "mul" | "div"; a: NumExpr; b: NumExpr };
  // read = the first amount in the element's text (or an input's value); percentages are skipped
type TextExpr = { text: Loc } | { capturedText: string };
type Check =
  | { type: "visible"; target: Loc } | { type: "notVisible"; target: Loc }
  | { type: "textMatches"; target: Loc; pattern: string; flags?: "i" }
  | { type: "textNotMatches"; target: Loc; pattern: string; flags?: "i" }
  | { type: "urlMatches"; pattern: string }
  | { type: "numericRelation"; left: NumExpr; op: "eq" | "lt" | "lte" | "gt" | "gte"; right: NumExpr; tolerance?: number }
  | { type: "ordered"; items: Loc; read: "number" | "text"; direction: "asc" | "desc" }  // items matches every item
  | { type: "capture"; name: string; value: NumExpr | TextExpr }        // always passes; stores a value
  | { type: "equalsCaptured"; name: string; value: NumExpr | TextExpr; tolerance?: number }
  | { type: "fieldRejected"; field: Loc }   // the form refused this field's value
  | { type: "noNewErrors" }                 // no page error, 5xx or console error since the previous assert
  | { type: "maxRequests"; method: string; pathPattern: string; max: number }
  | { type: "all"; checks: Check[] };`;
