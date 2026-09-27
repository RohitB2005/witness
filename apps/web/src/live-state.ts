// Folds the scan's event stream into what the live view shows, in plain language (FR-13: "it's obvious
// what Witness is doing at any moment"). Pure, so it's unit-tested without a browser.
import type { Journey, Phase, RunResult, WitnessEvent } from "@witness/engine";
import { PHASE_LABEL, TIER_LABEL } from "@witness/engine/view";

type Tier = Extract<WitnessEvent, { t: "tier" }>["tier"];

export interface PageItem {
  id: string;
  route: string;
  title: string;
  thumb?: string;
}
export interface StepItem {
  id: string;
  journeyId: string;
  description: string;
  ok: boolean;
  kind: "happy" | "edge" | "preamble";
  thumb?: string;
}
export interface CandidateItem {
  id: string;
  summary: string;
  category: string;
  route: string;
  /** Plain-language progress lines, newest last. */
  progress: string[];
  tier?: Tier;
  reason?: string;
}
export interface LiveState {
  phase?: Phase;
  phasesSeen: Phase[];
  pages: PageItem[];
  plan?: { journeys: Journey[]; autoApproveInMs: number; receivedAt: number };
  journeyStatus: Record<string, Journey["status"]>;
  steps: StepItem[];
  candidates: CandidateItem[];
  cost: { llmCalls: number; costUsd: number };
  /** The one line saying what Witness is doing right now. */
  now: string;
  warnings: string[];
  verdict?: RunResult["verdict"];
  error?: string;
  events: number;
}

export const initialLiveState: LiveState = {
  phasesSeen: [],
  pages: [],
  journeyStatus: {},
  steps: [],
  candidates: [],
  cost: { llmCalls: 0, costUsd: 0 },
  now: "Starting…",
  warnings: [],
  events: 0,
};

/** "Replay 1: reproduced (…)" → "Replay 1: it happened again". */
export function plainVerify(stage: string, detail: string): string {
  if (stage === "replay") {
    const m = /^Replay (\d+): (not reproduced|reproduced)(?: \((.*)\))?$/.exec(detail);
    if (m) {
      const again = m[2] === "reproduced";
      return `Replay ${m[1]}: ${again ? "it happened again" : "it didn't happen"}${!again && m[3] ? ` (${m[3]})` : ""}`;
    }
  }
  if (stage === "skeptic")
    return detail
      .replace(/^Skeptic: /, "Second opinion: ")
      .replace("bug_likely", "looks like a real bug")
      .replace("benign_likely", "may be intended")
      .replace("unclear", "unsure");
  if (/^Judge: /.test(detail))
    return detail.replace(
      /^Judge: (\w+) \(([\d.]+)\)$/,
      (_m, v: string, c: string) =>
        `AI judge: ${v === "bug" ? "a bug" : v === "not_bug" ? "not a bug" : "unsure"} (${Math.round(Number(c) * 100)}% confident)`,
    );
  return detail;
}

/** How one action or check reads in the live view: checks pass or fail; actions are done or didn't work. */
export function stepParts(description: string, ok: boolean): { label: string; text: string } {
  const check = /^Check: /.test(description);
  const text = check ? description.replace(/^Check: /, "") : description;
  return {
    label: check ? (ok ? "Check passed:" : "Check failed:") : ok ? "Done:" : "Didn't work:",
    text,
  };
}

function stepLine(description: string, ok: boolean): string {
  const { label, text } = stepParts(description, ok);
  return ok && label === "Done:" ? text : `${label} ${text}`;
}

export function liveReducer(s: LiveState, e: WitnessEvent): LiveState {
  const next: LiveState = { ...s, events: s.events + 1 };
  switch (e.t) {
    case "phase":
      next.phase = e.phase;
      if (!s.phasesSeen.includes(e.phase)) next.phasesSeen = [...s.phasesSeen, e.phase];
      next.now = e.phase === "done" ? "Finished." : `${PHASE_LABEL[e.phase]}…`;
      return next;
    case "page":
      next.pages = [
        ...s.pages,
        { id: e.state.id, route: e.state.routePattern, title: e.state.title, thumb: e.thumb },
      ];
      next.now = `Found the page ${e.state.routePattern}${e.state.title ? ` ("${e.state.title}")` : ""}`;
      return next;
    case "plan":
      next.plan = {
        journeys: e.journeys,
        autoApproveInMs: e.autoApproveInMs,
        receivedAt: Date.now(),
      };
      next.journeyStatus = Object.fromEntries(e.journeys.map((j) => [j.id, j.status]));
      next.now = `Planned ${e.journeys.length} journey${e.journeys.length === 1 ? "" : "s"} to test`;
      return next;
    case "journey": {
      next.journeyStatus = { ...s.journeyStatus, [e.journeyId]: e.status };
      const title = s.plan?.journeys.find((j) => j.id === e.journeyId)?.title;
      if (title && e.status !== "running")
        next.now = `Journey "${title}": ${e.status === "completed" ? "done" : e.status}`;
      else if (title) next.now = `Testing the journey "${title}"`;
      return next;
    }
    case "step":
      next.steps = [
        ...s.steps,
        {
          id: e.step.id,
          journeyId: e.step.journeyId,
          description: e.step.description,
          ok: e.step.ok,
          kind: e.step.kind,
          thumb: e.thumb,
        },
      ];
      next.now = stepLine(e.step.description, e.step.ok);
      return next;
    case "candidate":
    case "detector": {
      const id = e.t === "candidate" ? e.candidate.id : e.candidateId;
      if (s.candidates.some((c) => c.id === id)) {
        // A detector reports first with its terse summary; the candidate event brings the plain title.
        if (e.t === "candidate" && e.candidate.title)
          next.candidates = s.candidates.map((c) =>
            c.id === id ? { ...c, summary: e.candidate.title! } : c,
          );
        return next;
      }
      const c: CandidateItem =
        e.t === "candidate"
          ? {
              id,
              summary: e.candidate.title ?? e.candidate.summary,
              category: e.candidate.category,
              route: e.candidate.route,
              progress: [],
            }
          : { id, summary: e.summary, category: e.detectorId, route: "", progress: [] };
      next.candidates = [...s.candidates, c];
      next.now = `Something to double-check: ${c.summary}`;
      return next;
    }
    case "verify": {
      const line = plainVerify(e.stage, e.detail);
      next.candidates = s.candidates.map((c) =>
        c.id === e.candidateId ? { ...c, progress: [...c.progress, line] } : c,
      );
      const c = s.candidates.find((x) => x.id === e.candidateId);
      if (c) next.now = `Double-checking "${c.summary}": ${line}`;
      return next;
    }
    case "tier": {
      const ids = new Set(e.candidateIds);
      next.candidates = s.candidates.map((c) =>
        ids.has(c.id) ? { ...c, tier: e.tier, reason: e.reason } : c,
      );
      const c = s.candidates.find((x) => ids.has(x.id));
      if (c) next.now = `"${c.summary}" → ${TIER_LABEL[e.tier]}`;
      return next;
    }
    case "finding":
      return next;
    case "cost":
      next.cost = { llmCalls: e.llmCalls, costUsd: e.costUsd };
      return next;
    case "log":
      if (e.level !== "info") next.warnings = [...s.warnings, e.message].slice(-20);
      return next;
    case "done":
      next.verdict = e.verdict;
      next.now = "Finished.";
      return next;
    case "error":
      next.error = e.message;
      return next;
  }
}
