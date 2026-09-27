// Evaluator tests against fixture pages (SPEC FR-7 AC): every check type, pass and fail, tolerance,
// currency parsing, the label → value reading rule, and the "can't evaluate" (error) path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { launchBrowser } from "../browser/context";
import { evaluateCheck, type EvalContext } from "./evaluate";
import type { Check, Locator } from "./language";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
});
afterAll(async () => {
  await browser.close();
});

async function run(html: string, check: Check, extra: Partial<EvalContext> = {}) {
  await page.setContent(`<!doctype html><html lang="en"><body><main>${html}</main></body></html>`);
  return evaluateCheck(check, { page, captures: new Map(), waitMs: 200, ...extra });
}

const QUOTE = (total: string) => `
  <h1>Quote</h1>
  <dl>
    <dt>Subtotal</dt><dd data-testid="sub">$135.00</dd>
    <dt>Tax (10%)</dt><dd>$13.50</dd>
    <dt>Total (incl. 10% tax)</dt><dd data-testid="total">${total}</dd>
  </dl>
  <div class="row"><span>Grand total</span> <strong>${total}</strong></div>`;

const taxCheck = (tolerance?: number): Check => ({
  type: "numericRelation",
  left: { read: { by: "testId", id: "total" } },
  op: "eq",
  right: { op: "mul", a: { read: { by: "testId", id: "sub" } }, b: { const: 1.1 } },
  ...(tolerance !== undefined ? { tolerance } : {}),
});

describe("numericRelation", () => {
  it("passes when the total includes tax once", async () => {
    const r = await run(QUOTE("$148.50"), taxCheck());
    expect(r.status).toBe("pass");
    expect(r.observed).toMatchObject({ left: 148.5, right: 148.5, tolerance: 0.01 });
  });

  it("fails when tax is applied twice, and says why in plain words", async () => {
    const r = await run(QUOTE("$163.35"), taxCheck());
    expect(r.status).toBe("fail");
    expect(r.leaf).toBe("numericRelation");
    expect(r.message).toContain("163.35");
    expect(r.message).toContain("148.50");
    expect(r.message).toContain("≠");
  });

  it("uses the money tolerance (0.01) by default and honours an explicit one", async () => {
    expect((await run(QUOTE("$148.51"), taxCheck())).status).toBe("pass");
    expect((await run(QUOTE("$148.52"), taxCheck())).status).toBe("fail");
    expect((await run(QUOTE("$148.60"), taxCheck(0.2))).status).toBe("pass");
  });

  it("reads the amount next to a label that has no number of its own", async () => {
    const r = await run(QUOTE("$148.50"), {
      type: "numericRelation",
      left: { read: { by: "text", text: "Grand total", exact: true } },
      op: "eq",
      right: { const: 148.5 },
    });
    expect(r.status).toBe("pass");
  });

  it("skips percentages in a label and reads the amount after it", async () => {
    const r = await run(QUOTE("$148.50"), {
      type: "numericRelation",
      left: { read: { by: "text", text: "Total (incl. 10% tax)" } },
      op: "gt",
      right: { const: 100 },
    });
    expect(r.status).toBe("pass");
    expect(r.observed.left).toBe(148.5);
  });

  it.each([
    ["lt", 1, 2, "pass"],
    ["lt", 2, 2, "fail"],
    ["lte", 2, 2, "pass"],
    ["gt", 3, 2, "pass"],
    ["gte", 1, 2, "fail"],
    ["eq", 2, 3, "fail"],
  ] as const)("%s: %d vs %d → %s", async (op, a, b, want) => {
    const r = await run("<p>x</p>", {
      type: "numericRelation",
      left: { const: a },
      op,
      right: { const: b },
    });
    expect(r.status).toBe(want);
  });

  it("supports add, sub, div, count and captured values", async () => {
    const html = `<ul><li>a</li><li>b</li><li>c</li></ul><p id="p">NZ$ 12</p>`;
    const captures = new Map<string, number | string>([["base", 3]]);
    const r = await run(
      html,
      {
        type: "numericRelation",
        left: {
          op: "sub",
          a: {
            op: "add",
            a: { read: { by: "css", selector: "#p" } },
            b: { count: { by: "role", role: "listitem" } },
          },
          b: { captured: "base" },
        },
        op: "eq",
        right: { op: "div", a: { const: 24 }, b: { const: 2 } },
      },
      { captures },
    );
    expect(r.status).toBe("pass");
  });

  it("errors (not fails) on division by zero or a missing number", async () => {
    expect(
      (
        await run("<p>x</p>", {
          type: "numericRelation",
          left: { op: "div", a: { const: 1 }, b: { const: 0 } },
          op: "eq",
          right: { const: 1 },
        })
      ).status,
    ).toBe("error");
    const r = await run("<p id='p'>none</p>", {
      type: "numericRelation",
      left: { read: { by: "css", selector: "#p" } },
      op: "eq",
      right: { const: 1 },
    });
    expect(r.status).toBe("error");
    expect(r.message).toContain("shows no number");
  });

  it("errors when the target isn't on the page", async () => {
    const r = await run("<p>x</p>", taxCheck());
    expect(r.status).toBe("error");
    expect(r.message).toContain("Couldn't find");
  });
});

