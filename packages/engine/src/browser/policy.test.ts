// SECURITY.md §4: proves T1 (production write block on every origin, login allowed) and T3 (off-origin
// navigation aborted).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { startFixtureServer, page as html, type FixtureServer } from "../../test/fixture-server";
import { createContext, launchBrowser } from "./context";
import { PageRecorder } from "../record/recorder";
import { pageErrorDetector } from "../detectors/pageerror";
import type { DetectorContext } from "../detectors/types";
import { decideTier } from "../verify/tier";
import { tierFacts } from "../report/findings";
import type { Candidate } from "../types";
import { SafetyPolicy, blockedWriteNote, type BlockedRequest, type RequestFacts } from "./policy";

const ORIGIN = "http://app.test:8080";
const nav = (url: string): RequestFacts => ({ url, method: "GET", isMainFrameNavigation: true });
const req = (method: string, url: string): RequestFacts => ({
  url,
  method,
  isMainFrameNavigation: false,
});

describe("SafetyPolicy.decide (table)", () => {
  const cases: [string, "staging" | "production", RequestFacts, boolean][] = [
    ["same-origin GET", "production", req("GET", `${ORIGIN}/api/x`), true],
    ["same-origin POST in staging", "staging", req("POST", `${ORIGIN}/api/x`), true],
    ["same-origin POST in production", "production", req("POST", `${ORIGIN}/api/x`), false],
    ["same-origin PUT in production", "production", req("PUT", `${ORIGIN}/api/x`), false],
    ["same-origin PATCH in production", "production", req("patch", `${ORIGIN}/api/x`), false],
    ["same-origin DELETE in production", "production", req("DELETE", `${ORIGIN}/api/x/1`), false],
    ["cross-origin sub-resource GET", "production", req("GET", "https://cdn.example/lib.js"), true],
    [
      "cross-origin POST in production (D87)",
      "production",
      req("POST", "https://db.example/v1/docs"),
      false,
    ],
    ["cross-origin PUT in production", "production", req("PUT", "https://api.example/x"), false],
    [
      "cross-origin DELETE in production",
      "production",
      req("DELETE", "https://api.example/x/1"),
      false,
    ],
    [
      "cross-origin analytics beacon in production",
      "production",
      req("POST", "https://stats.example/collect"),
      false,
    ],
    ["cross-origin POST in staging", "staging", req("POST", "https://db.example/v1/docs"), true],
    [
      "cross-origin GET in production",
      "production",
      req("GET", "https://db.example/v1/docs"),
      true,
    ],
    ["cross-origin top-level navigation", "staging", nav("https://evil.example/"), false],
    ["same-origin navigation", "production", nav(`${ORIGIN}/about`), true],
    ["file: scheme", "staging", req("GET", "file:///etc/passwd"), false],
    ["javascript: scheme", "staging", nav("javascript:alert(1)"), false],
    ["data: URL", "staging", req("GET", "data:image/png;base64,AAAA"), true],
  ];
  it.each(cases)("%s", (_name, mode, facts, allowed) => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode });
    expect(policy.decide(facts).allow).toBe(allowed);
  });

  it("allows the armed login writes in production, then blocks other writes", () => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode: "production" });
    policy.armLoginWindow();
    expect(policy.decide(req("POST", `${ORIGIN}/api/login`))).toEqual({
      allow: true,
      asLoginRequest: true,
    });
    policy.allowWrite({ method: "POST", path: "/api/login" }); // what #recordLogin does on the real request
    policy.disarmLoginWindow();
    expect(policy.decide(req("POST", `${ORIGIN}/api/login`)).allow).toBe(true);
    expect(policy.decide(req("POST", `${ORIGIN}/api/bookings`)).allow).toBe(false);
    expect(policy.decide(req("DELETE", `${ORIGIN}/api/login`)).allow).toBe(false);
  });

  it("the login window allows a login that posts to another origin; afterwards only that request (D87)", () => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode: "production" });
    const signIn = req("POST", "https://auth.example/v1/accounts:signIn?key=k");
    expect(policy.decide(signIn).allow).toBe(false);
    policy.armLoginWindow();
    expect(policy.decide(signIn)).toEqual({ allow: true, asLoginRequest: true });
    expect(policy.decide(req("POST", "https://auth.example/v1/accounts:lookup"))).toEqual({
      allow: true,
      asLoginRequest: true,
    });
    policy.allowWrite({
      origin: "https://auth.example",
      method: "POST",
      path: "/v1/accounts:signIn",
    });
    policy.disarmLoginWindow();
    expect(policy.decide(signIn).allow).toBe(true);
    // Same path on another origin, or another path on the auth origin: still blocked.
    expect(policy.decide(req("POST", `${ORIGIN}/v1/accounts:signIn`)).allow).toBe(false);
    expect(policy.decide(req("POST", "https://auth.example/v1/accounts:delete")).allow).toBe(false);
    expect(policy.decide(req("POST", "https://db.example/v1/docs")).allow).toBe(false);
  });

  it("the login window admits only writes sent from the login page, not from where it lands (D87)", () => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode: "production" });
    policy.armLoginWindow(`${ORIGIN}/login?next=/`);
    const from = (frameUrl: string, url: string): RequestFacts => ({
      ...req("POST", url),
      frameUrl,
    });
    expect(policy.decide(from(`${ORIGIN}/login`, "https://auth.example/v1/signIn")).allow).toBe(
      true,
    );
    expect(policy.decide(from(`${ORIGIN}/login#x`, `${ORIGIN}/session`)).allow).toBe(true);
    expect(policy.decide(from(`${ORIGIN}/dashboard`, `${ORIGIN}/api/track`))).toEqual({
      allow: false,
      reason: "production-write",
    });
    expect(policy.decide(from("", `${ORIGIN}/api/track`)).allow).toBe(false); // no page (a worker)
  });

  it("the login window never allows a navigation to another origin", () => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode: "production" });
    policy.armLoginWindow();
    expect(policy.decide({ ...nav("https://evil.example/"), method: "POST" }).allow).toBe(false);
  });

  it("strict mode blocks cross-origin sub-resources", () => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode: "staging", strictSubresources: true });
    expect(policy.decide(req("GET", "https://cdn.example/lib.js")).allow).toBe(false);
  });
});

