// Executor: SECURITY.md T1 (destructive-verb policy per mode), T3 (goto and links stay on the site),
// secret placeholders, ref → stable locator conversion, checks as steps, and detectors on steps.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { createContext } from "../browser/context";
import { SafetyPolicy } from "../browser/policy";
import { SecretVault } from "../browser/vault";
import { toPlaywright } from "../oracle/locate";
import { PageRecorder } from "../record/recorder";
import type { ScanMode } from "../types";
import { createHarness, DESKTOP, MOBILE, type Harness } from "../../test/harness";
import { page as html, startFixtureServer, type FixtureServer } from "../../test/fixture-server";
import { Executor } from "./executor";
import { parseRoleLine } from "./locators";
import { destructiveBlock } from "./safety";
import { StateRegistry } from "./states";

describe("destructive-verb policy (pure)", () => {
  it.each([
    ["Delete account", "staging", true],
    ["Close my account", "staging", true],
    ["Unsubscribe", "staging", true],
    ["Transfer funds", "staging", true],
    ["Delete", "staging", false],
    ["Cancel booking", "staging", false],
    ["Place order", "staging", false],
    ["Delete", "production", true],
    ["Cancel booking", "production", true],
    ["Place order", "production", true],
    ["Pay now", "production", true],
    ["Submit", "production", true],
    ["Confirm", "production", true],
    ["Search", "production", false],
    ["Log in", "production", false],
    ["Sort by", "production", false],
    ["Next", "production", false],
  ] as const)("%s in %s → blocked: %s", (label, mode, blocked) => {
    expect(destructiveBlock(label, mode as ScanMode) !== undefined).toBe(blocked);
  });
});

describe("parseRoleLine", () => {
  it.each([
    ['- button "Log in" [ref=e3]', "button", "Log in"],
    ['- textbox "Email": a@b.co', "textbox", "Email"],
    ['- heading "Say \\"hi\\"" [level=1]', "heading", 'Say "hi"'],
    ["- generic [ref=e2]:", "generic", ""],
    ["", "", ""],
  ])("%s", (line, role, name) => {
    expect(parseRoleLine(line)).toEqual({ role, name });
  });
});

let h: Harness;
let srv: FixtureServer;
const PASSWORD = "S3cret!pw";

beforeAll(async () => {
  h = await createHarness();
  srv = await startFixtureServer({
    "/": {
      body: html(
        `<nav aria-label="Main"><a href="/form">Form</a> <a href="https://example.com/">Partner site</a></nav>
         <button id="del" onclick="document.title='deleted'">Delete account</button>
         <button id="order" onclick="document.title='ordered'">Place order</button>
         <button onclick="fetch('/api/boom').then(()=>{document.title='boomed'})">Load stats</button>
         <button onclick="fetch('/api/missing').then(()=>{document.title='missed'})">Load extras</button>
         <dl><dt>Total</dt><dd data-testid="total">$12.50</dd><dt>Items</dt><dd>3</dd></dl>
         <ul aria-label="Results"><li>A $8</li><li>B $20</li><li>C $45</li></ul>`,
        { title: "Home" },
      ),
    },
    "/form": {
      body: html(
        `<form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Saved ' + document.getElementById('pw').value.length">
           <label>Email <input type="email" name="email" required></label>
           <label>Password <input type="password" id="pw" name="password"></label>
           <button type="submit">Save</button>
         </form><p id="out"></p>`,
        { title: "Form" },
      ),
    },
    "/api/boom": { status: 500, body: "{}", contentType: "application/json" },
    "/api/missing": { status: 404, body: "{}", contentType: "application/json" },
  });
});
afterAll(async () => {
  await srv.close();
  await h.close();
});

async function executor(mode: ScanMode, start = "/") {
  const policy = new SafetyPolicy({ origin: srv.origin, mode });
  const context: BrowserContext = await createContext(h.browser, { policy, viewport: DESKTOP });
  const page = await context.newPage();
  const recorder = new PageRecorder(page, policy);
  const vault = new SecretVault();
  vault.set("pw", PASSWORD);
  const ex = new Executor({
    page,
    recorder,
    evidence: h.writer,
    vault,
    policy,
    mode,
    journeyId: "jr_test",
    kind: "happy",
    session: "anonymous",
    states: new StateRegistry(),
    viewport: DESKTOP,
    mobileViewport: MOBILE,
    credentials: { username: "tester@example.test", passwordRef: "pw" },
    quietCapMs: 1_500,
  });
  await ex.act({ type: "goto", path: start });
  return { ex, page, context };
}