describe("ordered", () => {
  const list = (prices: string[]) =>
    `<label>Sort <select><option>Price: low to high</option></select></label><ul aria-label="Results">${prices
      .map((p, i) => `<li><h3>Item ${String.fromCharCode(65 + i)}</h3><p>${p} per hour</p></li>`)
      .join("")}</ul>`;
  const byPrice = (direction: "asc" | "desc"): Check => ({
    type: "ordered",
    items: { by: "role", role: "listitem", within: { by: "role", role: "list", name: "Results" } },
    read: "number",
    direction,
  });

  it("passes for numeric ascending order", async () => {
    expect((await run(list(["$8", "$20", "$45", "$100"]), byPrice("asc"))).status).toBe("pass");
  });

  it("fails for text-sorted prices and names the first item out of place", async () => {
    const r = await run(list(["$100", "$20", "$45", "$8"]), byPrice("asc"));
    expect(r.status).toBe("fail");
    expect(r.message).toContain("item 2 (20) comes after item 1 (100)");
    expect(r.observed.values).toEqual([100, 20, 45, 8]);
  });

  it("checks descending order and text order", async () => {
    expect((await run(list(["$45", "$20", "$8"]), byPrice("desc"))).status).toBe("pass");
    const names: Check = {
      type: "ordered",
      items: { by: "role", role: "heading", exact: false },
      read: "text",
      direction: "asc",
    };
    expect((await run(list(["$1", "$2", "$3"]), names)).status).toBe("pass");
  });

  it("errors with fewer than two items or an item without a number", async () => {
    expect((await run(list(["$8"]), byPrice("asc"))).status).toBe("error");
    expect((await run(list(["$8", "free"]), byPrice("asc"))).status).toBe("error");
  });
});

