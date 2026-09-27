// End-to-end runScan on a small fixture site (not the bench): preflight login in production mode, both
// crawl passes, dedupe, site detectors, budgets, and the safety properties observed from the server side.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { runScan } from "../src/index";
import { resolveScanConfig } from "../src/config/schema";
import { SecretVault } from "../src/browser/vault";
import { crawl } from "../src/crawl/crawler";
import { SafetyPolicy } from "../src/browser/policy";
import { createHarness, DESKTOP, MOBILE, type Harness } from "./harness";
import { page, startFixtureServer, type FixtureRoute, type FixtureServer } from "./fixture-server";

const loggedIn = (req: IncomingMessage) => /(^|;\s*)sid=abc/.test(req.headers.cookie ?? "");
const nav = (extra = "") =>
  `<nav aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li><li><a href="/account">Account</a></li><li><a href="/login">Log in</a></li>${extra}</ul></nav>`;

function site(
  loginWorks: boolean,
): Record<string, FixtureRoute | ((req: IncomingMessage) => FixtureRoute)> {
  return {
    "/": {
      body: page(
        `${nav()}<p>Welcome.</p><a href="/missing">Old page</a><a href="https://example.com/">Partner</a>`,
        { title: "Home" },
      ),
    },
    "/about": { body: page(`${nav()}<p>About us.</p>`, { title: "About" }) },
    "/login": {
      body: page(
        `${nav()}<form method="post" action="/session"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Sign in</button></form>`,
        { title: "Log in" },
      ),
    },
    "POST /session": loginWorks
      ? {
          status: 303,
          headers: { location: "/account", "set-cookie": "sid=abc; HttpOnly; Path=/" },
        }
      : { status: 303, headers: { location: "/login" } },
    "/account": (req) =>
      loggedIn(req)
        ? {
            body: page(
              `${nav('<li><a href="/logout">Log out</a></li>')}<p>Your orders:</p><ul><li><a href="/orders/1">Order 1</a></li><li><a href="/orders/2">Order 2</a></li><li><a href="/orders/3">Order 3</a></li></ul><script>fetch("/api/track", { method: "POST" }).catch(function(){})</script>`,
              { title: "Account" },
            ),
          }
        : { status: 302, headers: { location: "/login?next=/account" } },
    "/orders/1": { body: page(`${nav()}<p>Order details.</p>`, { title: "Order" }) },
    "/orders/2": { body: page(`${nav()}<p>Order details.</p>`, { title: "Order" }) },
    "/orders/3": { body: page(`${nav()}<p>Order details.</p>`, { title: "Order" }) },
    "/logout": { status: 302, headers: { location: "/" } },
    "POST /api/track": { body: "{}", contentType: "application/json" },
  };
}

let h: Harness;
let srv: FixtureServer;
let badLogin: FixtureServer;

beforeAll(async () => {
  h = await createHarness();
  srv = await startFixtureServer(site(true));
  badLogin = await startFixtureServer(site(false));
});
afterAll(async () => {
  await h?.close();
  await srv?.close();
  await badLogin?.close();
});

function vaultWith(password: string): SecretVault {
  const v = new SecretVault();
  v.set("password", password);
  return v;
}

