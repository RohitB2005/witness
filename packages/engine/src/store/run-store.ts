// RunStore interface (ARCHITECTURE.md §4). Only the JSON implementation is built.
import type { WitnessEvent } from "../events";
import type { Evidence, RunResult } from "../types";

export interface Suppression {
  origin: string;
  fingerprint: string;
  reason: string;
  createdAt: string;
}

export interface RunSummary {
  runId: string;
  url: string;
  startedAt: string;
  verdict?: RunResult["verdict"];
  findings?: number;
}

export interface RunStore {
  createRun(runId: string, meta: { url: string; startedAt: string }): Promise<void>;
  appendEvent(runId: string, event: WitnessEvent): Promise<void>;
  putEvidence(runId: string, evidence: Evidence): Promise<void>;
  getEvidence(runId: string, evidenceId: string): Promise<Evidence | undefined>;
  hasEvidence(runId: string, evidenceId: string): Promise<boolean>;
  /** Writes an artifact file; returns its path relative to the run folder. */
  putArtifact(runId: string, name: string, data: Buffer | string): Promise<string>;
  saveResult(result: RunResult): Promise<void>;
  getResult(runId: string): Promise<RunResult | undefined>;
  listRuns(): Promise<RunSummary[]>;
  getSuppressions(origin?: string): Promise<Suppression[]>;
  addSuppression(s: Suppression): Promise<void>;
  /** Absolute folder of a run (for exporters and the CLI). */
  runDir(runId: string): string;
}
