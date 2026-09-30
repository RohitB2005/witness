// Typed calls to the Witness server (apps/server). Types come from the engine; no engine code is bundled.
import type { RunResult, RunSummary, WitnessEvent } from "@witness/engine";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(
      typeof data.error === "string" ? data.error : `The server said ${res.status}.`,
      res.status,
      data,
    );
  return data as T;
}

export interface LiveInfo {
  runId: string;
  startedAt: string;
  url: string;
  budget: RunResult["config"]["budget"];
  mode: RunResult["config"]["mode"];
  llmCache: RunResult["config"]["llmCache"];
  capMs: number;
  costCapUsd: number;
}

export interface NewScanBody {
  url: string;
  mode: "staging" | "production";
  budget: "quick" | "demo" | "standard" | "deep";
  username?: string;
  password?: string;
  hint?: string;
  requirements?: string;
  confirmStagingOnNonLocal?: boolean;
  llmCache?: "off" | "rw" | "replay";
}

export interface Suppression {
  origin: string;
  fingerprint: string;
  reason: string;
  createdAt: string;
}

export const api = {
  runs: () =>
    call<{ live: LiveInfo | null; runs: (RunSummary & { live: boolean })[] }>("GET", "/api/scans"),
  run: (id: string) => call<RunResult>("GET", `/api/scans/${encodeURIComponent(id)}`),
  start: (body: NewScanBody) => call<{ runId: string }>("POST", "/api/scans", body),
  approve: (id: string, approvedJourneyIds: string[]) =>
    call<{ ok: true }>("POST", `/api/scans/${encodeURIComponent(id)}/plan`, { approvedJourneyIds }),
  cancel: (id: string) => call<{ ok: true }>("POST", `/api/scans/${encodeURIComponent(id)}/cancel`),
  suppress: (origin: string, fingerprint: string, reason: string) =>
    call<{ ok: true }>("POST", "/api/suppressions", { origin, fingerprint, reason }),
  suppressions: (origin: string) =>
    call<{ suppressions: Suppression[] }>(
      "GET",
      `/api/suppressions?origin=${encodeURIComponent(origin)}`,
    ),
  evalLatest: (path?: string) =>
    call<{
      path: string;
      summary: EvalSummary;
      available: { path: string; generatedAt: string }[];
    }>("GET", `/api/eval/latest${path ? `?path=${encodeURIComponent(path)}` : ""}`),
};

export const urls = {
  artifact: (runId: string, file: string) =>
    `/api/scans/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(file)}`,
  screenshot: (runId: string, findingId: string) =>
    `/api/scans/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/screenshot`,
  test: (runId: string, findingId: string) =>
    `/api/scans/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/test`,
  export: (runId: string, format: "html" | "md" | "json") =>
    `/api/scans/${encodeURIComponent(runId)}/export?format=${format}`,
  events: (runId: string) => `/api/scans/${encodeURIComponent(runId)}/events`,
};

/** The fields of eval/score.ts's summary.json the Evaluation page reads. */
export interface EvalSummary {
  generatedAt: string;
  benchCommit?: string;
  pipelines: Record<
    string,
    {
      runs: number;
      recall: { confirmed: number[]; confirmedLikely: number[]; all: number[] };
      precision: { bugs: (number | null)[]; improvements: (number | null)[] };
      cleanFalsePositives: number[];
      minutes: number[];
      costUsd: number[];
      llmCalls: number[];
    }
  >;
  recallByCategory: Record<string, number>;
  perBug: { id: string; found: boolean[]; bestTier: string | null; expectedTier: string }[];
  decoysFlagged: Record<string, number>;
  unlabelled: number;
}

export type { WitnessEvent };
