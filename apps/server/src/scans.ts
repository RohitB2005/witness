// One scan at a time (ARCHITECTURE §7): starts the engine, keeps the live run's events in memory for the
// SSE stream, and relays plan approval and cancel. The server only orchestrates; the engine decides.
//
// The password arrives in the request body and goes straight into a SecretVault that lives only as long as
// the scan (SECURITY T5): it's never logged, stored or sent back.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  BUDGETS,
  BudgetPresetSchema,
  ConfigError,
  ScanModeSchema,
  SecretVault,
  defaultMode,
  parseTargetUrl,
  resolveScanConfig,
  writeRunExports,
  type Journey,
  type Models,
  type RunResult,
  type RunScanDeps,
  type RunStore,
  type ScanConfig,
  type WitnessEvent,
} from "@witness/engine";

/** The engine's entry point (injected so tests can use a scripted scan). */
export type ScanRunner = (config: ScanConfig, deps: RunScanDeps) => Promise<RunResult>;

export const NewScanSchema = z.strictObject({
  url: z.string().min(1).max(2000),
  mode: ScanModeSchema.optional(),
  budget: BudgetPresetSchema.optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  hint: z.string().max(200).optional(),
  requirements: z.string().max(5000).optional(),
  /** FR-1: staging mode on a non-local host must be confirmed by the person. */
  confirmStagingOnNonLocal: z.boolean().optional(),
  llmCache: z.enum(["off", "rw", "replay"]).optional(),
  /** Evaluation/ablation runs (FR-16); the form doesn't offer it. */
  pipeline: z.enum(["deterministic", "ai-no-verify", "full", "full-no-skeptic"]).optional(),
});
export type NewScan = z.infer<typeof NewScanSchema>;

export class BusyError extends Error {
  constructor(readonly runId: string) {
    super("A scan is already running. Wait for it to finish or cancel it.");
  }
}
export class InputError extends Error {}

export interface LiveInfo {
  runId: string;
  startedAt: string;
  url: string;
  budget: ScanConfig["budget"];
  mode: ScanConfig["mode"];
  /** "replay": AI answers come from the cache, not the AI (the live view says so). */
  llmCache: ScanConfig["llmCache"];
  /** The hard wall-clock cap (D78) and the AI spend cap, for the live view's meters. */
  capMs: number;
  costCapUsd: number;
}

interface LiveScan extends LiveInfo {
  events: WitnessEvent[];
  listeners: Set<(e: WitnessEvent | "end") => void>;
  controller: AbortController;
  /** Set while the plan is waiting for review. */
  approve?: (ids: string[] | undefined) => void;
  finished: boolean;
}

export interface ScanManagerOptions {
  store: RunStore;
  runner: ScanRunner;
  /** Created per scan, so a changed .env or a missing key is picked up without a restart. */
  models: () => { models?: Models; unavailable?: string; maxCostUsd?: number };
  llmCacheDir: string;
  newRunId: () => string;
}

export class ScanManager {
  #live?: LiveScan;

  constructor(private readonly o: ScanManagerOptions) {}

  /** The run in progress, if any (the only run the dashboard may call live). */
  get live(): LiveInfo | undefined {
    const l = this.#live;
    if (!l || l.finished) return undefined;
    const { runId, startedAt, url, budget, mode, llmCache, capMs, costCapUsd } = l;
    return { runId, startedAt, url, budget, mode, llmCache, capMs, costCapUsd };
  }

  isLive(runId: string): boolean {
    return this.live?.runId === runId;
  }