describe("visibility, text and URL", () => {
  it("visible / notVisible (hidden elements don't count)", async () => {
    const html = `<button>Save</button><p hidden>Saved</p>`;
    expect(
      (await run(html, { type: "visible", target: { by: "role", role: "button", name: "Save" } }))
        .status,
    ).toBe("pass");
    expect(
      (await run(html, { type: "visible", target: { by: "text", text: "Saved" } })).status,
    ).toBe("fail");
    expect(
      (await run(html, { type: "notVisible", target: { by: "text", text: "Saved" } })).status,
    ).toBe("pass");
    const r = await run(html, { type: "notVisible", target: { by: "role", role: "button" } });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("still visible");
  });

  it("reads a dropdown as its visible option label, not its internal value (found in the P2 bench run)", async () => {
    const html = `<label>Plan <select><option value="p1">Basic ($45 per month)</option><option value="p2" selected>Pro ($60 per month)</option></select></label>`;
    const r = await run(html, {
      type: "textMatches",
      target: { by: "label", text: "Plan" },
      pattern: "^Pro",
    });
    expect(r.status).toBe("pass");
    expect(r.observed.text).toBe("Pro ($60 per month)");
    const n = await run(html, {
      type: "numericRelation",
      left: { read: { by: "label", text: "Plan" } },
      op: "eq",
      right: { const: 60 },
    });
    expect(n.status).toBe("pass");
  });

  it("textMatches / textNotMatches, with the i flag and input values", async () => {
    const html = `<p id="s">3 results for "Novel"</p><label>Name <input value="Ana"></label>`;
    expect(
      (
        await run(html, {
          type: "textMatches",
          target: { by: "css", selector: "#s" },
          pattern: "^3 results",
        })
      ).status,
    ).toBe("pass");
    expect(
      (
        await run(html, {
          type: "textMatches",
          target: { by: "css", selector: "#s" },
          pattern: "novel",
          flags: "i",
        })
      ).status,
    ).toBe("pass");
    expect(
      (
        await run(html, {
          type: "textNotMatches",
          target: { by: "css", selector: "#s" },
          pattern: "results",
        })
      ).status,
    ).toBe("fail");
    expect(
      (
        await run(html, {
          type: "textMatches",
          target: { by: "label", text: "Name" },
          pattern: "^Ana$",
        })
      ).status,
    ).toBe("pass");
  });

  it("urlMatches tests the path (and the full URL)", async () => {
    await page.goto("about:blank");
    await page.route("http://fixture.test/**", (r) =>
      r.fulfill({ body: "<p>ok</p>", contentType: "text/html" }),
    );
    await page.goto("http://fixture.test/orders/42?tab=items");
    const ctx = { page, captures: new Map(), waitMs: 200 };
    expect(
      (await evaluateCheck({ type: "urlMatches", pattern: "^/orders/\\d+" }, ctx)).status,
    ).toBe("pass");
    expect(
      (await evaluateCheck({ type: "urlMatches", pattern: "fixture\\.test/orders" }, ctx)).status,
    ).toBe("pass");
    expect((await evaluateCheck({ type: "urlMatches", pattern: "^/checkout" }, ctx)).status).toBe(
      "fail",
    );
    await page.unroute("http://fixture.test/**");
  });
});

