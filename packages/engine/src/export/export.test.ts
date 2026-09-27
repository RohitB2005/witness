// Test exporter (SPEC FR-11, SECURITY T14 `export/secrets.test.ts` equivalent): exported specs contain
// environment lookups, never secret values; and a generated spec really runs — it fails while the bug is
// on and passes once it's off (the E3 property, on a fixture).
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Finding, Journey, RunResult, Step } from "../types";
import {
  page,
  startFixtureServer,
  type FixtureRoute,
  type FixtureServer,
} from "../../test/fixture-server";
import { exportTests, valueCode } from "./playwright";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = path.join(REPO, ".witness-export-test", `run_${process.pid}`);
const PASSWORD = "Fixture-pass-9!";

let site: FixtureServer;
let bug = true;

beforeAll(async () => {
  site = await startFixtureServer({
    "/login": {
      body: page(
        `<form method="post" action="/session"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Log in</button></form>`,
      ),
    },
    "POST /session": (req): FixtureRoute =>
      new URLSearchParams((req as { body?: string }).body ?? "").get("password") === PASSWORD
        ? { status: 303, headers: { location: "/quote", "set-cookie": "s=1; Path=/" } }
        : { status: 303, headers: { location: "/login" } },
    "/quote": (req) =>
      /s=1/.test(req.headers.cookie ?? "")
        ? {
            body: page(
              `<dl><dt>Subtotal</dt><dd data-testid="sub">$100.00</dd><dt>Tax</dt><dd data-testid="tax">$15.00</dd><dt>Total</dt><dd data-testid="total">${bug ? "$132.25" : "$115.00"}</dd></dl><button>Log out</button>`,
            ),
          }
        : { status: 302, headers: { location: "/login" } },
  });
});
afterAll(async () => {
  await site.close();
  await rm(OUT, { recursive: true, force: true });
});

const step = (id: string, action: Step["action"], description: string): Step => ({
  id,
  journeyId: "jr_1",
  index: 0,
  kind: "happy",
  action,
  description,
  beforeEvidenceIds: [],
  afterEvidenceIds: [],
  urlBefore: "",
  urlAfter: "",
  ok: true,
});

function run(): RunResult {
  const steps = [
    step("sp_1", { type: "goto", path: "/quote" }, "Go to /quote"),
    step(
      "sp_2",
      { type: "fill", target: { by: "label", text: "Note" }, value: "pw is {{secret:password}}" },
      "Type into Note",
    ),
  ];
  const journey = { id: "jr_1", title: "Quote", steps } as unknown as Journey;
  const finding = {
    id: "fd_total",
    fingerprint: "fp_1111111111111111",
    kind: "bug",
    tier: "confirmed",
    severity: "high",
    title: "The total doesn't add up",
    source: { kind: "detector", id: "DET-TOTALS" },
    signals: {},
    repro: {
      session: "authenticated",
      viewport: "desktop",
      url: site.url("/quote"),
      stepIds: ["sp_1"],
      signature: { kind: "detector", detectorId: "DET-TOTALS", key: "k" },
      check: {
        type: "numericRelation",
        left: { read: { by: "testId", id: "total" } },
        op: "eq",
        right: {
          op: "add",
          a: { read: { by: "testId", id: "sub" } },
          b: { read: { by: "testId", id: "tax" } },
        },
        tolerance: 0.01,
      },
    },
  } as unknown as Finding;
  const flag = {
    ...finding,
    id: "fd_flag",
    tier: "likely",
    source: { kind: "judgement", confidence: 0.8 },
  } as Finding;
  return {
    scope: site.origin,
    loginPath: "/login",
    journeys: [journey],
    findings: [finding, flag],
  } as unknown as RunResult;
}

describe("exportTests", () => {
  it("login details become environment lookups, never values (T14)", () => {
    expect(valueCode("{{secret:password}}")).toBe('secret("password")');
    expect(valueCode("pw is {{secret:password}}")).toBe('"pw is " + secret("password")');
    const out = exportTests(run());
    const all = out.files.map((f) => f.content).join("\n");
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("{{secret:");
    expect(all).toContain("process.env.WITNESS_TEST_PASSWORD");
    expect(out.skipped).toEqual([
      { findingId: "fd_flag", reason: "a judgement has no deterministic assertion" },
    ]);
    expect([...out.tests.values()]).toEqual(["fd_total.spec.ts"]);
  });

  it("a requirement missing from the app is never exported (an absence has nothing to assert)", () => {
    const r = run();
    const missing = {
      ...r.findings[0]!,
      id: "fd_missing",
      tier: "likely",
      source: { kind: "requirement", id: "REQ-NOTFOUND", criterionId: "AC9" },
      repro: {
        session: "authenticated",
        viewport: "desktop",
        url: site.url("/"),
        stepIds: [],
        signature: { kind: "requirement", criterionId: "AC9" },
      },
    } as Finding;
    const out = exportTests({ ...r, findings: [missing] });
    expect(out.tests.size).toBe(0);
    expect(out.skipped[0]!.reason).toMatch(/missing from the app/);
  });

  it(
    "the generated spec fails while the bug exists and passes once it's fixed",
    { timeout: 120_000 },
    async () => {
      const out = exportTests(run());
      await mkdir(OUT, { recursive: true });
      for (const f of out.files) await writeFile(path.join(OUT, f.name), f.content);
      const cli = path.join(
        REPO,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "playwright.cmd" : "playwright",
      );
      // Async: the fixture server lives in this process and must keep answering while the spec runs.
      const runSpec = () =>
        new Promise<{ status: number | null; output: string }>((resolve) => {
          const child = spawn(cli, ["test", "-c", OUT], {
            cwd: REPO,
            env: {
              ...process.env,
              WITNESS_BASE_URL: site.origin,
              WITNESS_TEST_USER: "ada@example.test",
              WITNESS_TEST_PASSWORD: PASSWORD,
            },
          });
          let output = "";
          child.stdout.on("data", (d: Buffer) => (output += d.toString()));
          child.stderr.on("data", (d: Buffer) => (output += d.toString()));
          child.on("close", (status) => resolve({ status, output }));
        });
      bug = true;
      const failing = await runSpec();
      expect(failing.status, failing.output).toBe(1);
      bug = false;
      const passing = await runSpec();
      expect(passing.status, passing.output).toBe(0);
    },
  );
});