describe("runScan (deterministic pipeline) on a fixture site", () => {
  it("logs in under production mode, crawls both passes and never writes or logs out", async () => {
    const config = resolveScanConfig({
      url: srv.url("/"),
      mode: "production",
      pipeline: "deterministic",
      budget: "quick",
      credentials: { username: "me@site.test", passwordRef: "password" },
    });
    const events: string[] = [];
    const result = await runScan(config, {
      store: h.store,
      vault: vaultWith("s3cret-pass"),
      browser: h.browser,
      sink: (e) => events.push(e.t),
    });

    expect(result.error).toBeUndefined();
    expect(result.config).not.toHaveProperty("credentials");
    expect(result.config.loggedInAs).toBe("me@site.test");

    // Safety, as seen by the server.
    expect(srv.requests.filter((r) => r === "POST /session")).toHaveLength(1); // the one allowed write
    expect(srv.requests).not.toContain("POST /api/track"); // blocked in production mode
    expect(srv.requests).not.toContain("GET /logout"); // log-out links are never followed

    // Logged-in pass reached the gated page; /orders/:id deduped to one state.
    const routes = result.states.map((s) => `${s.session}:${s.routePattern}`);
    expect(routes).toContain("authenticated:/account");
    expect(result.states.filter((s) => s.routePattern === "/orders/:id")).toHaveLength(1);
    expect(result.states.some((s) => s.url.startsWith("https://example.com"))).toBe(false);

    // Site detectors.
    const broken = result.findings.find(
      (f) => f.source.kind === "detector" && f.source.id === "DET-BROKENLINK",
    );
    expect(broken?.signals.request).toMatchObject({ path: "/missing", status: 404 });
    expect(
      result.findings.some((f) => f.source.kind === "detector" && f.source.id === "DET-SECHEADERS"),
    ).toBe(true);

    // Report shape.
    expect(result.verdict.level).toBe("caveats");
    expect(result.notTested[0]).toMatch(/only page loads/);
    expect(events).toEqual(expect.arrayContaining(["phase", "page", "finding", "done"]));
    const saved = await h.store.getResult(result.runId);
    expect(saved?.findings.length).toBe(result.findings.length);
  });

  it("stops with a plain message when login fails, before crawling", async () => {
    const config = resolveScanConfig({
      url: badLogin.url("/"),
      pipeline: "deterministic",
      budget: "quick",
      credentials: { username: "me@site.test", passwordRef: "password" },
    });
    const result = await runScan(config, {
      store: h.store,
      vault: vaultWith("wrong"),
      browser: h.browser,
    });
    expect(result.error).toMatch(/^Couldn't log in with the details provided/);
    expect(result.states).toEqual([]);
    expect(badLogin.requests).not.toContain("GET /about");
  });

  it("fails preflight with a plain message when the target is unreachable", async () => {
    const config = resolveScanConfig({ url: "http://127.0.0.1:9", pipeline: "deterministic" });
    const result = await runScan(config, {
      store: h.store,
      vault: new SecretVault(),
      browser: h.browser,
    });
    expect(result.error).toMatch(/couldn't reach/i);
  });
});

describe("crawl budget", () => {
  it("stops at the page budget and lists what it didn't visit", async () => {
    const policy = new SafetyPolicy({ origin: srv.origin, mode: "staging" });
    const out = await crawl({
      browser: h.browser,
      policy,
      evidence: h.writer,
      sink: () => {},
      startUrl: srv.url("/"),
      viewport: DESKTOP,
      mobileViewport: MOBILE,
      pageBudget: 2,
      deadline: Date.now() + 60_000,
    });
    expect(out.states).toHaveLength(2);
    expect(out.capsHit).toEqual(["pages"]);
    expect(out.notVisited.length).toBeGreaterThan(0);
  });
});

describe("cancelling a scan", () => {
  it("saves the run as cancelled, with no verdict, and the abandoned work stops writing", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { JsonRunStore } = await import("../src/store/json-store");
    const dir = await mkdtemp(path.join(tmpdir(), "witness-cancel-"));
    const store = new JsonRunStore({
      runsDir: path.join(dir, "runs"),
      dataDir: path.join(dir, "data"),
    });
    const controller = new AbortController();
    const seen: string[] = [];
    const config = resolveScanConfig({
      url: srv.url("/"),
      pipeline: "deterministic",
      budget: "quick",
    });
    const result = await runScan(config, {
      store,
      vault: new SecretVault(),
      browser: h.browser,
      signal: controller.signal,
      sink: (e) => {
        seen.push(e.t);
        if (e.t === "page") controller.abort();
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.error).toBe("Cancelled by you.");
    expect(result.verdict.reason).toContain("cancelled");
    expect(seen.at(-1)).toBe("done");
    expect((await store.getResult(result.runId))?.cancelled).toBe(true);
    // Give the abandoned work time to fail; nothing more may reach the run's files.
    await new Promise((r) => setTimeout(r, 1_500));
    const events = (await readFile(path.join(store.runDir(result.runId), "events.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { t: string });
    expect(events.at(-1)?.t).toBe("done");
    expect((await store.getResult(result.runId))?.cancelled).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
