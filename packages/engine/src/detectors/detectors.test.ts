// Fixture-page tests for every page detector (SPEC FR-4 AC): each has a page that must trigger it and a
// page that must not. Plus: a clean page produces no candidates at all from the full registry.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, detect, type Harness } from "../../test/harness";
import { page, PNG_1PX, startFixtureServer, type FixtureServer } from "../../test/fixture-server";
import { a11yDetector, axeSeverity } from "./a11y";
import { brokenImgDetector } from "./brokenimg";
import { consoleDetector, isNetworkEcho } from "./console";
import { http5xxDetector } from "./http5xx";
import { overflowDetector } from "./overflow";
import { pageErrorDetector } from "./pageerror";
import { perfDetector } from "./perf";
import { isBenignFailure, reqfailDetector } from "./reqfail";

const script = (js: string) => `<script>${js}</script>`;

let h: Harness;
let srv: FixtureServer;

beforeAll(async () => {
  h = await createHarness();
  srv = await startFixtureServer({
    "/clean": {
      body: page(`<p>All good.</p><img src="/ok.png" alt="A dot"><a href="/clean">Home</a>`, {
        title: "Clean",
      }),
    },
    "/ok.png": { body: PNG_1PX, contentType: "image/png" },
    "/pageerror": {
      body: page(
        `<p>Crashes.</p>${script("setTimeout(function(){ var o; o.links.push(1); }, 0)")}`,
      ),
    },
    "/console": {
      body: page(
        `<p>Logs.</p>${script(`console.error("Widget failed to initialise: code 42"); fetch("/missing-api");`)}`,
      ),
    },
    "/console-network-only": {
      body: page(`<p>404 fetch only.</p>${script(`fetch("/missing-api")`)}`),
    },
    "/http5xx": { body: page(`<p>Calls a broken API.</p>${script(`fetch("/api/boom")`)}`) },
    "/api/boom": { status: 500, contentType: "application/json", body: '{"error":"db"}' },
    "/http4xx": { body: page(`<p>Calls a missing API.</p>${script(`fetch("/api/missing")`)}`) },
    "/reqfail": {
      body: page(`<p>Connection drops.</p>${script(`fetch("/api/drop").catch(function(){})`)}`),
    },
    "/api/drop": { destroy: true },
    "/reqfail-blocked": {
      body: page(
        `<p>Writes in production.</p>${script(`fetch("/api/orders", {method:"POST"}).catch(function(){})`)}`,
      ),
    },
    "/brokenimg": {
      body: page(`<img src="/missing.png" alt="Company logo"><img src="/ok.png" alt="A dot">`),
    },
    "/a11y": {
      body: page(
        `<form><input type="email" name="email"><button><svg width="8" height="8"></svg></button></form>`,
      ),
    },
    "/perf": {
      body: page(
        `<p id="s">Loading…</p>${script(`fetch("/api/slow").then(function(){document.getElementById("s").textContent="Done"})`)}`,
      ),
    },
    "/api/slow": { delayMs: 2300, contentType: "application/json", body: "[]" },
    "/overflow": {
      body: page(`<div style="width:600px;background:#eee">A fixed-width panel</div>`),
    },
    "/fluid": { body: page(`<div style="max-width:600px;background:#eee">A fluid panel</div>`) },
  });
});
afterAll(async () => {
  await h?.close();
  await srv?.close();
});

describe("clean page", () => {
  it("produces no candidates from the full detector registry", async () => {
    const { candidates, errors } = await detect(h, srv.url("/clean"));
    expect(errors).toEqual([]);
    expect(candidates).toEqual([]);
  });
});

