// Scoring (docs/EVALUATION.md §3). Pure functions: RunResult + ground truth + labels → numbers.
import type { Finding, RunResult } from "@witness/engine";
import { z } from "zod";
import { matchFinding, type MatchResult } from "./match";
import type { Truth } from "./truth";

/** eval/labels.json: fingerprint → human verdict + one-line reason. A label overrides the automatic match (D23). */
export type Label = "tp_unseeded" | "fp" | `tp:${string}`;
export interface LabelEntry {
  label: Label;
  reason: string;
}
export type Labels = Record<string, LabelEntry>;

export const LabelsFileSchema = z.record(
  z.string().regex(/^fp_[0-9a-f]{16}$/, "key must be a finding fingerprint (fp_ + 16 hex chars)"),
  z.strictObject({
    label: z
      .string()
      .regex(/^(tp:B\d{2}|tp_unseeded|fp)$/, 'label must be "tp:Bxx", "tp_unseeded" or "fp"')
      .transform((s) => s as Label),
    reason: z
      .string()
      .trim()
      .min(1, "every label needs a reason")
      .max(200, "keep the reason to one short line")
      .regex(/^[^\r\n]*$/, "reason must be a single line"),
  }),
);

/** Recall uses bug tiers; improvements map evidence_based → confirmed, suggestion → needs_review (D12). */
export type RecallTier = "confirmed" | "likely" | "needs_review";

export const RECALL_SETS = {
  confirmed: ["confirmed"],
  confirmedLikely: ["confirmed", "likely"],
  all: ["confirmed", "likely", "needs_review"],
} as const satisfies Record<string, readonly RecallTier[]>;

export function recallTier(tier: Finding["tier"]): RecallTier | undefined {
  switch (tier) {
    case "confirmed":
    case "evidence_based":
      return "confirmed";
    case "likely":
      return "likely";
    case "needs_review":
    case "suggestion":
      return "needs_review";
    default:
      return undefined; // discarded
  }
}

const RANK: Record<RecallTier, number> = { confirmed: 0, likely: 1, needs_review: 2 };

export interface FindingScore {
  findingId: string;
  fingerprint: string;
  title: string;
  kind: Finding["kind"];
  tier: Finding["tier"];
  category: Finding["category"];
  route: string;
  match?: MatchResult;
  label?: Label;
  /** tp = real (seeded or labelled); fp = decoy or labelled false; unlabelled = needs a human. */
  outcome: "tp" | "fp" | "unlabelled";
  bugId?: string;
  decoyId?: string;
  /** How the outcome was decided, in words (for the summary and Q&A). */
  why: string;
}

export function scoreFinding(f: Finding, truth: Truth, labels: Labels): FindingScore {
  const base = {
    findingId: f.id,
    fingerprint: f.fingerprint,
    title: f.title,
    kind: f.kind,
    tier: f.tier,
    category: f.category,
    route: f.route,
  };
  const match = matchFinding(f, truth);
  const entry = labels[f.fingerprint];
  if (entry) {
    const { label, reason } = entry;
    if (label === "fp")
      return { ...base, match, label, outcome: "fp", why: `labelled false positive: ${reason}` };
    if (label === "tp_unseeded")
      return { ...base, match, label, outcome: "tp", why: `labelled real (not seeded): ${reason}` };
    return {
      ...base,
      match,
      label,
      outcome: "tp",
      bugId: label.slice(3),
      why: `labelled ${label}: ${reason}`,
    };
  }
  if (!match) return { ...base, outcome: "unlabelled", why: "matches no rule; needs a label" };
  const rule = `${match.id} rule ${match.ruleIndex + 1}`;
  if (match.tentative) {
    return {
      ...base,
      match,
      outcome: "unlabelled",
      why: `tentative match (${rule}, confirm: manual); needs a label`,
    };
  }
  if (match.kind === "decoy")
    return { ...base, match, outcome: "fp", decoyId: match.id, why: `matches decoy ${rule}` };
  return { ...base, match, outcome: "tp", bugId: match.id, why: `matches ${rule}` };
}

