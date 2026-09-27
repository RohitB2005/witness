// DET-TOTALS — a money breakdown whose parts don't add up to its total (P3, DEVLOG D46).
//
// On any page showing labelled amounts (subtotal / item total, tax / GST / VAT, shipping, discount, fees,
// total), the parts must sum to the total within 1 cent. Discounts subtract. If the tax line (or the total's
// label) says the tax is *included*, the sum without it is accepted too. Needs a total and at least two
// parts, so a lone "Subtotal / Total" pair (hidden fees possible) is never judged.
//
// The finding carries the equivalent `numericRelation` check, built from stable locators for each amount,
// so replay re-evaluates it and the exporter turns it into a test. Generic: labels are common commerce
// words, nothing app-specific.
import type { Page } from "playwright";
import type { Check, Locator, NumExpr } from "../oracle/language";
import { toPlaywright } from "../oracle/locate";
import { amounts } from "../oracle/parse";
import type { CandidateDraft, PageDetector } from "./types";
import { pathOf } from "./util";

export type PartRole = "subtotal" | "tax" | "shipping" | "discount" | "fee" | "total";

export interface BreakdownRow {
  label: string;
  amountText: string;
  value: number;
  role: PartRole;
  /** Candidate locators for the element holding the amount, best first. */
  testId?: string;
  css: string;
  /** Distance from the total row to the smallest ancestor that also holds this row. */
  depth: number;
}

// Order matters: "item total" and "total before tax" are parts; a total's label may mention the tax
// ("Total (incl. VAT)"); a fee's label may too ("Booking fee (incl. tax)"). The tax rule goes last.
const ROLES: [PartRole, RegExp][] = [
  [
    "subtotal",
    /^(sub[-\s]?total|items?\s+(sub)?total|merchandise(\s+total)?|net\s+total|order\s+subtotal|total\s+before\s+tax(es)?|items?)\b/i,
  ],
  [
    "total",
    /^((grand|order|estimated|final)\s+)?total\b|^amount\s+(due|payable)|^balance\s+due|^total\s+(due|payable|to\s+pay)/i,
  ],
  ["discount", /^(discount|promo(tion)?(\s+code)?|coupon|voucher|savings|you\s+save|reward)/i],
  ["shipping", /^(shipping|delivery|postage|freight|handling)/i],
  ["fee", /^(service\s+fee|booking\s+fee|processing\s+fee|fees?|surcharge|tip|gratuity)\b/i],
  [
    "tax",
    /^(tax(es)?|gst|vat|hst|pst|sales\s+tax|estimated\s+tax|duty|duties)\b|\b(tax|gst|vat)\b/i,
  ],
];

export function roleOf(label: string): PartRole | undefined {
  const l = label.replace(/\s+/g, " ").trim();
  for (const [role, re] of ROLES) if (re.test(l)) return role;
  return undefined;
}

const INCLUDED = /\b(incl\.?|including|included|inclusive)\b/i;

export interface TotalsVerdict {
  ok: boolean;
  total: BreakdownRow;
  parts: BreakdownRow[];
  sum: number;
  /** "Subtotal $135.00 + GST (15%) $20.25" */
  expression: string;
}

/** Pure: do these rows add up? (Exported for tests.) */
export function judgeBreakdown(total: BreakdownRow, parts: BreakdownRow[]): TotalsVerdict {
  const signed = (p: BreakdownRow) => (p.role === "discount" ? -Math.abs(p.value) : p.value);
  const sum = round2(parts.reduce((s, p) => s + signed(p), 0));
  const expression = parts
    .map(
      (p, i) => `${i === 0 ? "" : p.role === "discount" ? "− " : "+ "}${p.label} ${p.amountText}`,
    )
    .join(" ");
  if (Math.abs(sum - total.value) <= 0.01 + 1e-9)
    return { ok: true, total, parts, sum, expression };
  // Tax-inclusive prices: the tax line (or the total's label) says the tax is already included.
  const taxIncluded =
    parts.some((p) => p.role === "tax") &&
    (parts.some((p) => p.role === "tax" && INCLUDED.test(p.label)) || INCLUDED.test(total.label));
  if (taxIncluded) {
    const withoutTax = round2(
      parts.filter((p) => p.role !== "tax").reduce((s, p) => s + signed(p), 0),
    );
    if (Math.abs(withoutTax - total.value) <= 0.01 + 1e-9)
      return { ok: true, total, parts, sum: withoutTax, expression };
  }
  return { ok: false, total, parts, sum, expression };
}

/** A breakdown worth judging: a total, ≥ 2 parts, and a subtotal (or ≥ 2 additive parts). */
export function isBreakdown(parts: BreakdownRow[]): boolean {
  if (parts.length < 2) return false;
  if (parts.some((p) => p.role === "subtotal")) return true;
  return parts.filter((p) => p.role !== "discount").length >= 2;
}