describe("DET-PAGEERROR", () => {
  it("records an uncaught exception as '<name>: <message>'", async () => {
    const { drafts } = await detect(h, srv.url("/pageerror"), { only: [pageErrorDetector] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.signals.errorMessage).toMatch(
      /^TypeError: Cannot read properties of undefined/,
    );
    expect(drafts[0]!.signature).toMatchObject({ kind: "page_error" });
    expect(drafts[0]!.category).toBe("crash");
  });
  it("ignores a page without errors", async () => {
    expect((await detect(h, srv.url("/clean"), { only: [pageErrorDetector] })).drafts).toEqual([]);
  });
});

describe("DET-CONSOLE", () => {
  it("reports console.error but not the browser's 'Failed to load resource' echo", async () => {
    const { drafts } = await detect(h, srv.url("/console"), { only: [consoleDetector] });
    expect(drafts.map((d) => d.signals.errorMessage)).toEqual([
      "Widget failed to initialise: code 42",
    ]);
  });
  it("produces nothing when the only console error is a network echo", async () => {
    expect(
      (await detect(h, srv.url("/console-network-only"), { only: [consoleDetector] })).drafts,
    ).toEqual([]);
  });
  it.each([
    ["Failed to load resource: the server responded with a status of 404 (Not Found)", true],
    ["Failed to load resource: net::ERR_CONNECTION_REFUSED", true],
    ["Uncaught TypeError: x is undefined", false],
  ])("isNetworkEcho(%s) = %s", (text, echo) => expect(isNetworkEcho(text)).toBe(echo));
});

describe("DET-HTTP5XX", () => {
  it("reports a same-origin 500 with method, path and status", async () => {
    const { drafts } = await detect(h, srv.url("/http5xx"), { only: [http5xxDetector] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.signals.request).toMatchObject({
      method: "GET",
      path: "/api/boom",
      status: 500,
    });
    expect(drafts[0]!.signature).toEqual({
      kind: "http",
      method: "GET",
      pathPattern: "/api/boom",
      statusClass: "5xx",
    });
  });
  it("ignores a 404", async () => {
    expect((await detect(h, srv.url("/http4xx"), { only: [http5xxDetector] })).drafts).toEqual([]);
  });
});

describe("DET-REQFAIL", () => {
  it("reports a dropped connection", async () => {
    const { drafts } = await detect(h, srv.url("/reqfail"), { only: [reqfailDetector] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.signals.request?.path).toBe("/api/drop");
  });
  it("ignores requests Witness's own policy aborted", async () => {
    const { drafts } = await detect(h, srv.url("/reqfail-blocked"), {
      only: [reqfailDetector],
      mode: "production",
    });
    expect(drafts).toEqual([]);
  });
  it("treats navigation-cancelled requests as benign", () => {
    expect(isBenignFailure("net::ERR_ABORTED")).toBe(true);
    expect(isBenignFailure("net::ERR_CONNECTION_RESET")).toBe(false);
  });
});

describe("DET-BROKENIMG", () => {
  it("reports the missing image with its status, not the working one", async () => {
    const { drafts } = await detect(h, srv.url("/brokenimg"), { only: [brokenImgDetector] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.signals.request).toMatchObject({ path: "/missing.png", status: 404 });
    expect(drafts[0]!.detail.title).toContain("Company logo");
  });
  it("ignores pages whose images load", async () => {
    expect((await detect(h, srv.url("/clean"), { only: [brokenImgDetector] })).drafts).toEqual([]);
  });
});

describe("DET-A11Y", () => {
  it("reports axe violations by rule, as improvements", async () => {
    const { drafts } = await detect(h, srv.url("/a11y"), { only: [a11yDetector] });
    const rules = drafts.map((d) => d.signals.axeRuleId).sort();
    expect(rules).toEqual(expect.arrayContaining(["button-name", "label"]));
    expect(drafts.every((d) => d.kind === "improvement" && d.category === "accessibility")).toBe(
      true,
    );
  });
  it("finds nothing on an accessible page", async () => {
    expect((await detect(h, srv.url("/clean"), { only: [a11yDetector] })).drafts).toEqual([]);
  });
  it.each([
    ["critical", "medium"],
    ["serious", "medium"],
    ["moderate", "low"],
    ["minor", "low"],
    [null, "low"],
  ] as const)("axe impact %s → %s", (impact, sev) => expect(axeSeverity(impact)).toBe(sev));
});

describe("DET-PERF", () => {
  it("reports a same-origin API slower than 2 s", async () => {
    const { drafts } = await detect(h, srv.url("/perf"), {
      only: [perfDetector],
      quietCapMs: 5_000,
    });
    const api = drafts.find((d) => d.signals.request?.path === "/api/slow");
    expect(api).toBeDefined();
    expect(api!.signals.request!.durationMs).toBeGreaterThan(2000);
    expect(api!.kind).toBe("improvement");
  });
  it("still reports it when the request is pending at capture time", async () => {
    const { drafts } = await detect(h, srv.url("/perf"), {
      only: [perfDetector],
      quietCapMs: 2_100,
    });
    expect(drafts.some((d) => d.signals.request?.path === "/api/slow")).toBe(true);
  });
  it("ignores fast pages", async () => {
    expect((await detect(h, srv.url("/clean"), { only: [perfDetector] })).drafts).toEqual([]);
  });
});

describe("DET-OVERFLOW", () => {
  it("reports sideways scroll at 375 px and names the widest element", async () => {
    const { drafts } = await detect(h, srv.url("/overflow"), { only: [overflowDetector] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.detail.actual).toMatch(/div \(600 px wide\)/);
  });
  it("ignores a fluid layout", async () => {
    expect((await detect(h, srv.url("/fluid"), { only: [overflowDetector] })).drafts).toEqual([]);
  });
});
