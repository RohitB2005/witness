// Typed event protocol (ARCHITECTURE.md §8). The engine emits; server/CLI only render.
import type { Candidate, Finding, Journey, PageState, RunResult, Step } from "./types";

export type Phase = "preflight" | "map" | "plan" | "explore" | "verify" | "report" | "done";

export type WitnessEvent =
  | { t: "phase"; phase: Phase; at: string }
  | { t: "page"; state: Pick<PageState, "id" | "url" | "routePattern" | "title">; thumb?: string }
  | { t: "detector"; candidateId: string; detectorId: string; summary: string }
  | { t: "plan"; journeys: Journey[]; autoApproveInMs: number }
  | { t: "journey"; journeyId: string; status: Journey["status"] }
  | {
      t: "step";
      step: Pick<Step, "id" | "journeyId" | "index" | "description" | "ok" | "kind">;
      thumb?: string;
    }
  | { t: "candidate"; candidate: Pick<Candidate, "id" | "category" | "summary" | "route"> }
  | {
      t: "verify";
      candidateId: string;
      stage: "evidence" | "replay" | "skeptic" | "tier";
      detail: string;
    }
  | { t: "finding"; finding: Pick<Finding, "id" | "title" | "tier" | "severity" | "kind"> }
  | { t: "cost"; llmCalls: number; costUsd: number }
  | { t: "log"; level: "info" | "warn" | "error"; message: string }
  | { t: "done"; verdict: RunResult["verdict"] }
  | { t: "error"; message: string };

export type EventSink = (event: WitnessEvent) => void;

/** Fans one event out to several sinks (e.g. the run store and the CLI printer). A throwing sink is isolated. */
export function fanOut(...sinks: EventSink[]): EventSink {
  return (event) => {
    for (const sink of sinks) {
      try {
        sink(event);
      } catch {
        // A broken renderer must never stop a scan.
      }
    }
  };
}

export function log(sink: EventSink, level: "info" | "warn" | "error", message: string): void {
  sink({ t: "log", level, message });
}
