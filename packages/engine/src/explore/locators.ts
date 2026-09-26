// Ref → stable locator (ARCHITECTURE.md §6 "Recording"). The Explorer names elements by the refs in the
// current AI-mode aria snapshot ("e14"); refs change on every snapshot, so before anything is acted on or
// stored, the ref becomes a semantic locator that resolves to exactly that one element.
//
// Preference order depends on use:
// - act (click/fill/select): role+name → label → placeholder → test id → text → css
// - read (a value in a check): test id → role+name → label → placeholder → text → css, and never a locator
//   built from text containing digits (the value itself changes, e.g. when a bug is fixed)
// - items (every item of a list, for `ordered` / `count`): the item role within the list's own locator
// Each candidate must match exactly one element, and it must be the target (element-handle equality).
import type { ElementHandle as PwElementHandle, Page } from "playwright";

type ElementHandle = PwElementHandle<Element>;
import type { Locator } from "../oracle/language";
import { toPlaywright } from "../oracle/locate";
import type { Step } from "../types";

export type LocatorPurpose = "act" | "read" | "items";
export type StepTarget = NonNullable<Step["target"]>;

export class RefError extends Error {
  override name = "RefError";
}

export interface ResolvedTarget {
  locator: Locator;
  target: StepTarget;
}

interface ElementFacts {
  tag: string;
  inputType?: string;
  id?: string;
  testId?: string;
  labelText?: string;
  placeholder?: string;
  text: string;
  required: boolean;
  formKey?: string;
  isSubmit: boolean;
}

const ITEM_ROLES = new Set([
  "listitem",
  "row",
  "option",
  "article",
  "treeitem",
  "gridcell",
  "menuitem",
]);
const CONTAINER_ROLES: Record<string, string> = {
  list: "listitem",
  listbox: "option",
  table: "row",
  grid: "row",
  rowgroup: "row",
  tree: "treeitem",
  menu: "menuitem",
  feed: "article",
};

/** Resolves a snapshot ref to a stable locator that matches exactly that element. */
export async function stableLocatorForRef(
  page: Page,
  ref: string,
  purpose: LocatorPurpose,
): Promise<ResolvedTarget> {
  const refLoc = page.locator(`aria-ref=${ref}`);
  let count: number;
  try {
    count = await refLoc.count();
  } catch {
    count = 0;
  }
  if (count !== 1) {
    throw new RefError(
      `No element with ref ${ref} on the current page. Refs change after every action: use one from the latest snapshot.`,
    );
  }
  // Role, name and tree position come from a fresh page-level AI snapshot. (An element-level
  // ariaSnapshot() would invalidate every ref on the page; a page-level one keeps them stable.)
  const index = indexSnapshot(await page.ariaSnapshot({ mode: "ai" }));
  const node = index.get(ref);
  const handle = (await refLoc.elementHandle()) as ElementHandle;
  try {
    const role = node?.role ?? "";
    const name = node?.name ?? "";
    const facts = await elementFacts(handle);
    const target: StepTarget = {
      role,
      name: name || undefined,
      tag: facts.tag,
      inputType: facts.inputType,
      required: facts.required || undefined,
      formKey: facts.formKey,
      isSubmit: facts.isSubmit || undefined,
    };
    if (purpose === "items") {
      return { locator: await itemsLocator(page, index, ref, handle, facts), target };
    }
    const locator = await uniqueLocator(page, handle, candidates(role, name, facts, purpose));
    return { locator, target };
  } finally {
    await handle.dispose().catch(() => undefined);
  }
}

export interface SnapshotNode {
  role: string;
  name: string;
  parent?: string;
}

/** ref → role, accessible name and the nearest ancestor ref, from an AI-mode aria snapshot. */
export function indexSnapshot(snapshot: string): Map<string, SnapshotNode> {
  const out = new Map<string, SnapshotNode>();
  const stack: { indent: number; ref: string }[] = [];
  for (const line of snapshot.split("\n")) {
    const m = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?.*?\[ref=([a-z0-9]+)\]/.exec(line);
    if (!m) continue;
    const indent = m[1]!.length;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    let name = m[3] ?? "";
    try {
      name = JSON.parse(`"${name}"`) as string;
    } catch {
      // keep raw
    }
    out.set(m[4]!, { role: m[2]!, name, parent: stack[stack.length - 1]?.ref });
    stack.push({ indent, ref: m[4]! });
  }
  return out;
}

function candidates(
  role: string,
  name: string,
  f: ElementFacts,
  purpose: LocatorPurpose,
): Locator[] {
  const hasDigits = (s: string) => /\d/.test(s);
  const okText = (s: string | undefined): s is string =>
    !!s && s.length <= 80 && (purpose !== "read" || !hasDigits(s));
  const semantic =
    role && role !== "generic" && role !== "text" && role !== "none" && role !== "presentation";
  const byRole: Locator[] =
    semantic && okText(name) ? [{ by: "role", role, name, exact: true }] : [];
  const byLabel: Locator[] = okText(f.labelText)
    ? [{ by: "label", text: f.labelText, exact: true }]
    : [];
  const byPlaceholder: Locator[] = okText(f.placeholder)
    ? [{ by: "placeholder", text: f.placeholder }]
    : [];
  const byTestId: Locator[] = f.testId ? [{ by: "testId", id: f.testId }] : [];
  const isField = f.tag === "input" || f.tag === "textarea" || f.tag === "select";
  const byText: Locator[] =
    !isField && okText(f.text) ? [{ by: "text", text: f.text, exact: true }] : [];
  const ordered =
    purpose === "read"
      ? [...byTestId, ...byRole, ...byLabel, ...byPlaceholder, ...byText]
      : [...byRole, ...byLabel, ...byPlaceholder, ...byTestId, ...byText];
  return ordered;
}

