import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecretVault } from "../browser/vault";
import { newRunId } from "../ids";
import { JsonRunStore } from "./json-store";

let dir: string;
let vault: SecretVault;
let store: JsonRunStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "witness-store-"));
  vault = new SecretVault();
  vault.set("password", "Hunter2!secret");
  store = new JsonRunStore({ runsDir: path.join(dir, "runs"), redact: (t) => vault.redact(t) });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("JsonRunStore", () => {
  it("round-trips evidence and events in order", async () => {
    const runId = newRunId();
    await store.createRun(runId, { url: "http://a.test", startedAt: "now" });
    for (let i = 0; i < 20; i++)
      await store.appendEvent(runId, { t: "log", level: "info", message: `m${i}` });
    await store.putEvidence(runId, {
      id: "ev_1",
      kind: "console",
      createdAt: "now",
      data: { entries: [] },
    });
    expect(await store.hasEvidence(runId, "ev_1")).toBe(true);
    expect(await store.hasEvidence(runId, "ev_nope")).toBe(false);
    const lines = (await readFile(path.join(store.runDir(runId), "events.ndjson"), "utf8"))
      .trim()
      .split("\n");
    expect(lines.map((l) => (JSON.parse(l) as { message: string }).message)).toEqual(
      Array.from({ length: 20 }, (_, i) => `m${i}`),
    );
    // A fresh store (another process) reads evidence back from disk.
    const reader = new JsonRunStore({ runsDir: path.join(dir, "runs") });
    expect((await reader.getEvidence(runId, "ev_1"))?.kind).toBe("console");
  });

  it("redacts vault secrets from everything it writes (T5)", async () => {
    const runId = newRunId();
    await store.createRun(runId, { url: "http://a.test", startedAt: "now" });
    await store.appendEvent(runId, {
      t: "log",
      level: "info",
      message: "typed Hunter2!secret into Password",
    });
    await store.putEvidence(runId, {
      id: "ev_2",
      kind: "network",
      createdAt: "now",
      data: { url: `http://a.test/x?p=${encodeURIComponent("Hunter2!secret")}` },
    });
    await store.putArtifact(runId, "snap.yaml", '- textbox "Password": Hunter2!secret');
    const files = ["events.ndjson", "evidence.ndjson", "artifacts/snap.yaml"];
    for (const f of files) {
      const text = await readFile(path.join(store.runDir(runId), f), "utf8");
      expect(text, f).not.toContain("Hunter2");
      expect(text, f).toContain("[redacted]");
    }
  });

  it("rejects invalid run ids and artifact names (path traversal)", async () => {
    expect(() => store.runDir("../../etc")).toThrow();
    const runId = newRunId();
    await store.createRun(runId, { url: "http://a.test", startedAt: "now" });
    await expect(store.putArtifact(runId, "../../escape.txt", "x")).rejects.toThrow();
  });
});

describe("SecretVault", () => {
  it("resolves placeholders at typing time and throws on unknown names", () => {
    expect(vault.resolve("{{secret:password}}")).toBe("Hunter2!secret");
    expect(() => vault.resolve("{{secret:nope}}")).toThrow(/Unknown secret/);
    expect(vault.leaks("xx Hunter2!secret xx")).toBe(true);
    expect(vault.leaks("{{secret:password}}")).toBe(false);
  });
});