describe("capture and equalsCaptured", () => {
  it("captures a value and compares it later (persistence after reload)", async () => {
    const captures = new Map<string, number | string>();
    await run(
      `<label>Phone <input value="021 555 0101"></label>`,
      { type: "capture", name: "phone", value: { text: { by: "label", text: "Phone" } } },
      { captures },
    );
    expect(captures.get("phone")).toBe("021 555 0101");
    const same = await run(
      `<label>Phone <input value="021  555 0101"></label>`,
      { type: "equalsCaptured", name: "phone", value: { text: { by: "label", text: "Phone" } } },
      { captures },
    );
    expect(same.status).toBe("pass"); // whitespace-insensitive
    const reverted = await run(
      `<label>Phone <input value="09 000 0000"></label>`,
      { type: "equalsCaptured", name: "phone", value: { text: { by: "label", text: "Phone" } } },
      { captures },
    );
    expect(reverted.status).toBe("fail");
    expect(reverted.message).toContain('was "021 555 0101"');
  });

  it("compares captured numbers with tolerance, and captured text by name", async () => {
    const captures = new Map<string, number | string>([
      ["n", 3],
      ["t", "Hello"],
    ]);
    const html = `<ul><li>a</li><li>b</li><li>c</li></ul>`;
    expect(
      (
        await run(
          html,
          { type: "equalsCaptured", name: "n", value: { count: { by: "role", role: "listitem" } } },
          { captures },
        )
      ).status,
    ).toBe("pass");
    expect(
      (
        await run(
          html,
          { type: "equalsCaptured", name: "n", value: { const: 3.4 }, tolerance: 0.5 },
          { captures },
        )
      ).status,
    ).toBe("pass");
    expect(
      (
        await run(
          html,
          { type: "equalsCaptured", name: "t", value: { capturedText: "t" } },
          { captures },
        )
      ).status,
    ).toBe("pass");
  });

  it("fails (not errors) when the captured thing has disappeared: that is a change", async () => {
    const captures = new Map<string, number | string>([["first", "Atlas"]]);
    const r = await run(
      `<p>No results for "ATLAS".</p>`,
      {
        type: "equalsCaptured",
        name: "first",
        value: { text: { by: "text", text: "Atlas", exact: true } },
      },
      { captures },
    );
    expect(r.status).toBe("fail");
    expect(r.message).toContain('It was "Atlas" when captured');
    expect(r.message).toContain("isn't on the page at all");
    // …but a value that is present and unreadable is still an error, not a failure.
    const n = await run(
      `<p id="n">none</p>`,
      { type: "equalsCaptured", name: "count", value: { read: { by: "css", selector: "#n" } } },
      { captures: new Map([["count", 3]]) },
    );
    expect(n.status).toBe("error");
  });

  it("errors when nothing was captured under that name", async () => {
    const r = await run("<p>x</p>", {
      type: "equalsCaptured",
      name: "missing",
      value: { const: 1 },
    });
    expect(r.status).toBe("error");
    expect(
      (
        await run("<p>x</p>", {
          type: "numericRelation",
          left: { captured: "nope" },
          op: "eq",
          right: { const: 1 },
        })
      ).status,
    ).toBe("error");
    expect(
      (await run("<p>x</p>", { type: "capture", name: "c", value: { capturedText: "nope" } }))
        .status,
    ).toBe("error");
  });
});

describe("fieldRejected", () => {
  const field = { by: "label", text: "Email" } as const;
  it.each([
    ["aria-invalid", `<label>Email <input aria-invalid="true" value="x"></label>`],
    ["browser validation", `<label>Email <input type="email" value="not-an-email"></label>`],
    ["required and empty", `<label>Email <input required value=""></label>`],
    [
      "an associated error message",
      `<label>Email <input aria-describedby="e" value="x"></label><p id="e">Please enter a valid email</p>`,
    ],
    [
      "aria-errormessage",
      `<label>Email <input aria-errormessage="m" value="x"></label><span id="m">Nope</span>`,
    ],
  ])("passes on %s", async (_n, html) => {
    expect((await run(html, { type: "fieldRejected", field })).status).toBe("pass");
  });

  it("ignores plain help text that isn't an error", async () => {
    const html = `<label>Email <input aria-describedby="h" value="a@b.co"></label><p id="h">We'll never share it.</p>`;
    const r = await run(html, { type: "fieldRejected", field });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("accepted");
  });

  it("uses the success signature: no success state means the value was rejected", async () => {
    const html = `<label>Email <input value="a@b.co"></label><p>Please check the form</p>`;
    const success: Check = { type: "visible", target: { by: "text", text: "Thanks, we got it" } };
    expect(
      (await run(html, { type: "fieldRejected", field }, { successCheck: success })).status,
    ).toBe("pass");
    const accepted = `${html}<p>Thanks, we got it</p>`;
    expect(
      (await run(accepted, { type: "fieldRejected", field }, { successCheck: success })).status,
    ).toBe("fail");
  });
});

