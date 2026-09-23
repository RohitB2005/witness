import { createHash } from "node:crypto";
import { routePattern } from "../crawl/normalise";

/** Route pattern of a request path (ids → :id), e.g. `/api/orders/42` → `/api/orders/:id`. */
export function pathPattern(path: string): string {
  return routePattern(new URL(path, "http://x"));
}

/** Normalises an error message for grouping: numbers and URLs don't make a new problem. */
export function messagePrefix(text: string, max = 120): string {
  return text
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d+(\.\d+)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 10);
}

export function truncate(text: string, max = 160): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/** The path part of a route pattern (`/book?service` → `/book`). */
export function pathOf(route: string): string {
  return route.split("?")[0] ?? route;
}
