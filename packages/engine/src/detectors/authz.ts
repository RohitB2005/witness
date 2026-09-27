// DET-AUTHZ (ADDENDUM A3) — private data without logging in. After the run, every same-origin GET JSON API
// that answered 200 while logged in, and never answered 2xx without a login, is requested again from a fresh
// browser with no cookies and no auth headers. If the same records come back, anyone can read them. GET only,
// so it is allowed in production mode.
//
// To stay clear of public endpoints that were simply never called logged out (a price calculator used only
// on a logged-in journey), an endpoint is only tried when the page that called it can't be reached without a
// login, or its data contains contact details.
import { createHash } from "node:crypto";
import type { APIRequestContext } from "playwright";
import type { AuthApiObservation } from "../record/responses";
import type { CandidateDraft } from "./types";

/** Contact details: their presence makes an endpoint worth trying even from a public page. */
const CONTACT_KEY =
  /^(e-?mail(address)?|phone(number)?|mobile|address(line\d?)?|street|postcode|zip(code)?)$/i;
/** Personal fields (contact details plus names): their presence makes a finding critical. */
const PERSONAL_KEY =
  /^(e-?mail(address)?|phone(number)?|mobile|address(line\d?)?|street|postcode|zip(code)?|((first|last|full|given|family)_?)?name|dob|date_?of_?birth)$/i;

/** Leaf values by key path, e.g. `booking.phone` → "021…". Arrays use `[]` so list lengths don't matter. */
export function leaves(value: unknown, prefix = "", out = new Map<string, unknown[]>()) {
  if (Array.isArray(value)) {
    for (const v of value) leaves(v, `${prefix}[]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    const list = out.get(prefix) ?? [];
    list.push(value);
    out.set(prefix, list);
  }
  return out;
}

/** Key paths only: a stable fingerprint of the data's shape (no values). */
export function shapeHash(value: unknown): string {
  const keys = [...leaves(value).keys()].sort().join("\n");
  return createHash("sha256").update(keys).digest("hex").slice(0, 12);
}

/** Field names (last key-path segment) in the data, for the report. Never values. */
export function fieldNames(value: unknown): string[] {
  return [
    ...new Set([...leaves(value).keys()].map((k) => k.split(".").pop()!.replace(/\[\]$/, ""))),
  ];
}

/**
 * The same records: the same key paths, and at least half of the leaf values equal. Empty data (no leaves)
 * never counts: an empty list isn't private data.
 */
export function sameRecords(a: unknown, b: unknown): boolean {
  const la = leaves(a);
  const lb = leaves(b);
  if (!la.size || la.size !== lb.size) return false;
  let total = 0;
  let equal = 0;
  for (const [k, va] of la) {
    const vb = lb.get(k);
    if (!vb) return false;
    total += va.length;
    const pool = [...vb];
    for (const v of va) {
      const i = pool.findIndex((x) => x === v);
      if (i >= 0) {
        equal++;
        pool.splice(i, 1);
      }
    }
  }
  return total > 0 && equal / total >= 0.5;
}

export function hasFields(value: unknown, re: RegExp): boolean {
  return fieldNames(value).some((f) => re.test(f));
}

/** Endpoints worth trying without a login. */
export function authzTargets(
  apis: Iterable<AuthApiObservation>,
  anonymousOk: Set<string>,
  publicRoutes: Set<string>,
): AuthApiObservation[] {
  return [...apis].filter(
    (a) =>
      !anonymousOk.has(a.pattern) &&
      (!publicRoutes.has(a.pageRoute) || hasFields(a.body, CONTACT_KEY)),
  );
}

export interface AuthzProbe {
  status: number;
  body?: unknown;
}

/** One GET with no cookies or auth headers. */
export async function fetchWithoutLogin(
  request: APIRequestContext,
  url: string,
): Promise<AuthzProbe> {
  const res = await request.get(url, { maxRedirects: 0, failOnStatusCode: false, timeout: 10_000 });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status(), body };
}

export function authzCandidate(
  api: AuthApiObservation,
  anon: AuthzProbe,
  evidenceId: string,
): CandidateDraft {
  const fields = fieldNames(api.body);
  const personal = hasFields(api.body, PERSONAL_KEY);
  const shown = fields.slice(0, 8).join(", ") + (fields.length > 8 ? ", …" : "");
  return {
    kind: "bug",
    source: { kind: "detector", id: "DET-AUTHZ" },
    category: "security",
    signature: {
      kind: "detector",
      detectorId: "DET-AUTHZ",
      key: `${api.pattern}|${shapeHash(api.body)}`,
    },
    groupKey: `authz|GET ${api.pattern}`,
    severityHint: personal ? "critical" : "high",
    signals: { request: { method: "GET", path: api.path, status: anon.status } },
    detail: {
      title: "API returns private data without logging in",
      impact: `Anyone who knows or guesses this address can read the data without an account${personal ? ", including personal details" : ""}.`,
      expected: `GET ${api.path} without a login is refused (401 or 403), like the logged-in page that uses it.`,
      actual: `From a fresh browser with no cookies or login, GET ${api.path} returned HTTP ${anon.status} with the same records the logged-in user saw (fields: ${shown}).`,
      whyFlagged:
        "DET-AUTHZ: this JSON API was only seen while logged in. Requested again with no cookies or auth headers (GET only), it returned the same data.",
    },
    summary: `GET ${api.path} works without logging in`,
    evidenceIds: [evidenceId],
  };
}
