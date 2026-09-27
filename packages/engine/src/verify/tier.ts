// Tier rules (SPEC FR-8, AI_AGENT_SPEC.md §7). Pure: the same facts always give the same tier and the
// same one-sentence reason. Replaces P1/P2's provisional tiers (D17, D29).
//
// Deviations recorded in DEVLOG: replay stops at two agreeing attempts (D49); a static detector is
// "reproduced" by one fresh re-run (FR-8); an AI-guessed input rule not stated on the page is capped at
// Needs review (D46); a check that only asserts its own grounding quote is visible counts as convention.
import type { CandidateSource, ImprovementTier, Pipeline, Tier } from "../types";

export type AnyTier = Tier | ImprovementTier;
export type SkepticVerdict = "bug_likely" | "unclear" | "benign_likely";

export interface ReplayFacts {
  attempts: number;
  reproduced: number;
  /** Why it wasn't replayed (time ran out, no replayable steps). */
  skipped?: string;
  /** A finding with no steps, re-run once on a fresh load (FR-8): one attempt is enough. */
  static?: boolean;
}

export interface TierInput {
  kind: "bug" | "improvement";
  source: CandidateSource;
  grounding?: {
    kind: "ui_text" | "requirement" | "convention";
    verified: boolean;
    selfReferential?: boolean;
    aiGuessedRule?: boolean;
  };
  evidenceValid: boolean;
  evidenceNote?: string;
  replay: ReplayFacts;
  judge?: { verdict: "bug" | "not_bug" | "unclear"; confidence: number };
  skeptic?: SkepticVerdict;
  suppressed?: { at: string; reason: string };
}

export interface TierDecision {
  tier: AnyTier;
  reason: string;
}

export type ReplayOutcome = "reproduced" | "intermittent" | "not_reproduced" | "not_replayed";

/** Judge verdicts below this confidence can't lift a finding above Needs review (FR-8). */
export const JUDGE_MIN_CONFIDENCE = 0.7;

export function replayOutcome(r: ReplayFacts): ReplayOutcome {
  if (r.attempts === 0) return "not_replayed";
  // A path replay needs two agreeing attempts (D49); a static finding needs one fresh re-run (FR-8).
  if (r.reproduced >= 2 || (r.static && r.attempts === 1 && r.reproduced === 1))
    return "reproduced";
  if (r.reproduced === 1) return "intermittent";
  return "not_reproduced";
}

export function replayText(r: ReplayFacts): string {
  if (r.attempts === 0) return `not replayed${r.skipped ? ` (${r.skipped})` : ""}`;
  return `reproduced ${r.reproduced} of ${r.attempts} replay${r.attempts === 1 ? "" : "s"}`;
}

/** A grounding that lets a failed check reach Confirmed: verified on-screen or requirements text. */
export function isGrounded(g: TierInput["grounding"]): boolean {
  return !!g && g.kind !== "convention" && g.verified && !g.selfReferential;
}

