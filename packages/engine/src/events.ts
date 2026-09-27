// Typed event protocol (ARCHITECTURE.md §8). The engine emits; server/CLI only render.
// `thumb` is a screenshot's file name in the run's artifacts folder (e.g. "ev_ab12cd34.jpg").
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
  | {
      t: "candidate";
      /** `title` is the plain-language headline (the live view shows it; `summary` is terser). */
      candidate: Pick<Candidate, "id" | "category" | "summary" | "route"> & { title?: string };
    }
  | {
      t: "verify";
      candidateId: string;
      stage: "evidence" | "replay" | "skeptic" | "tier";
      detail: string;
    }
  /** Verification's decision for one group of candidates (the live view's candidate → tier transition). */
  | { t: "tier"; candidateIds: string[]; tier: Finding["tier"]; reason: string }
  | {
      t: "finding";
      finding: Pick<
        Finding,
        "id" | "title" | "tier" | "severity" | "kind" | "tierReason" | "candidateIds" | "category"
      >;
    }
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

/** The live-view event for a new candidate. */
export function candidateEvent(c: Candidate): WitnessEvent {
  return {
    t: "candidate",
    candidate: {
      id: c.id,
      category: c.category,
      summary: c.summary,
      route: c.route,
      title: c.detail.title,
    },
  };
}
