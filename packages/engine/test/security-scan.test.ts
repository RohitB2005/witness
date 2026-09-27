// End-to-end: the run-level security detectors (ADDENDUM A1, A3, A4) on a fixture site (not the bench), in
// the deterministic pipeline, and the P3b gate's "secrets redacted everywhere" check: no file the run or its
// exports write contains the key. Fake keys are built from fragments (no full key literal in the repo).
import { readdir, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScan, writeRunExports } from "../src/index";
import { resolveScanConfig } from "../src/config/schema";
import { SecretVault } from "../src/browser/vault";
import type { Finding, RunResult } from "../src/types";
import { createHarness, type Harness } from "./harness";
import { page, startFixtureServer, type FixtureRoute, type FixtureServer } from "./fixture-server";

const SECRET = ["sk", "live", "WITNESSTESTFAKE0000DONOTUSEKEY"].join("_");
const PUBLISHABLE = ["pk", "live", "WITNESSTESTFAKE0000PUBLICKEY"].join("_");
const loggedIn = (req: IncomingMessage) => /(^|;\s*)sid=abc/.test(req.headers.cookie ?? "");
const query = (req: IncomingMessage) => new URL(req.url ?? "/", "http://x").searchParams;
const json = (body: unknown, status = 200): FixtureRoute => ({
  status,
  body: JSON.stringify(body),
  contentType: "application/json",
});
const nav = `<nav aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/search">Search</a></li><li><a href="/account">Account</a></li><li><a href="/login">Log in</a></li></ul></nav>`;

const routes: Record<string, FixtureRoute | ((req: IncomingMessage) => FixtureRoute)> = {
  "/": {
    body: page(
      `${nav}<p id="p">Welcome.</p><script>fetch("/api/public").catch(function(){})</script>`,
      {
        title: "Home",
        head: `<script src="/config.js"></script>`,
      },
    ),
  },
  "/config.js": {
    body: `window.CFG = { publishableKey: "${PUBLISHABLE}", secretKey: "${SECRET}" };`,
    contentType: "text/javascript",
  },
  "/api/public": json({ items: [{ id: 1, title: "A" }] }),
  "/search": {
    body: page(
      `${nav}<form role="search" method="get" action="/search"><label for="q">Search</label> <input id="q" type="search" name="q"> <button type="submit">Search</button></form><p id="out"></p>
<script>var q = new URLSearchParams(location.search).get("q"); if (q !== null) fetch("/api/search?q=" + encodeURIComponent(q)).then(function (r) { document.getElementById("out").textContent = r.ok ? "Results" : "Something went wrong"; });</script>`,
      { title: "Search" },
    ),
  },
  "/api/search": (req) =>
    (query(req).get("q") ?? "").includes("'")
      ? json({ error: `SQLITE_ERROR: near "'": syntax error` }, 500)
      : json({ results: [] }),
  "/login": {
    body: page(
      `${nav}<form method="post" action="/session"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Sign in</button></form>`,
      { title: "Log in" },
    ),
  },
  "POST /session": {
    status: 303,
    headers: { location: "/account", "set-cookie": "sid=abc; HttpOnly; Path=/" },
  },
  "/account": (req) =>
    loggedIn(req)
      ? {
          body: page(
            `${nav}<p>Your orders:</p><ul><li><a href="/orders/1001">Order 1001</a></li></ul><script>fetch("/api/me").catch(function(){}); fetch("/api/public?sort=new&q=a").catch(function(){})</script>`,
            { title: "Account" },
          ),
        }
      : { status: 302, headers: { location: "/login?next=/account" } },
  // Correct: needs a login.
  "/api/me": (req) =>
    loggedIn(req)
      ? json({ user: { email: "ana@example.test", plan: "pro" } })
      : json({ error: "login" }, 401),
  "/orders/1001": (req) =>
    loggedIn(req)
      ? {
          body: page(
            `${nav}<p id="o">Loading…</p><script>fetch("/api/orders/1001").then(function(r){return r.json()}).then(function(d){document.getElementById("o").textContent = d.order.item;})</script>`,
            {
              title: "Order",
            },
          ),
        }
      : { status: 302, headers: { location: "/login" } },
  // The bug: no session check.
  "/api/orders/1001": json({
    order: {
      ref: "1001",
      item: "Desk",
      email: "ana@example.test",
      phone: "021 000",
      address: "1 Road",
    },
  }),
};

