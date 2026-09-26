// Number parsing for checks (AI_AGENT_SPEC.md §6). Pure functions.
//
// Handles: "$1,234.50", "NZ$ 12", "12.00", "-3", "−3" (Unicode minus), "€9.99", "USD 40".
// Skips percentages ("15%"), so "Total (incl. 15% GST) $155.25" reads 155.25.
// Out of scope (documented): decimal commas / space-grouped thousands ("1 234,50"), and words ("twelve").

export interface Amount {
  value: number;
  raw: string;
  /** Has a currency marker, or exactly two decimals: tolerance defaults to 0.01 for these. */
  isMoney: boolean;
  isPercent: boolean;
  index: number;
}

// sign? currency? sign? digits (with , thousands) decimals? percent?
const AMOUNT =
  /(?<sign>[-−–]\s?)?(?<cur>(?:[A-Z]{2,3}\s?)?[$€£¥]|\b(?:NZD|AUD|USD|EUR|GBP|CAD)\b)?\s?(?<sign2>[-−–])?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?<pct>\s?%)?/g;

/** Every number in `text`, in order. */
export function amounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const g = m.groups ?? {};
    const digits = (g.num ?? "").replace(/,/g, "");
    if (!digits) continue;
    // A leading "-" only negates when it's attached (not "5 - 3", not a date range "2026-10-01").
    const before = m.index > 0 ? text[m.index - 1] : " ";
    const signed = (!!g.sign && /[\s(:=]|^$/.test(before ?? " ")) || !!g.sign2;
    const value = Number(digits) * (signed ? -1 : 1);
    if (!Number.isFinite(value)) continue;
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    out.push({
      value,
      raw: m[0].trim(),
      isMoney: !!g.cur || decimals === 2,
      isPercent: !!g.pct,
      index: m.index,
    });
  }
  return out;
}

/** The first amount that isn't a percentage, or undefined. */
export function parseAmount(text: string): Amount | undefined {
  return amounts(text).find((a) => !a.isPercent);
}

/** Whitespace-collapsed, trimmed text: how on-screen text is compared. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Case- and whitespace-insensitive "does `haystack` contain `needle`" (grounding verification). */
export function containsLoose(haystack: string, needle: string): boolean {
  const n = normaliseText(needle).toLowerCase();
  if (!n) return false;
  return normaliseText(haystack).toLowerCase().includes(n);
}

/** Formats a number for messages: money-like values with 2 decimals, others as-is. */
export function fmt(n: number, money = false): string {
  if (money) return n.toFixed(2);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10_000) / 10_000);
}
