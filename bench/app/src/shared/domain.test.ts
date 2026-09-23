import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  formatMoney,
  formatPrice,
  isKnownRoute,
  isPastDate,
  isValidIsoDate,
} from "./domain";

const hourly = { id: "x", priceCents: 4500, unit: "hour" as const };
const fixed = { id: "y", priceCents: 10000, unit: "fixed" as const };

describe("calculateQuote", () => {
  it.each([
    [hourly, 3, 13500, 2025, 15525],
    [hourly, 2, 9000, 1350, 10350],
    [{ ...hourly, priceCents: 800 }, 3, 2400, 360, 2760],
    [fixed, 5, 10000, 1500, 11500],
  ])("%o × %i h", (service, hours, subtotal, gst, total) => {
    expect(calculateQuote(service, hours)).toMatchObject({
      subtotalCents: subtotal,
      gstCents: gst,
      totalCents: total,
    });
  });

  it("B01 variant applies GST twice to the total but not the GST line", () => {
    const q = calculateQuote(hourly, 3, { applyGstTwice: true });
    expect(q.gstCents).toBe(2025);
    expect(q.totalCents).toBe(17854); // 13500 × 1.3225 = 17853.75
  });
});

describe("formatting", () => {
  it.each([
    [4500, "$45"],
    [800, "$8"],
    [1250, "$12.50"],
  ])("formatPrice(%i) = %s", (cents, text) => expect(formatPrice(cents)).toBe(text));

  it.each([
    [15525, "$155.25"],
    [123450, "$1,234.50"],
    [5, "$0.05"],
  ])("formatMoney(%i) = %s", (cents, text) => expect(formatMoney(cents)).toBe(text));

  it("price strings sort differently from numbers (what B02 relies on)", () => {
    const texts = [800, 2000, 4500, 10000].map(formatPrice).sort();
    expect(texts).toEqual(["$100", "$20", "$45", "$8"]);
  });
});

describe("dates", () => {
  const now = new Date(2026, 8, 23, 15, 0); // 23 Sep 2026, local time
  it.each([
    ["2026-09-22", true],
    ["2026-09-23", false],
    ["2026-09-24", false],
    ["2025-12-31", true],
  ])("isPastDate(%s) = %s", (date, past) => expect(isPastDate(date, now)).toBe(past));

  it.each([
    ["2026-02-28", true],
    ["2026-02-30", false],
    ["2026-9-1", false],
    ["", false],
  ])("isValidIsoDate(%j) = %s", (date, ok) => expect(isValidIsoDate(date)).toBe(ok));
});

describe("isKnownRoute", () => {
  const ids = ["s1", "s8"];
  it.each([
    ["/", true],
    ["/services", true],
    ["/services/", true],
    ["/services/s1", true],
    ["/services/s8", true],
    ["/book/confirmation", true],
    ["/services/s9", false],
    ["/services/s1/extra", false],
    ["/terms-and-conditions", false],
    ["/services/%E0%A4%A", false],
  ])("%s → %s", (path, known) => expect(isKnownRoute(path, ids)).toBe(known));
});