/**
 * First candidate that matches exactly the target; then the same candidates with `nth`; then a CSS path.
 * The CSS path is structural (tag + nth-of-type), so it's deterministic for the same build of the app.
 */
async function uniqueLocator(page: Page, handle: ElementHandle, list: Locator[]): Promise<Locator> {
  for (const loc of list) {
    const pw = toPlaywright(page, loc);
    if ((await safeCount(pw)) === 1 && (await sameElement(page, pw.first(), handle))) return loc;
  }
  for (const loc of list) {
    const pw = toPlaywright(page, loc);
    const n = await safeCount(pw);
    if (n < 2 || n > 50) continue;
    for (let i = 0; i < n; i++) {
      if (await sameElement(page, pw.nth(i), handle)) return { ...loc, nth: i };
    }
  }
  const css = await handle.evaluate((el) => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && node !== document.documentElement) {
      const id = node.getAttribute("id");
      if (id && /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll(`#${id}`).length === 1) {
        parts.unshift(`#${id}`);
        break;
      }
      let sel = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const tag = node.tagName;
        const same = Array.from(parent.children).filter((c) => c.tagName === tag);
        if (same.length > 1) sel += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts[0]?.startsWith("#") ? parts.join(" > ") : `body > ${parts.join(" > ")}`;
  });
  return { by: "css", selector: css };
}

/**
 * Every item of the list the ref is in (or is): `{ role: <item role>, within: <the list's stable locator> }`.
 * The container is found in the snapshot tree (nearest list/table/… ancestor). If there's no list
 * semantics at all, it's every sibling with the same tag inside the parent (e.g. cards in a grid).
 */
async function itemsLocator(
  page: Page,
  index: Map<string, SnapshotNode>,
  ref: string,
  handle: ElementHandle,
  facts: ElementFacts,
): Promise<Locator> {
  const node = index.get(ref);
  let containerRef: string | undefined;
  let itemRole: string | undefined;
  if (node && CONTAINER_ROLES[node.role]) {
    containerRef = ref;
    itemRole = CONTAINER_ROLES[node.role];
  } else if (node && ITEM_ROLES.has(node.role)) {
    itemRole = node.role;
    let p = node.parent;
    while (p && !CONTAINER_ROLES[index.get(p)?.role ?? ""]) p = index.get(p)?.parent;
    containerRef = p;
  }
  if (itemRole && containerRef) {
    const c = index.get(containerRef)!;
    const container = (await page
      .locator(`aria-ref=${containerRef}`)
      .elementHandle()) as ElementHandle;
    try {
      const within = await uniqueLocator(
        page,
        container,
        candidates(c.role, c.name, await elementFacts(container), "read"),
      );
      return { by: "role", role: itemRole, within };
    } finally {
      await container.dispose().catch(() => undefined);
    }
  }
  const parent = (
    await handle.evaluateHandle((el) => el.parentElement ?? document.body)
  ).asElement() as ElementHandle;
  try {
    const p = node?.parent ? index.get(node.parent) : undefined;
    const within = await uniqueLocator(
      page,
      parent,
      candidates(p?.role ?? "", p?.name ?? "", await elementFacts(parent), "read"),
    );
    return { by: "css", selector: `:scope > ${facts.tag}`, within };
  } finally {
    await parent.dispose().catch(() => undefined);
  }
}

async function safeCount(loc: ReturnType<typeof toPlaywright>): Promise<number> {
  try {
    return await loc.count();
  } catch {
    return 0;
  }
}

async function sameElement(
  page: Page,
  loc: ReturnType<typeof toPlaywright>,
  handle: ElementHandle,
): Promise<boolean> {
  const other = await loc.elementHandle({ timeout: 1_000 }).catch(() => null);
  if (!other) return false;
  try {
    return await page.evaluate(([a, b]) => a === b, [other, handle] as const);
  } finally {
    await other.dispose().catch(() => undefined);
  }
}

export function parseRoleLine(yaml: string): { role: string; name: string } {
  const first = yaml.split("\n").find((l) => l.trim().startsWith("- ")) ?? "";
  const m = /^\s*- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(first);
  if (!m) return { role: "", name: "" };
  let name = m[2] ?? "";
  try {
    name = JSON.parse(`"${name}"`) as string;
  } catch {
    // keep raw
  }
  return { role: m[1] ?? "", name };
}

async function elementFacts(handle: ElementHandle): Promise<ElementFacts> {
  return handle.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    const labels = (input.labels ? Array.from(input.labels) : []) as HTMLElement[];
    let labelText = labels[0]?.innerText?.replace(/\s+/g, " ").trim() || undefined;
    if (!labelText && el.getAttribute("aria-label"))
      labelText = el.getAttribute("aria-label")!.trim();
    const form = (input.form ?? el.closest("form")) as HTMLFormElement | null;
    const formIndex = form ? Array.from(document.forms).indexOf(form) : -1;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const isSubmit =
      (tag === "button" && (type === "submit" || (type === "" && !!form))) ||
      (tag === "input" && (type === "submit" || type === "image"));
    return {
      tag,
      inputType:
        tag === "input"
          ? input.type
          : tag === "textarea"
            ? "textarea"
            : tag === "select"
              ? "select"
              : undefined,
      id: el.id || undefined,
      testId: el.getAttribute("data-testid") ?? undefined,
      labelText,
      placeholder: el.getAttribute("placeholder") ?? undefined,
      text: ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      required: input.required === true || el.getAttribute("aria-required") === "true",
      formKey: form
        ? `form#${formIndex}:${form.getAttribute("name") ?? form.id ?? ""}:${new URL(form.action || location.href, location.href).pathname}`
        : undefined,
      isSubmit,
    };
  });
}
