import { describe, expect, it } from "vitest";
import {
  AgentCheckSchema,
  CheckSchema,
  leafType,
  mapCheckLocators,
  type AgentCheck,
  type AgentLoc,
  type Locator,
} from "./language";

describe("check schema", () => {
  const total = { by: "text", text: "Total" } as const;
  it.each([
    ["visible", { type: "visible", target: { by: "role", role: "button", name: "Save" } }],
    [
      "numericRelation with nested ops",
      {
        type: "numericRelation",
        left: { read: total },
        op: "eq",
        right: { op: "mul", a: { read: { by: "label", text: "Subtotal" } }, b: { const: 1.1 } },
      },
    ],
    [
      "ordered",
      {
        type: "ordered",
        items: { by: "role", role: "listitem" },
        read: "number",
        direction: "asc",
      },
    ],
    [
      "capture text",
      { type: "capture", name: "phone", value: { text: { by: "label", text: "Phone" } } },
    ],
    [
      "equalsCaptured count",
      { type: "equalsCaptured", name: "n", value: { count: { by: "css", selector: "li" } } },
    ],
    [
      "fieldRejected with within/nth",
      {
        type: "fieldRejected",
        field: { by: "role", role: "textbox", within: { by: "role", role: "form" }, nth: 1 },
      },
    ],
    ["noNewErrors", { type: "noNewErrors" }],
    ["maxRequests", { type: "maxRequests", method: "POST", pathPattern: "^/api/items$", max: 1 }],
    [
      "all",
      { type: "all", checks: [{ type: "noNewErrors" }, { type: "urlMatches", pattern: "/done" }] },
    ],
  ])("accepts %s", (_n, input) => {
    expect(CheckSchema.safeParse(input).error).toBeUndefined();
  });

  it.each([
    ["unknown type", { type: "looksRight" }],
    ["bad regex", { type: "urlMatches", pattern: "(" }],
    ["extra field", { type: "noNewErrors", why: "x" }],
    ["unknown locator kind", { type: "visible", target: { by: "xpath", selector: "//a" } }],
    ["a ref in a stored check", { type: "visible", target: { ref: "e14" } }],
    ["empty all", { type: "all", checks: [] }],
    [
      "negative tolerance",
      { type: "equalsCaptured", name: "x", value: { const: 1 }, tolerance: -1 },
    ],
  ])("rejects %s", (_n, input) => {
    expect(CheckSchema.safeParse(input).success).toBe(false);
  });

  it("agent checks may use refs; stored checks may not", () => {
    const c = { type: "textMatches", target: { ref: "f1e32" }, pattern: "x" };
    expect(AgentCheckSchema.safeParse(c).success).toBe(true);
    expect(CheckSchema.safeParse(c).success).toBe(false);
  });

  it("finds the deciding leaf type", () => {
    expect(
      leafType({
        type: "all",
        checks: [{ type: "ordered", items: total, read: "text", direction: "asc" }],
      }),
    ).toBe("ordered");
    expect(leafType({ type: "noNewErrors" })).toBe("noNewErrors");
  });

  it("maps every locator (refs → stable locators) and keeps the rest", async () => {
    const agent: AgentCheck = {
      type: "all",
      checks: [
        { type: "capture", name: "n", value: { count: { ref: "e1" } } },
        {
          type: "numericRelation",
          left: { read: { ref: "e2" } },
          op: "eq",
          right: { op: "add", a: { read: { by: "label", text: "A" } }, b: { const: 2 } },
        },
        { type: "equalsCaptured", name: "t", value: { capturedText: "t" } },
        { type: "fieldRejected", field: { ref: "e3" } },
        { type: "urlMatches", pattern: "x" },
      ],
    };
    const seen: string[] = [];
    const out = await mapCheckLocators(agent, async (l: AgentLoc, use): Promise<Locator> => {
      if ("ref" in l) {
        seen.push(`${l.ref}:${use}`);
        return { by: "testId", id: l.ref };
      }
      return l;
    });
    expect(seen).toEqual(["e1:items", "e2:single", "e3:single"]);
    expect(CheckSchema.safeParse(out).error).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('"ref"');
  });
});
