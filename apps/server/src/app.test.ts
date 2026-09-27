// Server API: local-only access (T11), traversal-safe artifacts (T8), the one-scan lock, the password kept
// out of config and responses (T5), SSE for live and finished runs, plan review, cancel, suppressions.
// The engine is replaced by a scripted runner: no browser, no LLM.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRunStore, type RunResult, type ScanConfig, type RunScanDeps } from "@witness/engine";
import { createApp } from "./app";
import { ScanManager, type ScanRunner } from "./scans";

const PAST = "run_20260927-120000_abcd";
let dir: string;
let store: JsonRunStore;
let server: http.Server;
let base: string;
let runner: ScanRunner;
let n = 0;

function result(
  runId: string,
  config: Partial<ScanConfig> = {},
  extra: Partial<RunResult> = {},
): RunResult {
  return {
    runId,
    config: {
      url: "http://localhost:5180/",
      mode: "staging",
      budget: "quick",
      pipeline: "full",
      llmCache: "off",
      viewport: { width: 1280, height: 800 },
      mobileViewport: { width: 375, height: 667 },
      ...config,
    },
    scope: "http://localhost:5180",
    startedAt: "2026-09-27T12:00:00.000Z",
    finishedAt: "2026-09-27T12:05:00.000Z",
    verdict: { level: "not_ready", reason: "One high-severity bug." },
    notTested: [],
    findings: [
      {
        id: "fd_abc123",
        fingerprint: "fp_0123456789abcdef",
        kind: "bug",
        tier: "confirmed",
        tierReason: "Reproduced.",
        severity: "high",
        category: "functional",
        source: { kind: "detector", id: "DET-HTTP5XX" },
        route: "/",
        title: "Crash",
        impact: "It breaks.",
        whyFlagged: "DET-HTTP5XX",
        steps: ["Go to /"],
        expected: "Works",
        actual: "500",
        evidenceIds: ["ev_shot1"],
        instances: [],
        candidateIds: [],
        replay: { attempts: 2, reproduced: 2 },
        signals: {},
        testFile: "fd_abc123.spec.ts",
      },
    ],
    journeys: [],
    states: [],
    stats: {
      pages: 1,
      steps: 0,
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      candidates: 1,
      discarded: 0,
      durationMs: 300_000,
      capsHit: [],
    },
    ...extra,
  };
}

