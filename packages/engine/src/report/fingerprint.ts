// Finding fingerprints (SPEC FR-12): stable across runs, so suppressions and run diffs work.
// Hash of category + normalised route + source ID + normalised target key (+ request method/path).
import { createHash } from "node:crypto";

export interface FingerprintInput {
  category: string;
  route: string;
  sourceId: string;
  key: string;
  request?: { method: string; path: string };
}

export function fingerprint(input: FingerprintInput): string {
  const parts = [
    input.category,
    input.route,
    input.sourceId,
    normaliseKey(input.key),
    input.request ? `${input.request.method.toUpperCase()} ${input.request.path}` : "",
  ];
  return "fp_" + createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/** Case, whitespace and digits don't make a new finding ("3 items" vs "4 items"). */
export function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#").trim();
}