  start(input: NewScan): { runId: string } {
    if (this.live) throw new BusyError(this.live.runId);
    let config: ScanConfig;
    const vault = new SecretVault();
    try {
      if (input.mode === "staging" && !input.confirmStagingOnNonLocal) {
        if (defaultMode(parseTargetUrl(input.url)) === "production")
          throw new InputError(
            "Staging mode lets Witness submit forms on this site, and it isn't a local address. Confirm that it's a test copy you may change, or use Production (read-only).",
          );
      }
      if ((input.username && !input.password) || (!input.username && input.password))
        throw new InputError("Give both a username and a password, or neither.");
      if (input.password) vault.set("password", input.password);
      config = resolveScanConfig({
        url: input.url,
        mode: input.mode,
        budget: input.budget,
        credentials: input.username
          ? { username: input.username, passwordRef: "password" }
          : undefined,
        hint: input.hint?.trim() || undefined,
        requirements: input.requirements?.trim() || undefined,
        llmCache: input.llmCache,
        pipeline: input.pipeline,
      });
    } catch (err) {
      if (err instanceof InputError) throw err;
      if (err instanceof ConfigError) throw new InputError(err.message);
      throw err;
    }

    const runId = this.o.newRunId();
    const { models, unavailable, maxCostUsd } =
      config.pipeline === "deterministic" ? { models: undefined } : this.o.models();
    const live: LiveScan = {
      runId,
      startedAt: new Date().toISOString(),
      url: config.url,
      budget: config.budget,
      mode: config.mode,
      llmCache: config.llmCache,
      capMs: BUDGETS[config.budget].wallClockMs,
      costCapUsd: Math.min(BUDGETS[config.budget].llmUsd, maxCostUsd ?? Infinity),
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
      finished: false,
    };
    this.#live = live;
    const emit = (e: WitnessEvent | "end") => {
      if (e !== "end") live.events.push(e);
      for (const l of live.listeners) {
        try {
          l(e);
        } catch {
          // A broken stream must never stop a scan.
        }
      }
    };

    void (async () => {
      try {
        const result = await this.o.runner(config, {
          store: this.o.store,
          vault,
          runId,
          sink: emit,
          models,
          modelsUnavailable: unavailable,
          maxCostUsd,
          llmCacheDir: this.o.llmCacheDir,
          signal: live.controller.signal,
          approvePlan: (_journeys: Journey[], autoApproveInMs: number) =>
            new Promise<string[] | undefined>((resolve) => {
              const timer = setTimeout(() => done(undefined), autoApproveInMs);
              const done = (ids: string[] | undefined) => {
                clearTimeout(timer);
                live.approve = undefined;
                resolve(ids);
              };
              live.approve = done;
            }),
        });
        // Reports and regression tests, as the CLI writes them (FR-15: same findings either way).
        if (!result.cancelled)
          await writeRunExports(this.o.store, result, {
            formats: new Set(["md", "json", "html"]),
            redact: (t) => vault.redact(t),
          }).catch((err: unknown) =>
            emit({
              t: "log",
              level: "warn",
              message: `Writing the reports failed: ${String(err)}`,
            }),
          );
      } catch (err) {
        emit({ t: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        live.finished = true;
        vault.clear();
        emit("end");
        live.listeners.clear();
      }
    })();
    return { runId };
  }

  /** Approve some planned journeys (undefined: all). False if no plan is waiting for this run. */
  approve(runId: string, ids: string[] | undefined): boolean {
    const l = this.#live;
    if (!l || l.runId !== runId || l.finished || !l.approve) return false;
    l.approve(ids);
    return true;
  }

  cancel(runId: string): boolean {
    const l = this.#live;
    if (!l || l.runId !== runId || l.finished) return false;
    l.approve?.(undefined);
    l.controller.abort();
    return true;
  }

  /**
   * Streams a run's events: the live run's so far and then as they happen; a finished run's from disk
   * (ending at once). Returns an unsubscribe function, or undefined if there's no such run.
   */
  async subscribe(
    runId: string,
    listener: (e: WitnessEvent | "end") => void,
  ): Promise<(() => void) | undefined> {
    const l = this.#live;
    if (l && l.runId === runId) {
      for (const e of l.events) listener(e);
      if (l.finished) {
        listener("end");
        return () => {};
      }
      l.listeners.add(listener);
      return () => l.listeners.delete(listener);
    }
    const file = path.join(this.o.store.runDir(runId), "events.ndjson");
    if (!existsSync(file)) return undefined;
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        listener(JSON.parse(line) as WitnessEvent);
      } catch {
        // A torn last line (the run was killed mid-write) is skipped.
      }
    }
    listener("end");
    return () => {};
  }
}