export interface RunScore {
  runId: string;
  pipeline: string;
  clean: boolean;
  findings: FindingScore[];
  /** Seeded bug → best tier among its true-positive findings. */
  found: Record<string, RecallTier>;
  recall: Record<keyof typeof RECALL_SETS, number>;
  precision: {
    bugs: Record<keyof typeof RECALL_SETS, number | null>;
    improvements: { evidenceBased: number | null; all: number | null };
  };
  /** Clean build only: bug findings at Confirmed or Likely (each one is a false alarm). */
  cleanFalsePositives: number | null;
  decoysFlagged: string[];
  tierAccuracy: number | null;
  unlabelled: number;
  minutes: number;
  costUsd: number;
  llmCalls: number;
}

/**
 * Which tiers to score. "final" is what the run reported. "aiNoVerify" (A1) and "noSkeptic" (A3) are the
 * tiers each finding had at those earlier stages of the same run (D51): findings verification discarded
 * count again if they were reportable at that stage.
 */
export type ScoreStage = "final" | "aiNoVerify" | "noSkeptic";

export function scoreRun(
  result: RunResult,
  truth: Truth,
  labels: Labels,
  opts: { clean: boolean; stage?: ScoreStage },
): RunScore {
  const stage = opts.stage ?? "final";
  // A1 is the raw AI claims (D62): every bug at face value, including ones verification discarded. It is
  // computed here from the findings themselves, so runs recorded before D62 are scored the same way.
  const tierAt = (f: Finding): Finding["tier"] =>
    stage === "final"
      ? f.tier
      : stage === "aiNoVerify"
        ? f.kind === "bug"
          ? "confirmed"
          : f.source.kind === "ux-review"
            ? "suggestion"
            : "evidence_based"
        : (f.stageTiers?.[stage] ?? f.tier);
  const findings = result.findings
    .map((f) => ({ ...f, tier: tierAt(f) }))
    .filter((f) => f.tier !== "discarded")
    .map((f) => scoreFinding(f, truth, labels));

  const found: Record<string, RecallTier> = {};
  const seeded = new Set(truth.bugs.map((b) => b.id));
  for (const s of findings) {
    const t = recallTier(s.tier);
    if (s.outcome !== "tp" || !s.bugId || !seeded.has(s.bugId) || !t) continue;
    const prev = found[s.bugId];
    if (!prev || RANK[t] < RANK[prev]) found[s.bugId] = t;
  }
  const total = truth.bugs.length;
  const recallAt = (set: readonly RecallTier[]) =>
    Object.values(found).filter((t) => set.includes(t)).length / total;

  const precisionOver = (items: FindingScore[]) => {
    const tp = items.filter((s) => s.outcome === "tp").length;
    const fp = items.filter((s) => s.outcome === "fp").length;
    return tp + fp === 0 ? null : tp / (tp + fp);
  };
  const bugs = findings.filter((s) => s.kind === "bug");
  const imps = findings.filter((s) => s.kind === "improvement");
  const bugsAt = (set: readonly RecallTier[]) =>
    precisionOver(bugs.filter((s) => set.includes(recallTier(s.tier)!)));

  const foundIds = Object.keys(found);
  const expected = (id: string) =>
    truth.bugs
      .find((b) => b.id === id)
      ?.expected_tier.toLowerCase()
      .replace(" ", "_");
  const tierAccuracy = foundIds.length
    ? foundIds.filter((id) => found[id] === expected(id)).length / foundIds.length
    : null;

  return {
    runId: result.runId,
    pipeline:
      stage === "final"
        ? result.config.pipeline
        : `${stage === "aiNoVerify" ? "ai-no-verify" : "full-no-skeptic"} (derived)`,
    clean: opts.clean,
    findings,
    found,
    recall: {
      confirmed: recallAt(RECALL_SETS.confirmed),
      confirmedLikely: recallAt(RECALL_SETS.confirmedLikely),
      all: recallAt(RECALL_SETS.all),
    },
    precision: {
      bugs: {
        confirmed: bugsAt(RECALL_SETS.confirmed),
        confirmedLikely: bugsAt(RECALL_SETS.confirmedLikely),
        all: bugsAt(RECALL_SETS.all),
      },
      improvements: {
        evidenceBased: precisionOver(imps.filter((s) => s.tier === "evidence_based")),
        all: precisionOver(imps),
      },
    },
    cleanFalsePositives: opts.clean
      ? bugs.filter((s) => s.tier === "confirmed" || s.tier === "likely").length
      : null,
    decoysFlagged: [...new Set(findings.flatMap((s) => (s.decoyId ? [s.decoyId] : [])))],
    tierAccuracy,
    unlabelled: findings.filter((s) => s.outcome === "unlabelled").length,
    minutes: result.stats.durationMs / 60_000,
    costUsd: result.stats.costUsd,
    llmCalls: result.stats.llmCalls,
  };
}

