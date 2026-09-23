// SECURITY.md §4: proves T1 (production write block, login allowed) and T3 (off-origin navigation aborted).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { startFixtureServer, page as html, type FixtureServer } from "../../test/fixture-server";
import { createContext, launchBrowser } from "./context";
import { SafetyPolicy, type RequestFacts } from "./policy";

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

  it("allows exactly the armed login write in production, then blocks other writes", () => {
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

  it("strict mode blocks cross-origin sub-resources", () => {
    const policy = new SafetyPolicy({ origin: ORIGIN, mode: "staging", strictSubresources: true });
    expect(policy.decide(req("GET", "https://cdn.example/lib.js")).allow).toBe(false);
  });
});

describe("SafetyPolicy in a real browser", () => {
  let browser: Browser;
  let app: FixtureServer;
  let other: FixtureServer;

  beforeAll(async () => {
    other = await startFixtureServer({
      "/": { body: html("<p>Another site</p>", { title: "Other" }) },
    });
    app = await startFixtureServer({
      "/": {
        body: html(`
          <form id="login" method="post" action="/login"><label>Email <input name="email"></label>
            <label>Password <input type="password" name="password"></label><button>Log in</button></form>
          <button id="write" onclick="fetch('/api/orders', { method: 'POST', body: '{}' }).then(r => document.title = 'status ' + r.status).catch(() => document.title = 'blocked')">Order</button>
          <a id="away" href="${other.url("/")}">Elsewhere</a>`),
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
    policy.armLoginWindow();
    await Promise.all([p.waitForURL(/\/login$/), p.click("#login button")]);
    policy.disarmLoginWindow();
    expect(await p.title()).toBe("Home");
    expect(policy.loginRequest).toEqual({ method: "POST", path: "/login" });
    // The same login request stays allowed (replays log in again); other writes don't.
    await p.goto(app.url("/"));
    await p.click("#write");
    await expect.poll(() => p.title()).toBe("blocked");
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
    await p.click("#away").catch(() => undefined);
    await p.waitForTimeout(300);
    // Chromium shows its own error page for an aborted navigation; what matters is that the page never
    // reached the other origin and the other server never saw a request.
    expect(p.url().startsWith(other.origin)).toBe(false);
    expect(other.requests).toEqual([]);
    expect(policy.blocked.some((b) => b.reason === "off-origin-navigation")).toBe(true);
    await expect(p.goto(other.url("/"))).rejects.toThrow();
    await context.close();
  });
});