describe("blockedWriteNote (the report's plain-words list of blocked hosts)", () => {
  const b = (reason: BlockedRequest["reason"], url: string): BlockedRequest => ({
    reason,
    method: "POST",
    url,
    at: "2026-09-30T00:00:00Z",
  });
  it("says nothing when no write was blocked", () => {
    expect(blockedWriteNote([])).toBeUndefined();
    expect(blockedWriteNote([b("off-origin-navigation", "https://x.example/")])).toBeUndefined();
  });
  it("names each host once, sorted, and says reads may be affected", () => {
    const note = blockedWriteNote([
      b("production-write", "https://db.example/v1/Listen/channel?x=1"),
      b("production-write", "https://stats.example/collect"),
      b("production-write", "https://db.example/v1/Write/channel"),
    ]);
    expect(note).toBe(
      "Read-only mode blocked requests that send data to db.example, stats.example. Some services also read data this way, so parts of the app that rely on them may not have been fully tested.",
    );
  });
  it("mentions live connections when a WebSocket was refused", () => {
    expect(blockedWriteNote([b("production-websocket", "wss://rt.example/ws")])).toBe(
      "Read-only mode blocked requests that send data (including live connections) to rt.example. Some services also read data this way, so parts of the app that rely on it may not have been fully tested.",
    );
  });
  it("shortens a long list", () => {
    const hosts = ["a", "b", "c", "d", "e", "f", "g"].map((h) =>
      b("production-write", `https://${h}.example/`),
    );
    expect(blockedWriteNote(hosts)).toMatch(/e\.example and 2 more\. .* rely on them/);
  });
});

