import { describe, expect, it } from "vitest";
import { BUG_IDS, getActiveBugs, isBugOn, parseBugList, setActiveBugs } from "./bugs";

describe("parseBugList", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["none", []],
    [" NONE ", []],
    ["B01", ["B01"]],
    ["b05, B01 ,c01", ["B01", "B05", "C01"]],
    ["B01,B01", ["B01"]],
  ])("parses %j", (raw, expected) => {
    expect(parseBugList(raw)).toEqual(expected);
  });

  it("expands 'all' to every flag including the canary", () => {
    expect(parseBugList("all")).toEqual([...BUG_IDS]);
    expect(parseBugList("ALL")).toHaveLength(24);
  });

  it("rejects unknown IDs instead of silently running clean", () => {
    expect(() => parseBugList("B01,B99")).toThrow(/B99/);
    expect(() => parseBugList("D01")).toThrow(/D01/);
  });
});

describe("active set", () => {
  it("reports exactly the flags that were set", () => {
    setActiveBugs(["B03", "C01"]);
    expect(isBugOn("B03")).toBe(true);
    expect(isBugOn("B04")).toBe(false);
    expect(getActiveBugs()).toEqual(["B03", "C01"]);
    setActiveBugs([]);
    expect(getActiveBugs()).toEqual([]);
  });
});