// Runs in the page as a string (no helper functions are serialised; see DEVLOG P1 notes).
const FIND_ROWS = String.raw`(() => {
  const MONEY = /(?:[-−–]\s?)?(?:[A-Z]{2,3}\s?)?[$€£¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|(?:[-−–]\s?)?\b\d{1,3}(?:,\d{3})*\.\d{2}\b/;
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const path = (el) => {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      const id = node.getAttribute("id");
      if (id && /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll("#" + id).length === 1) {
        parts.unshift("#" + id);
        return parts.join(" > ");
      }
      let sel = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = parent;
    }
    return "body > " + parts.join(" > ");
  };
  const rows = [];
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (["SCRIPT", "STYLE", "OPTION", "SELECT", "INPUT", "TEXTAREA", "BUTTON"].includes(el.tagName)) continue;
    if (el.children.length > 0 || !visible(el)) continue;
    const text = norm(el.innerText);
    if (!text || text.length > 80) continue;
    const m = MONEY.exec(text);
    let label, amountEl, amountText;
    if (m && m.index > 0) {
      // "Tax: $2.40" in one element.
      label = norm(text.slice(0, m.index)).replace(/[:=]\s*$/, "");
      amountEl = el;
      amountText = m[0].trim();
    } else if (!m) {
      // A label on its own; the amount is the next element, or follows it in the parent.
      label = text.replace(/[:=]\s*$/, "");
      const next = el.nextElementSibling;
      const nextText = next ? norm(next.innerText) : "";
      const nm = MONEY.exec(nextText);
      if (next && nm && nextText.length <= 40 && nm.index <= 2) {
        amountEl = next;
        amountText = nm[0].trim();
      } else if (el.parentElement) {
        const ptext = norm(el.parentElement.innerText);
        if (ptext.startsWith(text) && ptext.length <= 100) {
          const pm = MONEY.exec(ptext.slice(text.length));
          if (pm && pm.index <= 3) {
            amountEl = el.parentElement;
            amountText = pm[0].trim();
          }
        }
      }
    }
    if (!label || !amountEl || label.length > 50) continue;
    const key = label + "|" + amountText;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      label,
      amountText,
      testId: amountEl.getAttribute("data-testid") || undefined,
      css: path(amountEl),
    });
  }
  return rows;
})()`;

async function findRows(page: Page): Promise<Omit<BreakdownRow, "value" | "role" | "depth">[]> {
  return (await page.evaluate(FIND_ROWS).catch(() => [])) as Omit<
    BreakdownRow,
    "value" | "role" | "depth"
  >[];
}

/** Rows grouped into breakdowns: each total with the parts listed in the same container (by CSS path). */
export function breakdowns(
  rows: Omit<BreakdownRow, "depth">[],
): { total: BreakdownRow; parts: BreakdownRow[] }[] {
  const out: { total: BreakdownRow; parts: BreakdownRow[] }[] = [];
  const segs = (css: string) => css.split(" > ");
  for (const total of rows.filter((r) => r.role === "total")) {
    const t = segs(total.css);
    let best: BreakdownRow[] = [];
    // The smallest ancestor of the total (up to 4 levels) that holds ≥ 2 parts.
    for (let up = 1; up <= 4 && up < t.length; up++) {
      const prefix = t.slice(0, t.length - up).join(" > ") + " > ";
      const parts = rows
        .filter((r) => r !== total && r.role !== "total" && (r.css + " > ").startsWith(prefix))
        .map((r) => ({ ...r, depth: up }));
      if (isBreakdown(parts)) {
        best = parts;
        break;
      }
    }
    if (best.length) out.push({ total: { ...total, depth: 0 }, parts: best });
  }
  return out;
}

async function locatorFor(page: Page, row: BreakdownRow): Promise<Locator> {
  if (row.testId) {
    const loc: Locator = { by: "testId", id: row.testId };
    if (
      (await toPlaywright(page, loc)
        .count()
        .catch(() => 0)) === 1
    )
      return loc;
  }
  return { by: "css", selector: row.css };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const totalsDetector: PageDetector = {
  id: "DET-TOTALS",
  viewport: "desktop",
  async run({ page, state, capture }) {
    const raw = await findRows(page);
    const rows: Omit<BreakdownRow, "depth">[] = [];
    for (const r of raw) {
      const role = roleOf(r.label);
      const a = amounts(r.amountText).find((x) => !x.isPercent);
      if (role && a) rows.push({ ...r, role, value: a.value });
    }
    const out: CandidateDraft[] = [];
    for (const b of breakdowns(rows)) {
      const v = judgeBreakdown(b.total, b.parts);
      if (v.ok) continue;
      const read = async (r: BreakdownRow): Promise<NumExpr> => ({
        read: await locatorFor(page, r),
      });
      let right: NumExpr = await read(b.parts[0]!);
      for (const p of b.parts.slice(1))
        right = { op: p.role === "discount" ? "sub" : "add", a: right, b: await read(p) };
      const check: Check = {
        type: "numericRelation",
        left: await read(b.total),
        op: "eq",
        right,
        tolerance: 0.01,
      };
      const labels = [...b.parts, b.total].map((p) => p.label);
      const diff = round2(Math.abs(b.total.value - v.sum));
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-TOTALS" },
        category: "functional",
        signature: { kind: "detector", detectorId: "DET-TOTALS", key: labels.join("|") },
        groupKey: `totals|${pathOf(state.routePattern)}|${labels.join("|").toLowerCase()}`,
        signals: {},
        detail: {
          title: `The amounts on ${pathOf(state.routePattern)} don't add up to the ${b.total.label}`,
          impact: "People could be charged, or shown, the wrong amount.",
          expected: `${b.total.label} equals ${v.expression} = ${v.sum.toFixed(2)}.`,
          actual: `${b.total.label} shows ${b.total.amountText}, which is ${diff.toFixed(2)} away from ${v.expression} = ${v.sum.toFixed(2)}.`,
          whyFlagged: `DET-TOTALS: the labelled parts of a money breakdown ("${labels.join('", "')}") don't sum to its total (within 0.01).`,
        },
        summary: `${b.total.label} ${b.total.amountText} ≠ ${v.expression}`,
        evidenceIds: [capture.evidence.snapshot],
        check,
        grounding: { kind: "ui_text", verified: true, quote: labels.join(" / ") },
      } as CandidateDraft);
    }
    return out;
  },
};
