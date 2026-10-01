// Demo settings (`pnpm demo:up` only): loaded from .env and the requirements file, offered to the
// dashboard without the password, and the password used only inside the scan's vault (SECURITY T5).
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRunStore, type RunResult, type ScanConfig } from "@witness/engine";
import { createApp } from "./app";
import { loadDemoSettings, type DemoSettings } from "./demo";
import { ScanManager, type ScanRunner } from "./scans";

const PASSWORD = "Demo-pw-never-in-files";
let dir: string;
let scope: string;
const servers: http.Server[] = [];

async function serve(demo: DemoSettings | undefined, runner: ScanRunner, store: JsonRunStore) {
  let n = 0;
  const scans = new ScanManager({
    store,
    runner,
    demo,
    models: () => ({ unavailable: "no key in tests" }),
    llmCacheDir: path.join(dir, "cache"),
    newRunId: () => `run_20261002-10000${n++}_${demo ? "demo" : "plain"}`,
  });
  const server = createApp({ store, scans, evalDir: path.join(dir, "eval"), demo }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "witness-demo-"));
  scope = path.join(dir, "SCOPE.md");
  await writeFile(scope, "## Acceptance criteria\n\n1. Customers can book a clean.\n");
});
afterAll(async () => {
  for (const s of servers) s.close();
  await rm(dir, { recursive: true, force: true });
});

describe("loadDemoSettings", () => {
  const env = { WITNESS_TEST_USER: "demo@example.test", WITNESS_TEST_PASSWORD: PASSWORD };

  it("uses the bench URL, Staging, the Demo budget, .env's account and the requirements file", () => {
    expect(
      loadDemoSettings({ url: "http://localhost:5180", env, requirementsFile: scope }),
    ).toEqual({
      url: "http://localhost:5180",
      mode: "staging",
      budget: "demo",
      account: { username: "demo@example.test", password: PASSWORD },
      requirements: { file: "SCOPE.md", text: expect.stringContaining("book a clean") },
    });
  });

  it("leaves out an incomplete account or a missing file, and says so", () => {
    const warnings: string[] = [];
    const d = loadDemoSettings({
      url: "http://localhost:5180",
      env: { WITNESS_TEST_USER: "demo@example.test" },
      requirementsFile: path.join(dir, "missing.md"),
      warn: (m) => warnings.push(m),
    });
    expect(d.account).toBeUndefined();
    expect(d.requirements).toBeUndefined();
    expect(warnings).toHaveLength(2);
  });
});

describe("demo settings over the API", () => {
  let demoBase: string;
  let plainBase: string;
  let store: JsonRunStore;
  let seen: { config: ScanConfig; password: string } | undefined;

  beforeAll(async () => {
    store = new JsonRunStore({ runsDir: path.join(dir, "runs"), dataDir: path.join(dir, "data") });
    const runner: ScanRunner = async (config, deps) => {
      seen = { config, password: deps.vault.get("password") };
      await deps.store.createRun(deps.runId!, {
        url: config.url,
        startedAt: new Date().toISOString(),
      });
      deps.sink?.({ t: "phase", phase: "done", at: new Date().toISOString() });
      const r = {
        runId: deps.runId!,
        config,
        scope: "http://localhost:5180",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        verdict: { level: "ready", reason: "Nothing found." },
        notTested: [],
        findings: [],
        journeys: [],
        states: [],
        stats: {
          pages: 1,
          steps: 0,
          llmCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          candidates: 0,
          discarded: 0,
          durationMs: 1,
          capsHit: [],
        },
      } as RunResult;
      await deps.store.saveResult(r);
      return r;
    };
    const demo = loadDemoSettings({
      url: "http://localhost:5180",
      env: { WITNESS_TEST_USER: "demo@example.test", WITNESS_TEST_PASSWORD: PASSWORD },
      requirementsFile: scope,
    });
    demoBase = await serve(demo, runner, store);
    plainBase = await serve(undefined, runner, store);
  });

  it("pnpm dev (no --demo) offers no demo settings and refuses the demo account", async () => {
    expect((await fetch(`${plainBase}/api/demo`)).status).toBe(404);
    const r = await post(plainBase, { url: "http://localhost:5180", useDemoAccount: true });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("pnpm demo:up");
  });

  it("offers the demo settings without the password", async () => {
    const r = await fetch(`${demoBase}/api/demo`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(PASSWORD);
    expect(JSON.parse(text)).toEqual({
      url: "http://localhost:5180",
      mode: "staging",
      budget: "demo",
      account: { username: "demo@example.test" },
      requirements: { file: "SCOPE.md", text: expect.stringContaining("book a clean") },
    });
  });

  it("refuses the demo account together with a typed one", async () => {
    const r = await post(demoBase, {
      url: "http://localhost:5180",
      useDemoAccount: true,
      username: "other@example.test",
      password: "x",
    });
    expect(r.status).toBe(400);
  });

  it("logs in with the demo account from the server, keeping the password out of the run", async () => {
    const r = await post(demoBase, {
      url: "http://localhost:5180",
      mode: "staging",
      budget: "demo",
      useDemoAccount: true,
    });
    expect(r.status).toBe(201);
    const { runId } = (await r.json()) as { runId: string };
    for (let i = 0; i < 50 && !(await fetch(`${demoBase}/api/scans/${runId}`)).ok; i++)
      await new Promise((res) => setTimeout(res, 20));

    expect(seen?.password).toBe(PASSWORD);
    expect(seen?.config.credentials).toEqual({
      username: "demo@example.test",
      passwordRef: "password",
    });
    expect(JSON.stringify(seen?.config)).not.toContain(PASSWORD);
    const runDir = store.runDir(runId);
    for (const f of await readdir(runDir))
      if (f.includes("."))
        expect(await readFile(path.join(runDir, f), "utf8"), f).not.toContain(PASSWORD);
    expect(await (await fetch(`${demoBase}/api/scans`)).text()).not.toContain(PASSWORD);
  });
});