async function refFor(page: Page, role: string, name: string): Promise<string> {
  const snap = await page.ariaSnapshot({ mode: "ai" });
  const line = snap.split("\n").find((l) => l.includes(`- ${role} "${name}"`));
  const ref = /\[ref=([a-z0-9]+)\]/.exec(line ?? "")?.[1];
  if (!ref) throw new Error(`no ref for ${role} "${name}" in:\n${snap}`);
  return ref;
}

describe("executor safety (T1, T3)", () => {
  it("never clicks an account-deleting control, in either mode", async () => {
    for (const mode of ["staging", "production"] as const) {
      const { ex, page, context } = await executor(mode);
      const r = await ex.act({
        type: "click",
        target: { ref: await refFor(page, "button", "Delete account") },
      });
      expect(r.blocked).toBe(true);
      expect(r.message).toContain("Blocked by safety policy");
      expect(await page.title()).toBe("Home"); // the handler never ran
      await context.close();
    }
  });

  it("blocks 'Place order' in production mode but allows it in staging", async () => {
    const prod = await executor("production");
    const r1 = await prod.ex.act({
      type: "click",
      target: { by: "role", role: "button", name: "Place order" },
    });
    expect(r1.blocked).toBe(true);
    expect(await prod.page.title()).toBe("Home");
    await prod.context.close();
    const staging = await executor("staging");
    const r2 = await staging.ex.act({
      type: "click",
      target: { by: "role", role: "button", name: "Place order" },
    });
    expect(r2.ok).toBe(true);
    expect(await staging.page.title()).toBe("ordered");
    await staging.context.close();
  });

  it("goto accepts same-origin paths only; an off-site link is stopped and the page goes back", async () => {
    const { ex, page, context } = await executor("staging");
    const bad = await ex.act({ type: "goto", path: "https://example.com/x" });
    expect(bad.blocked).toBe(true);
    const off = await ex.act({
      type: "click",
      target: { ref: await refFor(page, "link", "Partner site") },
    });
    expect(off.blocked).toBe(true);
    expect(off.message).toContain("outside the site");
    expect(page.url()).toBe(srv.url("/"));
    const good = await ex.act({ type: "goto", path: "/form" });
    expect(good.ok).toBe(true);
    expect(new URL(page.url()).pathname).toBe("/form");
    await context.close();
  });

  it("only allows a few keys", async () => {
    const { ex, context } = await executor("staging");
    expect((await ex.act({ type: "press", key: "Control+A" })).blocked).toBe(true);
    expect((await ex.act({ type: "press", key: "Tab" })).ok).toBe(true);
    await context.close();
  });
});