describe("SafetyPolicy in a real browser", () => {
  let browser: Browser;
  let app: FixtureServer;
  let other: FixtureServer;

  beforeAll(async () => {
    const cors = { "access-control-allow-origin": "*" };
    other = await startFixtureServer({
      "/": { body: html("<p>Another site</p>", { title: "Other" }) },
      "POST /v1/signIn": { contentType: "application/json", body: '{"token":"t"}', headers: cors },
      "POST /v1/lookup": { contentType: "application/json", body: '{"user":"u"}', headers: cors },
      "POST /v1/docs": { contentType: "application/json", body: "{}", headers: cors },
      "POST /collect": { status: 204, headers: cors },
    });
    app = await startFixtureServer({
      "/": {
        body: html(`
          <form id="login" method="post" action="/login"><label>Email <input name="email"></label>
            <label>Password <input type="password" name="password"></label><button>Log in</button></form>
          <button id="write" onclick="fetch('/api/orders', { method: 'POST', body: '{}' }).then(r => document.title = 'status ' + r.status).catch(() => document.title = 'blocked')">Order</button>
          <a id="away" href="${other.url("/")}">Elsewhere</a>
          <button id="save-offsite" onclick="fetch('${other.url("/v1/docs")}', { method: 'POST', body: 'x' }).then(r => document.title = 'status ' + r.status).catch(() => document.title = 'blocked')">Save</button>
          <button id="hosted-login" onclick="fetch('${other.url("/v1/signIn")}', { method: 'POST', body: 'x' }).then(() => fetch('${other.url("/v1/lookup")}', { method: 'POST', body: 'x' })).then(() => document.title = 'signed in').catch(() => document.title = 'login failed')">Hosted log in</button>`),
      },
      "/live": {
        body: html(`<p>Live</p><script>
          navigator.sendBeacon('${other.url("/collect")}', 'x');
          const ws = new WebSocket('${other.origin.replace("http", "ws")}/socket');
          ws.onopen = () => { document.title = 'open'; };
          ws.onclose = (e) => { document.title = 'closed ' + e.code; };
        </script>`),
      },
      // A crash, then an analytics-style beacon to another host, then another crash (D87).
      "/beacon": {
        body: html(`<p>Page</p><script>
          setTimeout(() => { throw new Error("crash before the beacon"); }, 0);
          setTimeout(() => fetch('${other.url("/collect")}', { method: 'POST', mode: 'no-cors', keepalive: true, body: 'x' }).catch(() => {}), 150);
          setTimeout(() => { throw new Error("crash after the beacon"); }, 600);
        </script>`),
      },
      "POST /login": { body: html("<p>Welcome back</p>", { title: "Home" }) },
      "POST /api/orders": { contentType: "application/json", body: "{}" },
    });
    browser = await launchBrowser();
  });
  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await other?.close();
  });

  it("production mode blocks a same-origin POST at the network layer (T1)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "production" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    await p.click("#write");
    await expect.poll(() => p.title()).toBe("blocked");
    expect(app.requests).not.toContain("POST /api/orders");
    expect(policy.blocked.map((b) => b.reason)).toContain("production-write");
    await context.close();
  });

  it("production mode allows the recorded login POST (T1)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "production" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    policy.armLoginWindow(p.url());
    await Promise.all([p.waitForURL(/\/login$/), p.click("#login button")]);
    policy.disarmLoginWindow();
    expect(await p.title()).toBe("Home");
    expect(policy.loginRequests).toEqual([{ origin: app.origin, method: "POST", path: "/login" }]);
    // The same login request stays allowed (replays log in again); other writes don't.
    await p.goto(app.url("/"));
    await p.click("#write");
    await expect.poll(() => p.title()).toBe("blocked");
    await context.close();
  });

  it("production mode blocks a POST to another origin; the other server never sees it (D87)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "production" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    await p.click("#save-offsite");
    await expect.poll(() => p.title()).toBe("blocked");
    expect(other.requests).not.toContain("POST /v1/docs");
    expect(policy.blocked.map((b) => [b.reason, new URL(b.url).pathname])).toContainEqual([
      "production-write",
      "/v1/docs",
    ]);
    expect(blockedWriteNote(policy.blocked)).toContain(new URL(other.origin).host);
    await context.close();
  });

  it("production mode allows a login that posts to another origin, and records each request (D87)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "production" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    policy.armLoginWindow(p.url());
    await p.click("#hosted-login");
    await expect.poll(() => p.title()).toBe("signed in");
    policy.disarmLoginWindow();
    expect(policy.loginRequests).toEqual([
      { origin: other.origin, method: "POST", path: "/v1/signIn" },
      { origin: other.origin, method: "POST", path: "/v1/lookup" },
    ]);
    // After the window: a write to the same service is blocked again.
    await p.click("#save-offsite");
    await expect.poll(() => p.title()).toBe("blocked");
    expect(other.requests).not.toContain("POST /v1/docs");
    await context.close();
  });

  it("production mode blocks sendBeacon and refuses WebSockets; staging doesn't route sockets (D87)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "production" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/live"));
    await expect.poll(() => p.title()).toBe("closed 1008");
    expect(other.requests).not.toContain("POST /collect");
    expect(other.requests).not.toContain("GET /socket");
    expect(policy.blocked.map((b) => b.reason).sort()).toEqual([
      "production-websocket",
      "production-write",
    ]);
    await context.close();

    const staging = new SafetyPolicy({ origin: app.origin, mode: "staging" });
    const sc = await createContext(browser, {
      policy: staging,
      viewport: { width: 800, height: 600 },
    });
    const sp = await sc.newPage();
    await sp.goto(app.url("/live"));
    // The fixture server isn't a WebSocket server, so the socket fails, but with a network code, not 1008.
    await expect.poll(() => sp.title()).toMatch(/^closed (?!1008)/);
    expect(staging.blocked).toEqual([]);
    await sc.close();
  });

  it("staging mode lets an off-site write through", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "staging" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    await p.click("#save-offsite");
    await expect.poll(() => p.title()).toBe("status 200");
    await context.close();
  });

  it("a crash before a blocked beacon is reported normally; one after it is capped at Needs review (D87)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "production" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    const recorder = new PageRecorder(p, policy);
    const before = other.requests.length;
    await p.goto(app.url("/beacon"));
    await expect.poll(() => recorder.errors.length).toBe(2);
    expect(policy.blocked.some((b) => b.url.endsWith("/collect"))).toBe(true);
    expect(other.requests.slice(before)).not.toContain("POST /collect");

    const host = new URL(other.origin).host;
    expect(recorder.errors.map((e) => [e.message, e.afterBlocked])).toEqual([
      ["crash before the beacon", undefined],
      ["crash after the beacon", host],
    ]);
    // Through the detector and the tier rules, as a reproduced finding would be.
    const drafts = await pageErrorDetector.run({
      capture: { slice: { errors: recorder.errors }, evidence: { pageErrors: "ev_1" } },
    } as unknown as DetectorContext);
    const tiers = drafts.map((d) => {
      const c = { ...d, id: "cd_x" } as unknown as Candidate;
      return decideTier({
        ...tierFacts(c),
        evidenceValid: true,
        replay: { attempts: 2, reproduced: 2 },
      });
    });
    expect(tiers[0]!.tier).toBe("confirmed");
    expect(tiers[1]!.tier).toBe("needs_review");
    expect(tiers[1]!.reason).toMatch(
      new RegExp(
        `^Witness blocked a request to ${host.replace(".", "\\.")} just before this, which may be the cause\\.`,
      ),
    );
    // A new page (navigation) starts clean.
    await p.goto(app.url("/"));
    expect(recorder.blockedHost()).toBeUndefined();
    await context.close();
  });

  it("staging mode lets writes through", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "staging" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    await p.click("#write");
    await expect.poll(() => p.title()).toBe("status 200");
    await context.close();
  });

  it("aborts a top-level navigation to another origin (T3)", async () => {
    const policy = new SafetyPolicy({ origin: app.origin, mode: "staging" });
    const context = await createContext(browser, { policy, viewport: { width: 800, height: 600 } });
    const p = await context.newPage();
    await p.goto(app.url("/"));
    const before = other.requests.length; // earlier tests in this file post to the other server
    await p.click("#away").catch(() => undefined);
    await p.waitForTimeout(300);
    // Chromium shows its own error page for an aborted navigation; what matters is that the page never
    // reached the other origin and the other server never saw a request.
    expect(p.url().startsWith(other.origin)).toBe(false);
    expect(other.requests.slice(before)).toEqual([]);
    expect(policy.blocked.some((b) => b.reason === "off-origin-navigation")).toBe(true);
    await expect(p.goto(other.url("/"))).rejects.toThrow();
    await context.close();
  });
});