function request(
  method: string,
  p: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
  const url = new URL(p, base);
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(data ? { "content-type": "application/json" } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const json = (r: { text: string }) => JSON.parse(r.text) as Record<string, unknown>;

/** Reads an SSE stream to its end; returns the data events and the named events. */
function sse(p: string, until?: (events: unknown[]) => boolean, onEvent?: (e: unknown) => void) {
  return new Promise<{ data: unknown[]; named: string[] }>((resolve, reject) => {
    const data: unknown[] = [];
    const named: string[] = [];
    const req = http.get(new URL(p, base), (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const d = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) named.push(ev);
          else if (d) {
            const parsed = JSON.parse(d) as unknown;
            data.push(parsed);
            onEvent?.(parsed);
          }
          if (until?.(data)) {
            req.destroy();
            resolve({ data, named });
          }
        }
      });
      res.on("end", () => resolve({ data, named }));
    });
    req.on("error", (e) => (until ? resolve({ data, named }) : reject(e)));
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "witness-server-"));
  store = new JsonRunStore({ runsDir: path.join(dir, "runs"), dataDir: path.join(dir, "data") });
  // A finished past run on disk, with an artifact, a screenshot evidence record, a test and events.
  await store.createRun(PAST, {
    url: "http://localhost:5180/",
    startedAt: "2026-09-27T12:00:00.000Z",
  });
  await store.putArtifact(PAST, "ev_shot1.jpg", Buffer.from([0xff, 0xd8, 0xff]));
  await store.putEvidence(PAST, {
    id: "ev_shot1",
    kind: "screenshot",
    createdAt: "2026-09-27T12:01:00.000Z",
    path: "artifacts/ev_shot1.jpg",
    data: {},
  });
  await store.appendEvent(PAST, { t: "phase", phase: "map", at: "2026-09-27T12:00:01.000Z" });
  await store.appendEvent(PAST, { t: "done", verdict: { level: "not_ready", reason: "x" } });
  await store.saveResult(result(PAST));
  await mkdir(path.join(store.runDir(PAST), "tests"), { recursive: true });
  await writeFile(
    path.join(store.runDir(PAST), "tests", "fd_abc123.spec.ts"),
    "test('x', () => {});",
  );
  await writeFile(path.join(dir, "secret.txt"), "TOP SECRET");
  // Two evaluation summaries; the newer one is "latest".
  await mkdir(path.join(dir, "eval", "a"), { recursive: true });
  await mkdir(path.join(dir, "eval", "b"), { recursive: true });
  await writeFile(
    path.join(dir, "eval", "a", "summary.json"),
    JSON.stringify({ generatedAt: "2026-09-26T00:00:00Z" }),
  );
  await writeFile(
    path.join(dir, "eval", "b", "summary.json"),
    JSON.stringify({ generatedAt: "2026-09-27T00:00:00Z" }),
  );

  const scans = new ScanManager({
    store,
    runner: (config, deps) => runner(config, deps),
    models: () => ({ unavailable: "no key in tests" }),
    llmCacheDir: path.join(dir, "cache"),
    newRunId: () => `run_20260928-10000${n++}_test`,
  });
  const app = createApp({ store, scans, evalDir: path.join(dir, "eval") });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("local only (T11)", () => {
  it("refuses requests addressed to another host name (DNS rebinding)", async () => {
    const r = await request("GET", "/api/scans", undefined, { host: "evil.example" });
    expect(r.status).toBe(403);
  });
  it("refuses writes from another site's pages", async () => {
    const r = await request(
      "POST",
      "/api/scans",
      { url: "http://localhost:1/" },
      {
        origin: "https://evil.example",
      },
    );
    expect(r.status).toBe(403);
  });
  it("sends no CORS headers and always nosniff", async () => {
    const r = await request("GET", "/api/scans", undefined, { origin: "https://evil.example" });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("artifacts (T8)", () => {
  it("serves a run's screenshot with its content type", async () => {
    const r = await request("GET", `/api/scans/${PAST}/artifacts/ev_shot1.jpg`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
  });
  it.each([
    `/api/scans/${PAST}/artifacts/..%2F..%2F..%2Fsecret.txt`,
    `/api/scans/${PAST}/artifacts/%2e%2e%2frun.json`,
    `/api/scans/${PAST}/artifacts/run.json`,
    `/api/scans/..%2F..%2Fsecret.txt/artifacts/ev_shot1.jpg`,
    `/api/scans/not-a-run/artifacts/ev_shot1.jpg`,
  ])("rejects %s with 400", async (p) => {
    const r = await request("GET", p);
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("TOP SECRET");
  });
  it("a finding's screenshot and its regression test", async () => {
    expect((await request("GET", `/api/scans/${PAST}/findings/fd_abc123/screenshot`)).status).toBe(
      200,
    );
    const t = await request("GET", `/api/scans/${PAST}/findings/fd_abc123/test`);
    expect(t.status).toBe(200);
    expect(t.headers["content-disposition"]).toContain("fd_abc123.spec.ts");
  });
});

describe("history and reports", () => {
  it("lists past runs, none of them live", async () => {
    const r = json(await request("GET", "/api/scans"));
    const runs = r.runs as { runId: string; live: boolean; budget: string }[];
    expect(runs.find((x) => x.runId === PAST)).toMatchObject({ live: false, budget: "quick" });
  });
  it("exports the report as a download", async () => {
    const r = await request("GET", `/api/scans/${PAST}/export?format=html`);
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.text).toContain("Verdict: Not ready");
  });
  it("streams a finished run's recorded events and says it isn't live", async () => {
    const s = await sse(`/api/scans/${PAST}/events`);
    expect(s.named).toEqual(["hello", "end"]);
    expect((s.data as { t: string }[]).map((e) => e.t)).toEqual(["phase", "done"]);
  });
  it("the latest evaluation summary is the newest by generatedAt", async () => {
    const r = json(await request("GET", "/api/eval/latest"));
    expect(r.path).toBe("b/summary.json");
    expect((r.available as unknown[]).length).toBe(2);
    expect((await request("GET", "/api/eval/latest?path=../secret.txt")).status).toBe(404);
  });
});

describe("scans", () => {
  it("keeps the password in the vault only, runs one scan at a time, and streams it live", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let seen: { config: string; password: string } | undefined;
    runner = async (config: ScanConfig, deps: RunScanDeps) => {
      seen = { config: JSON.stringify(config), password: deps.vault.get("password") };
      await deps.store.createRun(deps.runId!, {
        url: config.url,
        startedAt: new Date().toISOString(),
      });
      deps.sink?.({ t: "phase", phase: "map", at: new Date().toISOString() });
      await gate;
      deps.sink?.({ t: "phase", phase: "done", at: new Date().toISOString() });
      const r = result(deps.runId!, config);
      await deps.store.saveResult(r);
      return r;
    };
    const start = await request("POST", "/api/scans", {
      url: "http://localhost:5180",
      mode: "staging",
      budget: "quick",
      username: "ada@example.test",
      password: "hunter2-not-in-files",
    });
    expect(start.status).toBe(201);
    const { runId } = json(start) as { runId: string };
    expect(start.text).not.toContain("hunter2");

    const busy = await request("POST", "/api/scans", { url: "http://localhost:5180" });
    expect(busy.status).toBe(409);
    expect(json(busy).runId).toBe(runId);

    const listed = json(await request("GET", "/api/scans"));
    expect((listed.live as { runId: string }).runId).toBe(runId);

    const stream = sse(`/api/scans/${runId}/events`, undefined, (e) => {
      if ((e as { t: string }).t === "phase") release();
    });
    const s = await stream;
    expect(s.named[0]).toBe("hello");
    expect(s.named.at(-1)).toBe("end");
    expect((s.data as { t: string; phase?: string }[]).map((e) => e.phase)).toEqual([
      "map",
      "done",
    ]);

    expect(seen?.password).toBe("hunter2-not-in-files");
    expect(seen?.config).not.toContain("hunter2");
    // Nothing the run wrote holds the password.
    for (const f of ["run.json", "events.ndjson", "report.html", "report.md", "report.json"]) {
      const file = path.join(store.runDir(runId), f);
      if (existsSync(file)) expect(await readFile(file, "utf8")).not.toContain("hunter2");
    }
    expect((await request("GET", "/api/scans")).text).not.toContain("hunter2");
  });

  it("relays the plan review and cancel to the engine", async () => {
    let approved: string[] | undefined | "pending" = "pending";
    runner = async (config, deps) => {
      await deps.store.createRun(deps.runId!, {
        url: config.url,
        startedAt: new Date().toISOString(),
      });
      approved = await deps.approvePlan!([], 10_000);
      await new Promise<void>((r) => deps.signal!.addEventListener("abort", () => r()));
      const r = result(deps.runId!, config, { cancelled: true, error: "Cancelled by you." });
      await deps.store.saveResult(r);
      return r;
    };
    const { runId } = json(
      await request("POST", "/api/scans", { url: "http://localhost:5180" }),
    ) as {
      runId: string;
    };
    await new Promise((r) => setTimeout(r, 50));
    const ok = await request("POST", `/api/scans/${runId}/plan`, {
      approvedJourneyIds: ["jr_abc"],
    });
    expect(ok.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(approved).toEqual(["jr_abc"]);
    expect(
      (await request("POST", `/api/scans/${runId}/plan`, { approvedJourneyIds: [] })).status,
    ).toBe(409);
    expect((await request("POST", `/api/scans/${runId}/cancel`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(json(await request("GET", "/api/scans")).live).toBeNull();
    expect(json(await request("GET", `/api/scans/${runId}`)).cancelled).toBe(true);
  });

  it("asks for confirmation before staging mode on a non-local host (FR-1)", async () => {
    runner = async () => {
      throw new Error("must not start");
    };
    const r = await request("POST", "/api/scans", {
      url: "https://shop.example.com",
      mode: "staging",
    });
    expect(r.status).toBe(400);
    expect(json(r).error).toContain("Confirm");
  });
});

describe("Not a bug (FR-12)", () => {
  it("writes the suppression for the app's origin, once", async () => {
    const body = {
      origin: "http://localhost:5180/some/page",
      fingerprint: "fp_0123456789abcdef",
      reason: "By design",
    };
    expect((await request("POST", "/api/suppressions", body)).status).toBe(201);
    expect((await request("POST", "/api/suppressions", body)).status).toBe(201);
    const saved = JSON.parse(
      await readFile(path.join(dir, "data", "suppressions.json"), "utf8"),
    ) as unknown[];
    expect(saved).toEqual([
      expect.objectContaining({ origin: "http://localhost:5180", reason: "By design" }),
    ]);
  });
  it("rejects a malformed fingerprint", async () => {
    const r = await request("POST", "/api/suppressions", {
      origin: "http://localhost:5180",
      fingerprint: "../x",
      reason: "nope",
    });
    expect(r.status).toBe(400);
  });
});