describe("noNewErrors, maxRequests and all", () => {
  it("noNewErrors reports what went wrong", async () => {
    expect((await run("<p>x</p>", { type: "noNewErrors" })).status).toBe("pass");
    const r = await run(
      "<p>x</p>",
      { type: "noNewErrors" },
      {
        errorsSince: () => ({
          pageErrors: ["TypeError: x is undefined"],
          serverErrors: ["POST /api/items → 500"],
          consoleErrors: [],
        }),
      },
    );
    expect(r.status).toBe("fail");
    expect(r.message).toContain("TypeError");
    expect(r.message).toContain("500");
  });

  it("maxRequests counts successful same-path requests", async () => {
    const reqs = [
      { method: "POST", path: "/api/items", status: 201 },
      { method: "POST", path: "/api/items", status: 201 },
      { method: "POST", path: "/api/items", status: 500 },
      { method: "GET", path: "/api/items", status: 200 },
    ];
    const check: Check = {
      type: "maxRequests",
      method: "post",
      pathPattern: "^/api/items$",
      max: 1,
    };
    const r = await run("<p>x</p>", check, { requestsSince: () => reqs });
    expect(r.status).toBe("fail");
    expect(r.observed.count).toBe(2);
    expect((await run("<p>x</p>", check, { requestsSince: () => reqs.slice(2) })).status).toBe(
      "pass",
    );
  });

  it("all passes only if every check passes; the first failure decides", async () => {
    const html = `<button>Save</button>`;
    const pass = await run(html, {
      type: "all",
      checks: [
        { type: "noNewErrors" },
        { type: "visible", target: { by: "role", role: "button" } },
      ],
    });
    expect(pass.status).toBe("pass");
    const fail = await run(html, {
      type: "all",
      checks: [
        { type: "visible", target: { by: "role", role: "button" } },
        { type: "notVisible", target: { by: "role", role: "button" } },
        { type: "noNewErrors" },
      ],
    });
    expect(fail.status).toBe("fail");
    expect(fail.leaf).toBe("notVisible");
  });

  it("reports an invalid role as an error rather than throwing", async () => {
    const r = await run("<p>x</p>", { type: "visible", target: { by: "css", selector: "p[" } });
    expect(r.status).toBe("error");
  });
});

describe("P3 evaluator additions", () => {
  const field = { by: "label", text: "Hours", exact: true } as const;
  const form = (extra = "") =>
    `<form><label for="h">Hours</label><input id="h" type="number" value="1000"><button>Go</button></form>${extra}`;

  it("fieldRejected: a form-level alert with error wording counts as a refusal", async () => {
    const r = await run(form('<div role="alert">Maximum booking is 12 hours</div>'), {
      type: "fieldRejected",
      field,
    });
    expect(r.status).toBe("pass");
    expect(r.message).toContain("Maximum booking is 12 hours");
  });

  it("fieldRejected: a refusal status on the submit's request counts as a refusal", async () => {
    const r = await run(
      form(),
      { type: "fieldRejected", field },
      { requestsSince: () => [{ method: "GET", path: "/api/quote", status: 400 }] },
    );
    expect(r.status).toBe("pass");
    expect(r.message).toContain("400");
  });

  it("fieldRejected: a success message in a live region or a 404 elsewhere is not a refusal", async () => {
    const r = await run(
      form('<div aria-live="polite">Saved</div>'),
      { type: "fieldRejected", field },
      { requestsSince: () => [{ method: "GET", path: "/favicon.ico", status: 404 }] },
    );
    expect(r.status).toBe("fail");
  });

  it("visible: a closed dropdown's chosen option counts as visible text", async () => {
    const html = `<label for="s">Service</label><select id="s"><option>Choose</option><option selected>Home clean ($45 per hour)</option></select>`;
    expect(
      (await run(html, { type: "visible", target: { by: "text", text: "$45 per hour" } })).status,
    ).toBe("pass");
    expect(
      (await run(html, { type: "visible", target: { by: "text", text: "$50 per hour" } })).status,
    ).toBe("fail");
    expect(
      (await run(html, { type: "notVisible", target: { by: "text", text: "$45 per hour" } }))
        .status,
    ).toBe("fail");
  });

  it("ordered: reads each item's money amount, not the first number", async () => {
    const html = `<ul id="l">
      <li>Onesie. Reinforced 3-snap closure. $7.99</li>
      <li>Bike light. 2 modes. $9.99</li>
      <li>Backpack. $29.99</li></ul>`;
    const r = await run(html, {
      type: "ordered",
      items: { by: "role", role: "listitem", within: { by: "css", selector: "#l" } },
      read: "number",
      direction: "asc",
    });
    expect(r.status).toBe("pass");
    expect(r.observed.values).toEqual([7.99, 9.99, 29.99]);
  });

  it("notPresent: fails when the canary became an element, passes when it's text", async () => {
    const target = { by: "css", selector: '[data-witness-canary="t1"]' } as const;
    expect(
      (
        await run(`<h2>Results for <i data-witness-canary="t1"></i></h2>`, {
          type: "notPresent",
          target,
        })
      ).status,
    ).toBe("fail");
    expect(
      (
        await run(`<h2>Results for "&gt;&lt;i data-witness-canary="t1"&gt;</h2>`, {
          type: "notPresent",
          target,
        })
      ).status,
    ).toBe("pass");
  });
});

