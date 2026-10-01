import { describe, expect, it } from "vitest";
import { accountFields, demoForm } from "./demo";

describe("demo settings", () => {
  it("fills every field the demo needs", () => {
    expect(
      demoForm({
        url: "http://localhost:5180",
        mode: "staging",
        budget: "demo",
        account: { username: "demo@example.test" },
        requirements: { file: "SCOPE.md", text: "1. Customers can book." },
      }),
    ).toEqual({
      url: "http://localhost:5180",
      mode: "staging",
      budget: "demo",
      username: "demo@example.test",
      demoAccount: true,
      requirements: "1. Customers can book.",
      reqFile: "SCOPE.md",
    });
  });

  it("without a test account in .env, leaves the account empty", () => {
    const f = demoForm({ url: "http://localhost:5180", mode: "staging", budget: "demo" });
    expect(f).toMatchObject({ username: "", demoAccount: false, requirements: "" });
  });

  it("with the demo account, sends neither username nor password", () => {
    expect(accountFields("demo@example.test", "", true)).toEqual({ useDemoAccount: true });
    expect(accountFields(" ada@example.test ", "pw", false)).toEqual({
      username: "ada@example.test",
      password: "pw",
    });
    expect(accountFields("  ", "pw", false)).toEqual({});
  });
});
