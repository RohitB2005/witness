// DET-SECRETS (ADDENDUM A1) — secret keys in what the browser downloads: documents, scripts, JSON and inline
// scripts, same origin, up to 2 MB per body (record/responses.ts feeds it).
//
// High-confidence patterns only. Keys that are public by design (Stripe publishable `pk_`, Supabase anon
// JWTs, Firebase web config) are not findings. A matched value is never stored, logged, exported or sent to
// the LLM: findings carry a redacted form (first 4 + last 4 characters) and a short hash to match replays,
// and `redactSecrets` runs over every store write and every prompt.
import { createHash } from "node:crypto";
import type { Severity } from "../types";
import type { CandidateDraft } from "./types";

export interface SecretPattern {
  id: string;
  /** Plain-language name, e.g. "Stripe secret key". */
  label: string;
  re: RegExp;
  severity: Severity;
  /** Report as Needs review with this reason (the key is often meant to be public). */
  review?: string;
  /** Extra check on the matched text (and the body it came from); false = not a secret. */
  accept?: (match: string, body: string) => boolean;
}

/** At least one digit, one upper- and one lower-case letter: real generated tokens, not words-with-dashes. */
function mixed(s: string): boolean {
  return /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);
}

function jwtRole(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    const role = (json as { role?: unknown }).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

// Order matters: the first pattern that matches a span claims it (Anthropic and OpenRouter keys would also
// match the OpenAI pattern).
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: "private-key",
    label: "private key",
    re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]{20,}?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "anthropic",
    label: "Anthropic API key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    severity: "critical",
  },
  {
    id: "openrouter",
    label: "OpenRouter API key",
    re: /\bsk-or-v1-[A-Za-z0-9]{20,}/g,
    severity: "critical",
  },
  {
    id: "openai",
    label: "OpenAI API key",
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    severity: "critical",
    accept: (m) => mixed(m),
  },
  {
    id: "stripe-secret",
    label: "Stripe secret key",
    re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/g,
    severity: "critical",
  },
  {
    id: "github",
    label: "GitHub token",
    re: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/g,
    severity: "critical",
  },
  {
    id: "slack",
    label: "Slack token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    severity: "critical",
  },
  {
    id: "supabase-service",
    label: "Supabase service-role key",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: "critical",
    accept: (m) => jwtRole(m) === "service_role", // anon keys are public by design
  },
  { id: "aws", label: "AWS access key ID", re: /\bAKIA[0-9A-Z]{16}\b/g, severity: "high" },
  {
    id: "google",
    label: "Google API key",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "low",
    review:
      "Google API keys are often browser keys meant to be public; check that this one is restricted to your site.",
    // A Firebase web config is public by design.
    accept: (_m, body) => !/authDomain|firebaseapp\.com/.test(body),
  },
];

export interface SecretMatch {
  patternId: string;
  label: string;
  severity: Severity;
  review?: string;
  /** First 4 + last 4 characters only. */
  redacted: string;
  /** Short hash of the value: tells two findings (or a replay) it's the same key without storing it. */
  hash: string;
}

export function redactValue(value: string): string {
  if (value.startsWith("-----BEGIN")) return "-----BEGIN PRIVATE KEY----- [redacted]";
  return value.length <= 12 ? "[redacted]" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

interface Span {
  start: number;
  end: number;
  pattern: SecretPattern;
  value: string;
}

function spans(text: string): Span[] {
  const out: Span[] = [];
  for (const pattern of SECRET_PATTERNS) {
    for (const m of text.matchAll(pattern.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (out.some((s) => start < s.end && end > s.start)) continue; // claimed by an earlier pattern
      if (pattern.accept && !pattern.accept(m[0], text)) continue;
      out.push({ start, end, pattern, value: m[0] });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Every distinct secret in `text`, redacted. */
export function findSecrets(text: string): SecretMatch[] {
  const seen = new Set<string>();
  const out: SecretMatch[] = [];
  for (const s of spans(text)) {
    const hash = hashOf(s.value);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({
      patternId: s.pattern.id,
      label: s.pattern.label,
      severity: s.pattern.severity,
      review: s.pattern.review,
      redacted: redactValue(s.value),
      hash,
    });
  }
  return out;
}

/** Replaces every secret in `text` with its redacted form. Runs over store writes and LLM prompts. */
export function redactSecrets(text: string): string {
  const found = spans(text);
  if (!found.length) return text;
  let out = "";
  let at = 0;
  for (const s of found) {
    out += text.slice(at, s.start) + redactValue(s.value);
    at = s.end;
  }
  return out + text.slice(at);
}

export interface SecretHit {
  match: SecretMatch;
  request: { method: string; url: string; path: string; status: number };
  evidenceId: string;
}

export function secretCandidate(hit: SecretHit): CandidateDraft {
  const { match, request } = hit;
  const where = request.path;
  return {
    kind: "bug",
    source: { kind: "detector", id: "DET-SECRETS" },
    category: "security",
    // One finding per key, however many files it appears in.
    signature: {
      kind: "detector",
      detectorId: "DET-SECRETS",
      key: `${match.patternId}|${match.hash}`,
    },
    groupKey: `secrets|${match.patternId}|${match.hash}`,
    severityHint: match.severity,
    signals: {
      request: { method: request.method, path: request.path, status: request.status },
    },
    detail: {
      title: `${match.label} exposed to the browser`,
      impact: match.review
        ? `Anyone can read this key from ${where}. ${match.review}`
        : `Anyone who opens the site can copy this key from ${where} and use it with your account's permissions.`,
      expected:
        "Secret keys stay on the server; the browser only receives keys meant to be public.",
      actual: `${where} contains a ${match.label}: ${match.redacted}.`,
      whyFlagged:
        "DET-SECRETS: a high-confidence secret-key pattern appeared in a response the browser downloaded. The key is shown redacted (first and last 4 characters) and was never sent to the AI.",
    },
    summary: `${match.label} in ${where}`,
    evidenceIds: [hit.evidenceId],
    ...(match.review ? { review: match.review } : {}),
  };
}