/** Mean pairwise Jaccard overlap of found bug-ID sets (1 = identical every run). */
export function stabilityJaccard(sets: string[][]): number | null {
  if (sets.length < 2) return null;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = new Set(sets[i]);
      const b = new Set(sets[j]);
      const union = new Set([...a, ...b]).size;
      const inter = [...a].filter((x) => b.has(x)).length;
      sum += union === 0 ? 1 : inter / union;
      pairs++;
    }
  }
  return sum / pairs;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** summary.json (EVALUATION.md §5) — the fields P1 can fill; later phases add funnel, tests, injection. */
export function summarise(
  scores: RunScore[],
  truth: Truth,
  meta: { bugsYamlHash: string; benchCommit?: string },
) {
  const pipelines: Record<string, Record<string, unknown>> = {};
  for (const p of [...new Set(scores.map((s) => s.pipeline))]) {
    const runs = scores.filter((s) => s.pipeline === p);
    const buggy = runs.filter((s) => !s.clean);
    pipelines[p] = {
      runs: runs.length,
      recall: {
        confirmed: buggy.map((s) => s.recall.confirmed),
        confirmedLikely: buggy.map((s) => s.recall.confirmedLikely),
        all: buggy.map((s) => s.recall.all),
      },
      precision: {
        bugs: runs.map((s) => s.precision.bugs.confirmedLikely),
        improvements: runs.map((s) => s.precision.improvements.all),
      },
      cleanFalsePositives: runs.filter((s) => s.clean).map((s) => s.cleanFalsePositives),
      tierAccuracy: buggy.map((s) => s.tierAccuracy),
      minutes: runs.map((s) => Number(s.minutes.toFixed(2))),
      costUsd: runs.map((s) => s.costUsd),
      llmCalls: runs.map((s) => s.llmCalls),
      stabilityJaccard: stabilityJaccard(buggy.map((s) => Object.keys(s.found))),
    };
  }
  // Per-bug and by-category views use each run once (its final tiers), not the derived A1/A3 rows.
  const buggy = scores.filter((s) => !s.clean && !s.pipeline.endsWith("(derived)"));
  const categories = [...new Set(truth.bugs.map((b) => b.category))];
  const recallByCategory = Object.fromEntries(
    categories.map((c) => {
      const ids = truth.bugs.filter((b) => b.category === c).map((b) => b.id);
      const rates = buggy.map(
        (s) =>
          ids.filter((id) => ["confirmed", "likely"].includes(s.found[id] ?? "")).length /
          ids.length,
      );
      return [c, median(rates)];
    }),
  );
  const perBug = truth.bugs.map((b) => {
    const tiers = buggy.map((s) => s.found[b.id]);
    const best = tiers.filter(Boolean).sort((x, y) => RANK[x!] - RANK[y!])[0];
    return {
      id: b.id,
      found: tiers.map(Boolean),
      bestTier: best ?? null,
      expectedTier: b.expected_tier,
    };
  });
  const decoysFlagged = Object.fromEntries(
    truth.decoys.map((d) => [d.id, scores.filter((s) => s.decoysFlagged.includes(d.id)).length]),
  );
  return {
    generatedAt: new Date().toISOString(),
    benchCommit: meta.benchCommit ?? null,
    bugsYamlHash: meta.bugsYamlHash,
    runIds: scores.map((s) => s.runId),
    pipelines,
    recallByCategory,
    perBug,
    decoysFlagged,
    unlabelled: scores.reduce((n, s) => n + s.unlabelled, 0),
  };
}