describe("typographic quotes (P3)", () => {
  it("treats straight and curly quotes as the same character in text checks", async () => {
    const html = `<p>No services match “deep clean”.</p><p>It’s done</p>`;
    expect(
      (
        await run(html, {
          type: "visible",
          target: { by: "text", text: 'No services match "deep clean"' },
        })
      ).status,
    ).toBe("pass");
    expect(
      (await run(html, { type: "visible", target: { by: "text", text: "It's done", exact: true } }))
        .status,
    ).toBe("pass");
    expect(
      (
        await run(html, {
          type: "visible",
          target: { by: "text", text: 'No services match "window"' },
        })
      ).status,
    ).toBe("fail");
  });
});

describe("removal checks target the item's own control or row (D64, revised in P4)", () => {
  // A confirmation message that repeats the removed item's name is common; the check must not see it.
  const list = (ids: number[], status?: string) => `
    <h1>Invoices</h1>
    <ul aria-label="Invoices">
      ${ids.map((id) => `<li><span>Invoice ${id}</span> <button>Delete invoice ${id}</button></li>`).join("")}
    </ul>
    ${status ? `<p role="status">${status}</p>` : ""}`;
  const removed = (target: Locator): Check => ({
    type: "all",
    checks: [
      { type: "notVisible", target },
      { type: "visible", target: { by: "role", role: "button", name: "Delete invoice 41" } },
    ],
  });
  const byControl = { by: "role", role: "button", name: "Delete invoice 42", exact: true } as const;
  const inList = {
    by: "text",
    text: "Invoice 42",
    exact: true,
    within: { by: "role", role: "list", name: "Invoices" },
  } as const;

  it.each([
    ["its own control, by role and name", byControl],
    ["its text within the list", inList],
  ] as const)(
    "%s: passes when the row is gone and a status message names the item",
    async (_n, target) => {
      const r = await run(list([41, 43], "Invoice 42 deleted."), removed(target));
      expect(r.status).toBe("pass");
    },
  );

  it.each([
    ["its own control, by role and name", byControl],
    ["its text within the list", inList],
  ] as const)("%s: fails when the row is still there", async (_n, target) => {
    const r = await run(list([41, 42, 43], "Invoice 42 deleted."), removed(target));
    expect(r.status).toBe("fail");
    expect(r.leaf).toBe("notVisible");
  });

  it("why: the item's text anywhere on the page also matches the confirmation message", async () => {
    const r = await run(
      list([41, 43], "Invoice 42 deleted."),
      removed({ by: "text", text: "Invoice 42" }),
    );
    expect(r.status).toBe("fail");
  });
});
