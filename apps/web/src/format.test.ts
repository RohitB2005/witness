// The "Copy test command" text must be a command pnpm demo:test accepts from the repo root.
import { describe, expect, it } from "vitest";
import { testCommand } from "./format";

describe("testCommand", () => {
  it("points demo:test at the run's exported spec, relative to the repo root", () => {
    expect(testCommand("run_abc123", "fd_x1y2z3.spec.ts")).toBe(
      "pnpm demo:test runs/run_abc123/tests/fd_x1y2z3.spec.ts",
    );
  });
});
