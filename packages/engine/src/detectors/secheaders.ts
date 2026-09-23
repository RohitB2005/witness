// DET-SECHEADERS — security hygiene of the start document's response headers and the site's cookies.
// Improvement, low. Secure/HSTS are only checked on https (they can't apply to plain http).
// Pure function over recorded facts: runs once per scan.
import type { CandidateDraft } from "./types";

export interface CookieFacts {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface SecHeaderFacts {
  url: string;
  headers: Record<string, string>; // lower-cased names
  cookies: CookieFacts[];
  evidenceId: string;
}

interface Problem {
  key: string;
  title: string;
  expected: string;
  actual: string;
  impact: string;
}

export function secHeaderProblems(facts: SecHeaderFacts): Problem[] {
  const h = facts.headers;
  const https = facts.url.startsWith("https:");
  const csp = h["content-security-policy"];
  const problems: Problem[] = [];
  if (!csp) {
    problems.push({
      key: "csp",
      title: "No Content-Security-Policy header",
      expected: "The page sets a Content-Security-Policy header.",
      actual: "No Content-Security-Policy header was sent.",
      impact:
        "If an attacker ever gets script into a page, nothing limits what it can load or run.",
    });
  }
  if ((h["x-content-type-options"] ?? "").toLowerCase() !== "nosniff") {
    problems.push({
      key: "nosniff",
      title: "Missing X-Content-Type-Options: nosniff",
      expected: "The page sends X-Content-Type-Options: nosniff.",
      actual: h["x-content-type-options"]
        ? `X-Content-Type-Options is "${h["x-content-type-options"]}".`
        : "No X-Content-Type-Options header was sent.",
      impact:
        "Browsers may guess file types, which can turn an uploaded file into runnable content.",
    });
  }
  if (!h["x-frame-options"] && !/frame-ancestors/i.test(csp ?? "")) {
    problems.push({
      key: "frame",
      title: "Page can be embedded in other sites (no frame protection)",
      expected:
        "X-Frame-Options or a CSP frame-ancestors directive stops other sites framing the page.",
      actual: "Neither X-Frame-Options nor CSP frame-ancestors was sent.",
      impact:
        "Another site could load this app in a hidden frame and trick users into clicking (clickjacking).",
    });
  }
  if (https && !h["strict-transport-security"]) {
    problems.push({
      key: "hsts",
      title: "No Strict-Transport-Security header",
      expected: "The https site sends Strict-Transport-Security.",
      actual: "No Strict-Transport-Security header was sent.",
      impact: "Visitors can be downgraded to an insecure http connection on hostile networks.",
    });
  }
  for (const c of facts.cookies) {
    const missing: string[] = [];
    if (!c.httpOnly) missing.push("HttpOnly");
    if (https && !c.secure) missing.push("Secure");
    // Chromium reports an absent SameSite attribute as "Lax" (its default), so only "None" is visible here.
    if (c.sameSite === "None" && !c.secure) missing.push("SameSite");
    if (missing.length === 0) continue;
    problems.push({
      key: `cookie|${c.name}|${missing.join(",")}`,
      title: `Cookie "${c.name}" is missing ${missing.join(", ")}`,
      expected: `Cookie "${c.name}" is set with ${missing.join(", ")}.`,
      actual: `Cookie "${c.name}" is set without ${missing.join(", ")}.`,
      impact: "The cookie is easier to steal or misuse than it needs to be.",
    });
  }
  return problems;
}

export function secHeaderCandidates(facts: SecHeaderFacts): CandidateDraft[] {
  return secHeaderProblems(facts).map((p) => ({
    kind: "improvement",
    source: { kind: "detector", id: "DET-SECHEADERS" },
    category: "security",
    signature: { kind: "detector", detectorId: "DET-SECHEADERS", key: p.key },
    groupKey: `secheaders|${p.key}`,
    severityHint: "low",
    signals: {},
    detail: {
      title: p.title,
      impact: p.impact,
      expected: p.expected,
      actual: p.actual,
      whyFlagged: "DET-SECHEADERS: security header / cookie hygiene check on the start page.",
    },
    summary: p.title,
    evidenceIds: [facts.evidenceId],
  }));
}
