// JSON-on-disk RunStore. Layout: runs/<runId>/{run.json, events.ndjson, evidence.ndjson, artifacts/}.
// Every text write passes through `redact` so a secret can't reach disk even if a caller slips (T5).
import { mkdir, readdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WitnessEvent } from "../events";
import { RUN_ID_PATTERN } from "../ids";
import { EvidenceSchema, RunResultSchema, type Evidence, type RunResult } from "../types";
import type { RunStore, RunSummary, Suppression } from "./run-store";
import { redactSecrets } from "../detectors/secrets";

const ARTIFACT_NAME = /^[a-zA-Z0-9_.-]+$/;

export interface JsonRunStoreOptions {
  runsDir: string;
  /** Where suppressions.json lives (default: <runsDir>/../data). */
  dataDir?: string;
  redact?: (text: string) => string;
}

export class JsonRunStore implements RunStore {
  readonly #runsDir: string;
  readonly #dataDir: string;
  readonly #redact: (text: string) => string;
  /** Per-file write queues keep ndjson lines in emit order. */
  readonly #queues = new Map<string, Promise<void>>();
  readonly #evidence = new Map<string, Map<string, Evidence>>();

  constructor(opts: JsonRunStoreOptions) {
    this.#runsDir = path.resolve(opts.runsDir);
    this.#dataDir = path.resolve(opts.dataDir ?? path.join(this.#runsDir, "..", "data"));
    // Detected secret keys are redacted on every write, whatever the caller passes (ADDENDUM A1).
    const redact = opts.redact ?? ((t: string) => t);
    this.#redact = (t) => redactSecrets(redact(t));
  }

  runDir(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    return path.join(this.#runsDir, runId);
  }

  async createRun(runId: string, meta: { url: string; startedAt: string }): Promise<void> {
    const dir = this.runDir(runId);
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await writeFile(path.join(dir, "meta.json"), this.#redact(JSON.stringify(meta, null, 2)));
    this.#evidence.set(runId, new Map());
  }

  appendEvent(runId: string, event: WitnessEvent): Promise<void> {
    return this.#append(path.join(this.runDir(runId), "events.ndjson"), JSON.stringify(event));
  }

  appendLlmCall(runId: string, entry: Record<string, unknown>): Promise<void> {
    return this.#append(path.join(this.runDir(runId), "llm-calls.ndjson"), JSON.stringify(entry));
  }

  async putEvidence(runId: string, evidence: Evidence): Promise<void> {
    const valid = EvidenceSchema.parse(evidence);
    this.#evidenceFor(runId).set(valid.id, valid);
    await this.#append(path.join(this.runDir(runId), "evidence.ndjson"), JSON.stringify(valid));
  }

  async getEvidence(runId: string, evidenceId: string): Promise<Evidence | undefined> {
    const cached = this.#evidence.get(runId);
    if (cached?.size) return cached.get(evidenceId);
    await this.#loadEvidence(runId);
    return this.#evidence.get(runId)?.get(evidenceId);
  }

  async hasEvidence(runId: string, evidenceId: string): Promise<boolean> {
    return (await this.getEvidence(runId, evidenceId)) !== undefined;
  }

  async putArtifact(runId: string, name: string, data: Buffer | string): Promise<string> {
    if (!ARTIFACT_NAME.test(name)) throw new Error(`Invalid artifact name: ${name}`);
    const rel = path.posix.join("artifacts", name);
    await writeFile(
      path.join(this.runDir(runId), rel),
      typeof data === "string" ? this.#redact(data) : data,
    );
    return rel;
  }

  async saveResult(result: RunResult): Promise<void> {
    const valid = RunResultSchema.parse(result);
    await this.#flush();
    await writeFile(
      path.join(this.runDir(valid.runId), "run.json"),
      this.#redact(JSON.stringify(valid, null, 2)),
    );
  }

  async getResult(runId: string): Promise<RunResult | undefined> {
    const file = path.join(this.runDir(runId), "run.json");
    if (!existsSync(file)) return undefined;
    return RunResultSchema.parse(JSON.parse(await readFile(file, "utf8")));
  }

  async listRuns(): Promise<RunSummary[]> {
    if (!existsSync(this.#runsDir)) return [];
    const ids = (await readdir(this.#runsDir)).filter((d) => RUN_ID_PATTERN.test(d));
    const out: RunSummary[] = [];
    for (const runId of ids.sort().reverse()) {
      const dir = this.runDir(runId);
      const result = await this.getResult(runId).catch(() => undefined);
      if (result) {
        out.push({
          runId,
          url: result.config.url,
          startedAt: result.startedAt,
          verdict: result.verdict,
          findings: result.findings.length,
        });
      } else if (existsSync(path.join(dir, "meta.json"))) {
        const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as {
          url: string;
          startedAt: string;
        };
        out.push({ runId, url: meta.url, startedAt: meta.startedAt });
      }
    }
    return out;
  }

  async getSuppressions(origin?: string): Promise<Suppression[]> {
    const file = path.join(this.#dataDir, "suppressions.json");
    if (!existsSync(file)) return [];
    const all = JSON.parse(await readFile(file, "utf8")) as Suppression[];
    return origin ? all.filter((s) => s.origin === origin) : all;
  }

  async addSuppression(s: Suppression): Promise<void> {
    const all = await this.getSuppressions();
    all.push(s);
    await mkdir(this.#dataDir, { recursive: true });
    await writeFile(
      path.join(this.#dataDir, "suppressions.json"),
      this.#redact(JSON.stringify(all, null, 2)),
    );
  }

  #evidenceFor(runId: string): Map<string, Evidence> {
    let m = this.#evidence.get(runId);
    if (!m) this.#evidence.set(runId, (m = new Map()));
    return m;
  }

  async #loadEvidence(runId: string): Promise<void> {
    const file = path.join(this.runDir(runId), "evidence.ndjson");
    const m = this.#evidenceFor(runId);
    if (!existsSync(file)) return;
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const ev = EvidenceSchema.parse(JSON.parse(line));
      m.set(ev.id, ev);
    }
  }

  #append(file: string, line: string): Promise<void> {
    const prev = this.#queues.get(file) ?? Promise.resolve();
    const next = prev.then(() => appendFile(file, this.#redact(line) + "\n"));
    this.#queues.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  }

  async #flush(): Promise<void> {
    await Promise.all(this.#queues.values());
  }
}
