// Site-level detectors are pure functions over recorded facts.
import { describe, expect, it } from "vitest";
import { brokenLinkCandidate, isBrokenStatus } from "./brokenlink";
import { secHeaderProblems, type SecHeaderFacts } from "./secheaders";

const good: SecHeaderFacts = {
  url: "https://a.test/",
  headers: {
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000",
  },
  cookies: [{ name: "sid", httpOnly: true, secure: true, sameSite: "Lax" }],
  evidenceId: "ev_h",
};

describe("DET-SECHEADERS", () => {
  it("finds nothing on a well-configured https site", () => {
    expect(secHeaderProblems(good)).toEqual([]);
  });
  it("flags each missing header", () => {
    const keys = secHeaderProblems({ ...good, headers: {} }).map((p) => p.key);
    expect(keys).toEqual(["csp", "nosniff", "frame", "hsts"]);
  });
  it("accepts X-Frame-Options instead of frame-ancestors", () => {
    const keys = secHeaderProblems({
      ...good,
      headers: {
        ...good.headers,
        "content-security-policy": "default-src 'self'",
        "x-frame-options": "DENY",
      },
    }).map((p) => p.key);
    expect(keys).not.toContain("frame");
  });
  it("doesn't ask for Secure or HSTS on plain http", () => {
    const keys = secHeaderProblems({
      ...good,
      url: "http://localhost:3000/",
      headers: { ...good.headers, "strict-transport-security": "" },
      cookies: [{ name: "sid", httpOnly: true, secure: false, sameSite: "Lax" }],
    }).map((p) => p.key);
    expect(keys).toEqual([]);
  });
  it("flags cookies missing HttpOnly (and Secure on https)", () => {
    const keys = secHeaderProblems({
      ...good,
      cookies: [{ name: "sid", httpOnly: false, secure: false, sameSite: "None" }],
    }).map((p) => p.key);
    expect(keys).toEqual(["cookie|sid|HttpOnly,Secure,SameSite"]);
  });
});

describe("DET-BROKENLINK", () => {
  it.each([
    [404, true],
    [410, true],
    [500, true],
    [503, true],
    [200, false],
    [301, false],
    [403, false],
  ])("status %i broken = %s", (s, broken) => expect(isBrokenStatus(s)).toBe(broken));

  it("describes the link, its target and how many pages link to it", () => {
    const c = brokenLinkCandidate({
      url: "http://a.test/terms-old",
      path: "/terms-old",
      status: 404,
      evidenceId: "ev_l",
      sources: [
        { url: "http://a.test/", routePattern: "/", linkText: "Terms" },
        { url: "http://a.test/faq", routePattern: "/faq", linkText: "Terms" },
      ],
    });
    expect(c.kind).toBe("bug");
    expect(c.signals.request).toEqual({ method: "GET", path: "/terms-old", status: 404 });
    expect(c.detail.title).toContain('"Terms"');
    expect(c.detail.actual).toContain("Linked from 2 pages");
  });
});
