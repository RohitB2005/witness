// DET-DBERROR (ADDENDUM A4) — database error messages in response bodies or page text. Always a bug: users
// should never see the database's own error, and one triggered by a quote character is the classic sign of
// SQL injection. Witness only ever sends apostrophes and quotes in otherwise normal input (edge inputs, the
// reflected-input probe); never destructive or exfiltration payloads.
//
// A DB error in a 5xx response shares DET-HTTP5XX's group key, so the two are one finding, led by this one
// (report/findings.ts puts the more specific detector first).
import type { CandidateDraft } from "./types";
import { pathPattern, truncate } from "./util";
import { redactSecrets } from "./secrets";

export interface DbSignature {
  db: string;
  re: RegExp;
}

export const DB_ERROR_SIGNATURES: readonly DbSignature[] = [
  { db: "MySQL", re: /You have an error in your SQL syntax/i },
  { db: "PostgreSQL", re: /syntax error at or near/i },
  { db: "SQLite", re: /SQLITE_ERROR|near "[^"\n]{0,40}": syntax error/ },
  { db: "SQL Server", re: /Unclosed quotation mark/i },
  { db: "Oracle", re: /\bORA-\d{5}\b/ },
  { db: "ORM", re: /SequelizeDatabaseError|PrismaClientKnownRequestError|QueryFailedError/ },
];

export interface DbErrorMatch {
  db: string;
  /** Up to ~120 characters around the match, secrets redacted. */
  excerpt: string;
}

export function findDbError(text: string): DbErrorMatch | undefined {
  for (const s of DB_ERROR_SIGNATURES) {
    const m = s.re.exec(text);
    if (!m) continue;
    const from = Math.max(0, m.index - 40);
    const excerpt = text
      .slice(from, m.index + m[0].length + 60)
      .replace(/\s+/g, " ")
      .trim();
    return { db: s.db, excerpt: truncate(redactSecrets(excerpt), 120) };
  }
  return undefined;
}

export interface DbErrorHit {
  match: DbErrorMatch;
  /** A response body (with its request), or text shown on a page. */
  request?: { method: string; url: string; path: string; status: number };
  pageRoute?: string;
  evidenceId: string;
}

export function dbErrorCandidate(hit: DbErrorHit): CandidateDraft {
  const { match, request } = hit;
  const req = request ? `${request.method} ${request.path}` : undefined;
  // Path only, like DET-HTTP5XX's group key, so the DB error and its 500 are one finding.
  const pattern = request
    ? `${request.method} ${pathPattern(new URL(request.url).pathname)}`
    : undefined;
  return {
    kind: "bug",
    source: { kind: "detector", id: "DET-DBERROR" },
    category: "security",
    signature: {
      kind: "detector",
      detectorId: "DET-DBERROR",
      key: request ? `response|${request.method}|${request.url}` : `page|${hit.pageRoute ?? ""}`,
    },
    // With a 5xx, the same group as DET-HTTP5XX for that request (one finding, not two).
    groupKey: request
      ? request.status >= 500
        ? `http5xx|${pattern}`
        : `dberror|${pattern}`
      : `dberror|page|${hit.pageRoute ?? ""}`,
    severityHint: "high",
    signals: {
      ...(request
        ? { request: { method: request.method, path: request.path, status: request.status } }
        : {}),
      errorMessage: match.excerpt,
    },
    detail: {
      title: "Database error details exposed — possible SQL injection",
      impact:
        "The app shows its database's own error message. That tells an attacker how queries are built, and an error caused by a quote character is a classic sign that input reaches the database unescaped (SQL injection).",
      expected: req
        ? `${req} handles the input without exposing a database error.`
        : "The page never shows a database error message.",
      actual: req
        ? `${req} returned HTTP ${request!.status} with a ${match.db} error: "${match.excerpt}".`
        : `The page shows a ${match.db} error: "${match.excerpt}".`,
      whyFlagged:
        "DET-DBERROR: the text matches a known database error message. Witness only sent ordinary input containing an apostrophe or quote; no attack payloads.",
    },
    summary: `${match.db} error in ${req ?? `page text on ${hit.pageRoute ?? "a page"}`}`,
    evidenceIds: [hit.evidenceId],
  };
}
