// URL and state normalisation for the crawler (SPEC FR-3). Pure functions.
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
/** A reference number: a short letter prefix and at least 3 digits (`ORD-1042`, `INV2024`). */
const REFERENCE = /^[A-Za-z]{1,6}[-_]?\d{3,}$/;

/**
 * True if a path segment looks like an identifier rather than a word: numbers, UUIDs, long hex, reference
 * numbers. A word with one or two digits (`v2`, `s1`) stays a word.
 */
export function isIdSegment(segment: string): boolean {
  return (
    NUMERIC.test(segment) || UUID.test(segment) || LONG_HEX.test(segment) || REFERENCE.test(segment)
  );
}

/**
 * Route pattern for grouping and reporting: id-like path segments become `:id`, trailing slash dropped,
 * query keys kept sorted (values dropped), hash dropped. `/orders/42?b=1&a=2` → `/orders/:id?a&b`.
 */
export function routePattern(input: string | URL): string {
  const url = typeof input === "string" ? new URL(input) : input;
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => (isIdSegment(s) ? ":id" : s));
  const path = "/" + segments.join("/");
  const keys = [...new Set(url.searchParams.keys())].sort();
  return keys.length ? `${path}?${keys.join("&")}` : path;
}

/** Canonical URL used as the crawl's visited-set key: no hash, sorted query, no trailing slash. */
export function canonicalUrl(input: string | URL): string {
  const url = new URL(typeof input === "string" ? input : input.href);
  url.hash = "";
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);
  if (url.pathname.length > 1 && url.pathname.endsWith("/"))
    url.pathname = url.pathname.slice(0, -1);
  return url.href;
}

/**
 * The skeleton of an AI-mode aria snapshot: role + accessible name per line, with refs, cursor hints,
 * URLs and free text removed. Two loads of the same page (or the same page reached by two URLs) give the
 * same skeleton; different pages don't.
 */
export function snapshotSkeleton(snapshot: string): string {
  const out: string[] = [];
  for (const raw of snapshot.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const m = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line);
    if (!m) continue;
    const [, indent = "", role = "", name] = m;
    if (role === "text" || role === "paragraph" || role === "generic" || role === "listitem") {
      out.push(`${indent}${role}`);
      continue;
    }
    // Numbers in names (counts, prices, dates) change between loads; they aren't structure.
    const stableName = name?.replace(/\d+/g, "#");
    out.push(stableName ? `${indent}${role} "${stableName}"` : `${indent}${role}`);
  }
  return out.join("\n");
}

export function structureHash(snapshot: string): string {
  return createHash("sha256").update(snapshotSkeleton(snapshot)).digest("hex").slice(0, 16);
}
