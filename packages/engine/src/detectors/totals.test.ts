// DET-TOTALS (D46): money breakdowns in the layouts real pages use — a definition list, one-line
// "Label: $x" rows, a table with a discount — and the cases that must stay quiet (sums that hold,
// tax-inclusive prices, a lone subtotal/total pair). The emitted check must fail on the same page and pass
// once the total is right, so replay and the exported test agree with the detector.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../browser/context";
import { SafetyPolicy } from "../browser/policy";
import { evaluateCheck } from "../oracle/evaluate";
import { createHarness, detect, DESKTOP, type Harness } from "../../test/harness";
import { page, startFixtureServer, type FixtureServer } from "../../test/fixture-server";
import { judgeBreakdown, roleOf, totalsDetector, type BreakdownRow } from "./totals";

let h: Harness;
let srv: FixtureServer;

const dl = (total: string) =>
  page(`<h2>Your quote</h2><dl>
    <dt>Subtotal</dt><dd data-testid="q-sub">$135.00</dd>
    <dt>Tax (10%)</dt><dd>$13.50</dd>
    <dt>Total (incl. 10% tax)</dt><dd data-testid="q-total">${total}</dd></dl>`);
const lines = (total: string) =>
  page(`<div class="summary"><div>Payment: card</div><div class="st">Item total: $29.99</div>
    <div class="tx">Tax: $2.40</div><div class="tt">Total: ${total}</div></div>`);
const table = (total: string) =>
  page(`<table><tbody>
    <tr><td>Subtotal</td><td>$80.00</td></tr>
    <tr><td>Shipping</td><td>$5.00</td></tr>
    <tr><td>Discount</td><td>-$10.00</td></tr>
    <tr><th>Order total</th><td>${total}</td></tr></tbody></table>`);

beforeAll(async () => {
  h = await createHarness();
  srv = await startFixtureServer({
    "/dl-ok": { body: dl("$148.50") },
    "/dl-bad": { body: dl("$163.35") },
    "/lines-ok": { body: lines("$32.39") },
    "/lines-bad": { body: lines("$34.79") },
    "/table-ok": { body: table("$75.00") },
    "/table-bad": { body: table("$85.00") },
    "/inclusive": {
      body: page(
        `<dl><dt>Subtotal</dt><dd>$115.00</dd><dt>GST included</dt><dd>$15.00</dd><dt>Total</dt><dd>$115.00</dd></dl>`,
      ),
    },
    "/pair": {
      body: page(`<dl><dt>Subtotal</dt><dd>$50.00</dd><dt>Total</dt><dd>$55.00</dd></dl>`),
    },
    "/prices": {
      body: page(`<ul><li>Backpack $29.99</li><li>Bike light $9.99</li><li>Onesie $7.99</li></ul>`),
    },
  });
});
afterAll(async () => {
  await srv.close();
  await h.close();
});

const run = async (path: string) =>
  (await detect(h, srv.url(path), { only: [totalsDetector] })).drafts;

describe("roleOf", () => {
  it.each([
    ["Subtotal", "subtotal"],
    ["Item total", "subtotal"],
    ["Total before tax", "subtotal"],
    ["GST (15%)", "tax"],
    ["VAT", "tax"],
    ["Total (incl. 15% GST)", "total"],
    ["Grand total", "total"],
    ["Amount due", "total"],
    ["Shipping", "shipping"],
    ["Promo code", "discount"],
    ["Booking fee (incl. tax)", "fee"],
    ["Payment", undefined],
  ])("%s → %s", (label, role) => expect(roleOf(label)).toBe(role));
});

describe("judgeBreakdown", () => {
  const row = (label: string, value: number): BreakdownRow => ({
    label,
    value,
    amountText: `$${value.toFixed(2)}`,
    role: roleOf(label)!,
    css: "x",
    depth: 1,
  });
  it("adds parts, subtracts discounts, tolerates a cent, accepts tax-inclusive totals", () => {
    const parts = [row("Subtotal", 100), row("Tax", 15), row("Discount", 5)];
    expect(judgeBreakdown(row("Total", 110), parts).ok).toBe(true);
    expect(judgeBreakdown(row("Total", 110.01), parts).ok).toBe(true);
    expect(judgeBreakdown(row("Total", 110.02), parts).ok).toBe(false);
    expect(
      judgeBreakdown(row("Total (incl. GST)", 100), [row("Subtotal", 100), row("GST", 15)]).ok,
    ).toBe(true);
    expect(judgeBreakdown(row("Total", 100), [row("Subtotal", 100), row("GST", 15)]).ok).toBe(
      false,
    );
  });
});

describe("DET-TOTALS on fixture pages", () => {
  it.each(["/dl-ok", "/lines-ok", "/table-ok", "/inclusive", "/pair", "/prices"])(
    "%s: no finding",
    async (path) => expect(await run(path)).toEqual([]),
  );

  it.each([
    ["/dl-bad", "163.35", "148.50"],
    ["/lines-bad", "34.79", "32.39"],
    ["/table-bad", "85.00", "75.00"],
  ])("%s: flags the total and explains the sum", async (path, shown, sum) => {
    const [d, ...rest] = await run(path);
    expect(rest).toEqual([]);
    expect(d!.source.id).toBe("DET-TOTALS");
    expect(d!.kind).toBe("bug");
    expect(d!.detail.actual).toContain(shown);
    expect(d!.detail.expected).toContain(sum);
    expect(d!.grounding).toMatchObject({ kind: "ui_text", verified: true });
    expect(d!.check?.type).toBe("numericRelation");
  });

  it("the emitted check fails on the buggy page and passes on the fixed one (replay/export agree)", async () => {
    const [d] = await run("/dl-bad");
    // It prefers test ids for the amounts it can.
    expect(JSON.stringify(d!.check)).toContain('"testId"');
    const context = await createContext(h.browser, {
      policy: new SafetyPolicy({ origin: srv.origin, mode: "staging" }),
      viewport: DESKTOP,
    });
    try {
      const p = await context.newPage();
      await p.goto(srv.url("/dl-bad"));
      expect((await evaluateCheck(d!.check!, { page: p, captures: new Map() })).status).toBe(
        "fail",
      );
      await p.goto(srv.url("/dl-ok"));
      expect((await evaluateCheck(d!.check!, { page: p, captures: new Map() })).status).toBe(
        "pass",
      );
    } finally {
      await context.close();
    }
  });
});
