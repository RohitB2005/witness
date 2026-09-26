import { describe, expect, it } from "vitest";
import { amounts, containsLoose, fmt, normaliseText, parseAmount } from "./parse";

describe("parseAmount", () => {
  it.each([
    ["$1,234.50", 1234.5, true],
    ["NZ$ 12", 12, true],
    ["12.00", 12, true],
    ["-3", -3, false],
    ["−3", -3, false],
    ["-$3.00", -3, true],
    ["€9.99", 9.99, true],
    ["USD 40", 40, true],
    ["Total (incl. 15% GST) $155.25", 155.25, true],
    ["$45 per hour", 45, true],
    ["3 items", 3, false],
    ["Price: 1,000,000", 1_000_000, false],
    ["0.5 hours", 0.5, false],
  ])("%s → %d (money: %s)", (text, value, money) => {
    const a = parseAmount(text);
    expect(a?.value).toBe(value);
    expect(a?.isMoney).toBe(money);
  });

  it.each([["no numbers here"], ["15%"], [""]])("%s → undefined", (text) => {
    expect(parseAmount(text)).toBeUndefined();
  });

  it("doesn't read a hyphen between numbers as a minus sign", () => {
    expect(amounts("2026-10-01").map((a) => a.value)).toEqual([2026, 10, 1]);
    expect(amounts("5 - 3").map((a) => a.value)).toEqual([5, -3]);
  });

  it("marks percentages", () => {
    expect(amounts("15% off $20").map((a) => [a.value, a.isPercent])).toEqual([
      [15, true],
      [20, false],
    ]);
  });

  it("documents the out-of-scope decimal-comma format", () => {
    // "1 234,50" is read as two numbers, not 1234.5 (documented limitation).
    expect(parseAmount("1 234,50")?.value).toBe(1);
  });
});

describe("text helpers", () => {
  it("normalises whitespace", () => {
    expect(normaliseText("  a \n\t b  ")).toBe("a b");
  });
  it.each([
    ["Total (incl. 15% GST)", "total (INCL. 15%  gst)", true],
    ["Price: low to high", "Price:\nlow to high", true],
    ["Save", "Saved", false],
    ["anything", "  ", false],
  ])("containsLoose(%j, %j) = %s", (hay, needle, want) => {
    expect(containsLoose(hay, needle)).toBe(want);
  });
  it("formats numbers", () => {
    expect(fmt(155.25, true)).toBe("155.25");
    expect(fmt(3)).toBe("3");
    expect(fmt(1 / 3)).toBe("0.3333");
  });
});