/** The final tier (pipeline `full`). */
export function decideTier(i: TierInput): TierDecision {
  if (i.suppressed) {
    return {
      tier: "discarded",
      reason: `Suppressed by you on ${i.suppressed.at.slice(0, 10)}: ${i.suppressed.reason}`,
    };
  }
  if (!i.evidenceValid) {
    return {
      tier: "discarded",
      reason: `Its evidence didn't check out${i.evidenceNote ? `: ${i.evidenceNote}` : "."}`,
    };
  }
  const outcome = replayOutcome(i.replay);
  const replay = replayText(i.replay);

  if (i.kind === "improvement") {
    if (i.source.kind === "ux-review")
      return { tier: "suggestion", reason: "A UX suggestion from the reviewer (an LLM)." };
    if (outcome === "not_reproduced")
      return { tier: "discarded", reason: `It didn't show again on a fresh load (${replay}).` };
    return {
      tier: "evidence_based",
      reason: "Measured directly on the page by a deterministic check.",
    };
  }

  if (outcome === "not_reproduced")
    return { tier: "discarded", reason: `It didn't happen again when replayed (${replay}).` };
  if (outcome === "intermittent")
    return {
      tier: "needs_review",
      reason: `Intermittent: ${replay}. It may depend on timing or data.`,
    };
  if (outcome === "not_replayed")
    return { tier: "needs_review", reason: `Not verified: ${replay}.` };

  // Reproduced.
  if (i.source.kind === "judgement") {
    const j = i.judge;
    if (j?.verdict === "not_bug")
      return {
        tier: "discarded",
        reason: "The judge (an LLM) found the page behaving as intended.",
      };
    if (!j || j.verdict === "unclear" || j.confidence < JUDGE_MIN_CONFIDENCE)
      return {
        tier: "needs_review",
        reason: `Flagged by the Explorer (an LLM); ${j ? `the judge was ${j.verdict === "unclear" ? "unsure" : `only ${Math.round(j.confidence * 100)}% confident`}` : "not judged"}. No deterministic check confirms it (${replay}).`,
      };
    if (i.skeptic === "benign_likely")
      return {
        tier: "needs_review",
        reason: `The skeptic found a plausible innocent explanation; ${replay}.`,
      };
    return {
      tier: "likely",
      reason: `An LLM judged this a bug (${Math.round(j.confidence * 100)}% confident) and the steps replay (${replay}). Judgements reach Likely at most.`,
    };
  }

  if (i.skeptic === "benign_likely")
    return {
      tier: "needs_review",
      reason: `It reproduces (${replay}), but the skeptic found a plausible innocent explanation.`,
    };

  if (i.source.kind === "detector") {
    return {
      tier: "confirmed",
      reason: `${i.source.id} found something that is always wrong, and it ${replay}.`,
    };
  }
  if (i.source.kind === "check") {
    if (isGrounded(i.grounding)) {
      return {
        tier: "confirmed",
        reason: `A deterministic check failed; its expectation is stated ${i.grounding!.kind === "requirement" ? "in the requirements" : "on the page"}, and it ${replay}.`,
      };
    }
    if (i.grounding?.aiGuessedRule) {
      return {
        tier: "needs_review",
        reason: `It ${replay}, but the rule was guessed by an AI and the page doesn't state it.`,
      };
    }
    if (i.grounding?.selfReferential) {
      return {
        tier: "needs_review",
        reason: `It ${replay}, but the check expected text seen on another page to appear here; this page never promised it.`,
      };
    }
    return {
      tier: "likely",
      reason: `A deterministic check failed and it ${replay}, but the expectation is a convention, not stated on the page.`,
    };
  }
  return { tier: "needs_review", reason: `Not verified (${replay}).` };
}

/**
 * Ablation A1 (`ai-no-verify`, D29): what an unverified AI tester would claim from the same candidate —
 * no evidence validation, replay, judge or skeptic. Grounding still counts (it's part of the AI design),
 * including the D46 cap.
 */
export function unverifiedTier(i: Pick<TierInput, "kind" | "source" | "grounding">): TierDecision {
  const why = "Unverified pipeline (ablation A1): reported without replay or skeptic.";
  if (i.kind === "improvement")
    return {
      tier: i.source.kind === "ux-review" ? "suggestion" : "evidence_based",
      reason: `${why} Measured directly on the page.`,
    };
  if (i.source.kind === "detector")
    return { tier: "confirmed", reason: `${why} Found by ${i.source.id}.` };
  if (i.source.kind === "check") {
    if (isGrounded(i.grounding))
      return { tier: "confirmed", reason: `${why} Grounded on the page.` };
    if (i.grounding?.aiGuessedRule)
      return { tier: "needs_review", reason: `${why} An AI-guessed rule the page doesn't state.` };
    if (i.grounding?.selfReferential)
      return { tier: "needs_review", reason: `${why} It expected text from another page here.` };
    return { tier: "likely", reason: `${why} Grounded in convention.` };
  }
  return { tier: "likely", reason: `${why} The Explorer's judgement.` };
}

/** Final tier plus the tiers at earlier stages (D51), for the pipeline that actually ran. */
export function tierWithStages(
  i: TierInput,
  pipeline: Pipeline,
): TierDecision & { stageTiers: { aiNoVerify: AnyTier; noSkeptic: AnyTier } } {
  const a1 = unverifiedTier(i);
  const noSkeptic = decideTier({ ...i, skeptic: undefined });
  const final =
    pipeline === "ai-no-verify" ? a1 : pipeline === "full-no-skeptic" ? noSkeptic : decideTier(i);
  return { ...final, stageTiers: { aiNoVerify: a1.tier, noSkeptic: noSkeptic.tier } };
}