describe("recording", () => {
  it("types the secret from the vault but stores and describes only the placeholder", async () => {
    const { ex, page, context } = await executor("staging", "/form");
    await ex.act({
      type: "fill",
      target: { ref: await refFor(page, "textbox", "Email") },
      value: "{{secret:username}}",
    });
    const fill = await ex.act({
      type: "fill",
      target: { ref: await refFor(page, "textbox", "Password") },
      value: "{{secret:password}}",
    });
    await ex.act({ type: "click", target: { ref: await refFor(page, "button", "Save") } });
    expect(await page.locator("#out").innerText()).toBe(`Saved ${PASSWORD.length}`);
    expect(fill.step.action).toEqual({
      type: "fill",
      target: { by: "role", role: "textbox", name: "Password", exact: true },
      value: "{{secret:password}}",
    });
    expect(fill.step.description).toBe('Type the password into the "Password" field');
    expect(JSON.stringify(ex.steps)).not.toContain(PASSWORD);
    expect(fill.step.target).toMatchObject({ inputType: "password", tag: "input" });
    expect(ex.steps[1]?.target?.formKey).toBe(ex.steps[3]?.target?.formKey);
    expect(ex.steps[3]?.target?.isSubmit).toBe(true);
    await context.close();
  });

  it("re-locates a value the agent located by its own digits (the value changes when the bug is fixed)", async () => {
    const { ex, context } = await executor("staging");
    const stored = await ex.storedCheck({
      type: "numericRelation",
      left: { read: { by: "text", text: "$12.50" } },
      op: "gt",
      right: { const: 0 },
    });
    expect(stored).toEqual({
      type: "numericRelation",
      left: { read: { by: "testId", id: "total" } },
      op: "gt",
      right: { const: 0 },
    });
    // A visible-text target is what's being checked, so it stays as written.
    const visible = await ex.storedCheck({
      type: "visible",
      target: { by: "text", text: "$12.50" },
    });
    expect(visible).toEqual({ type: "visible", target: { by: "text", text: "$12.50" } });
    await context.close();
  });

  it("converts refs to stable locators: role+name to act, test id to read a value, list items for order", async () => {
    const { ex, page, context } = await executor("staging");
    const snap = await page.ariaSnapshot({ mode: "ai" });
    const refOf = (text: string) =>
      /\[ref=([a-z0-9]+)\]/.exec(snap.split("\n").find((l) => l.includes(text)) ?? "")?.[1] ?? "";
    const stored = await ex.storedCheck({
      type: "all",
      checks: [
        {
          type: "numericRelation",
          left: { read: { ref: refOf("$12.50") } },
          op: "eq",
          right: { const: 12.5 },
        },
        {
          type: "ordered",
          items: { ref: refOf('list "Results"') },
          read: "number",
          direction: "asc",
        },
        {
          type: "numericRelation",
          left: { count: { ref: refOf("A $8") } },
          op: "eq",
          right: { const: 3 },
        },
      ],
    });
    expect(stored).toEqual({
      type: "all",
      checks: [
        {
          type: "numericRelation",
          left: { read: { by: "testId", id: "total" } },
          op: "eq",
          right: { const: 12.5 },
        },
        {
          type: "ordered",
          items: {
            by: "role",
            role: "listitem",
            within: { by: "role", role: "list", name: "Results", exact: true },
          },
          read: "number",
          direction: "asc",
        },
        {
          type: "numericRelation",
          left: {
            count: {
              by: "role",
              role: "listitem",
              within: { by: "role", role: "list", name: "Results", exact: true },
            },
          },
          op: "eq",
          right: { const: 3 },
        },
      ],
    });
    // A value without a test id never gets a locator built from its (changing) digits.
    const items = await ex
      .resolve({ ref: refOf('- definition: "3"') || refOf("definition") }, "read")
      .catch(() => undefined);
    if (items) expect(JSON.stringify(items.locator)).not.toMatch(/"text":"3"/);
    const r = await ex.check(stored, { statement: "Total and order" });
    expect(r.result.status).toBe("pass");
    expect(r.step.action.type).toBe("check");
    expect(r.step.afterEvidenceIds).toHaveLength(1);
    expect(await toPlaywright(page, { by: "testId", id: "total" }).count()).toBe(1);
    await context.close();
  });

  it("a stale ref is a clear error for the agent, not a crash", async () => {
    const { ex, context } = await executor("staging");
    const r = await ex.act({ type: "click", target: { ref: "e9999" } });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Refs change after every action");
    await context.close();
  });

  it("captures survive a reload and equalsCaptured compares them", async () => {
    const { ex, context } = await executor("staging");
    await ex.check({
      type: "capture",
      name: "total",
      value: { read: { by: "testId", id: "total" } },
    });
    await ex.act({ type: "reload" });
    const r = await ex.check({
      type: "equalsCaptured",
      name: "total",
      value: { read: { by: "testId", id: "total" } },
    });
    expect(r.result.status).toBe("pass");
    expect(ex.steps.map((s) => s.description)).toEqual([
      "Go to /",
      "Note the value of total",
      "Reload the page",
      "Check (equalsCaptured)",
    ]);
    await context.close();
  });

  it("runs detectors on steps: a 500 during a click is DET-HTTP5XX, a 404 fetch on a happy step is DET-HTTP4XX", async () => {
    const { ex, context } = await executor("staging");
    const boom = await ex.act({
      type: "click",
      target: { by: "role", role: "button", name: "Load stats" },
    });
    const ids = boom.candidates.map((c) => c.source.kind === "detector" && c.source.id);
    expect(ids).toContain("DET-HTTP5XX");
    const five = boom.candidates.find((c) => c.signals.request?.status === 500)!;
    expect(five.journeyId).toBe("jr_test");
    expect(five.stepIds).toEqual(ex.steps.map((s) => s.id));
    const miss = await ex.act({
      type: "click",
      target: { by: "role", role: "button", name: "Load extras" },
    });
    expect(miss.candidates.map((c) => c.source.kind === "detector" && c.source.id)).toContain(
      "DET-HTTP4XX",
    );
    // noNewErrors sees the 500 from earlier (no assert since the journey started)
    const r = await ex.check({ type: "noNewErrors" });
    expect(r.result.status).toBe("fail");
    // …and after that assert, the slate is clean.
    expect((await ex.check({ type: "noNewErrors" })).result.status).toBe("pass");
    await context.close();
  });
});