let h: Harness;
let srv: FixtureServer;
let result: RunResult;

beforeAll(async () => {
  h = await createHarness();
  srv = await startFixtureServer(routes);
  const vault = new SecretVault();
  vault.set("password", "fixture-pass-1");
  result = await runScan(
    resolveScanConfig({
      url: srv.url("/"),
      mode: "staging",
      pipeline: "deterministic",
      budget: "quick",
      credentials: { username: "me@site.test", passwordRef: "password" },
    }),
    { store: h.store, vault, browser: h.browser },
  );
}, 180_000);
afterAll(async () => {
  await h?.close();
  await srv?.close();
});

const by = (id: string) =>
  result.findings.filter((f: Finding) => f.source.kind === "detector" && f.source.id === id);

describe("security detectors on a fixture site", () => {
  it("DET-SECRETS: reports the secret key once, redacted, and not the publishable key", () => {
    expect(result.error).toBeUndefined();
    const secrets = by("DET-SECRETS");
    expect(secrets.map((f) => f.title)).toEqual(["Stripe secret key exposed to the browser"]);
    expect(secrets[0]!.actual).toContain("sk_l…EKEY");
    expect(secrets[0]!.tier).toBe("confirmed");
    expect(secrets[0]!.severity).toBe("critical");
  });

  it("DET-DBERROR: the quote-heavy search input exposes the SQLite error; one finding with its 5xx", () => {
    const db = by("DET-DBERROR");
    expect(db).toHaveLength(1);
    expect(db[0]!.signals.request?.path).toMatch(/^\/api\/search\?q=/);
    expect(db[0]!.category).toBe("security");
    expect(db[0]!.tier).toBe("confirmed");
    // Grouped with the 500 from the same request: no separate server-error finding for it.
    expect(
      by("DET-HTTP5XX").filter((f) => f.signals.request?.path.startsWith("/api/search")),
    ).toEqual([]);
  });

  it("DET-AUTHZ: flags only the logged-in API that answers without a login", () => {
    const authz = by("DET-AUTHZ");
    expect(authz.map((f) => f.signals.request?.path)).toEqual(["/api/orders/1001"]);
    expect(authz[0]!.tier).toBe("confirmed");
    expect(authz[0]!.severity).toBe("critical"); // contact details in the data
    expect(authz[0]!.actual).toContain("fields: ref, item, email, phone, address");
    expect(authz[0]!.actual).not.toContain("ana@example.test");
  });

  it("the secret is never written to disk: run files and every export", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "witness-exports-"));
    await writeRunExports(h.store, result, {
      formats: new Set(["md", "html", "json"]),
      redact: (s) => s,
      outDir: out,
      tests: true,
    });
    const files = [...(await walk(h.store.runDir(result.runId))), ...(await walk(out))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      if (/\.(jpe?g|png)$/.test(f)) continue; // screenshots: the key is never rendered on a page here
      const text = await readFile(f, "utf8");
      expect(text.includes(SECRET), `${f} contains the secret`).toBe(false);
    }
  });
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

describe("response observer: a logged-out context that logs in", () => {
  it("stops counting as 'without a login' after its first write request", async () => {
    const { ResponseObserver } = await import("../src/record/responses");
    const { EvidenceWriter } = await import("../src/record/evidence");
    const { createContext, observeContexts } = await import("../src/browser/context");
    const { SafetyPolicy } = await import("../src/browser/policy");
    const observer = new ResponseObserver(srv.origin, new EvidenceWriter(h.store, h.runId));
    const unobserve = observeContexts(h.browser, observer);
    const context = await createContext(h.browser, {
      policy: new SafetyPolicy({ origin: srv.origin, mode: "staging" }),
      viewport: { width: 800, height: 600 },
    });
    try {
      const page = await context.newPage();
      await page.goto(srv.url("/"));
      await page.evaluate(async () => {
        await fetch("/api/public");
        await fetch("/session", { method: "POST", redirect: "manual" }); // logs in (sets the cookie)
        await fetch("/api/me");
      });
      await observer.settle();
    } finally {
      await context.close();
      unobserve();
    }
    expect(observer.anonymousOk.has("/api/public")).toBe(true); // before the login
    expect(observer.anonymousOk.has("/api/me")).toBe(false); // after it
  });
});
