// Matching a Witness finding against bugs.yaml, exactly as the file's header documents:
//
//  - A finding matches a bug if ANY rule under `match.any` matches.
//  - Within one rule, EVERY field present must match (fields are ANDed; absent fields are ignored).
//  - A rule marked `confirm: manual` gives a TENTATIVE match: listed for a human, not counted automatically.
//  - One finding matches at most one entry: bugs are tried in file order, then decoys; the first matching
//    rule wins, whether it's firm or tentative.
import type { Finding } from "@witness/engine";
import type { Rule, Truth } from "./truth";

/** The subset of a Finding the rules can see. */
export type MatchableFinding = Pick<
  Finding,
  "source" | "category" | "route" | "signals" | "title" | "impact" | "expected" | "actual"
> &
  Partial<Pick<Finding, "template">>;

export interface MatchResult {
  kind: "bug" | "decoy";
  id: string;
  ruleIndex: number;
  tentative: boolean;
}

/**
 * The finding's source ID: detector ID (DET-*), check type (e.g. numericRelation), or REQ-NOTFOUND for a
 * requirement with nothing matching it in the app (v2, ADDENDUM A5).
 */
export function sourceId(f: MatchableFinding): string | undefined {
  return "id" in f.source ? f.source.id : undefined;
}

/** Text the keyword fields search: title + description (the plain-language impact) + expected + actual. */
/**
 * The text keyword rules search. When the writer rephrased a finding, its deterministic wording (`template`)
 * is used, so scores don't depend on an LLM's word choice (DEVLOG D53).
 */
export function searchableText(f: MatchableFinding): string {
  const t = f.template ?? f;
  return [t.title, t.impact, t.expected, t.actual].join(" \n ").toLowerCase();
}

/** Every present field must hold. Returns the name of the first field that fails (for explanations). */
export function failingField(rule: Rule, f: MatchableFinding): string | undefined {
  const req = f.signals.request;
  if (rule.source !== undefined && sourceId(f) !== rule.source) return "source";
  if (rule.source_kind !== undefined && f.source.kind !== rule.source_kind) return "source_kind";
  if (rule.category !== undefined && f.category !== rule.category) return "category";
  if (rule.route !== undefined && !new RegExp(rule.route).test(f.route)) return "route";
  if (rule.request_path !== undefined && !(req && new RegExp(rule.request_path).test(req.path))) {
    return "request_path";
  }
  if (rule.method !== undefined && req?.method.toUpperCase() !== rule.method.toUpperCase())
    return "method";
  if (rule.status_gte !== undefined && !(req && req.status >= rule.status_gte)) return "status_gte";
  if (rule.axe_rule !== undefined && f.signals.axeRuleId !== rule.axe_rule) return "axe_rule";
  if (
    rule.message !== undefined &&
    !(f.signals.errorMessage !== undefined && new RegExp(rule.message).test(f.signals.errorMessage))
  ) {
    return "message";
  }
  if (rule.keywords_any || rule.keywords_all) {
    const text = searchableText(f);
    if (rule.keywords_any && !rule.keywords_any.some((k) => text.includes(k.toLowerCase()))) {
      return "keywords_any";
    }
    if (rule.keywords_all && !rule.keywords_all.every((k) => text.includes(k.toLowerCase()))) {
      return "keywords_all";
    }
  }
  return undefined;
}

export function ruleMatches(rule: Rule, f: MatchableFinding): boolean {
  return failingField(rule, f) === undefined;
}

export function matchFinding(
  f: MatchableFinding,
  truth: Pick<Truth, "bugs" | "decoys">,
): MatchResult | undefined {
  for (const bug of truth.bugs) {
    const i = bug.match.any.findIndex((r) => ruleMatches(r, f));
    if (i >= 0)
      return {
        kind: "bug",
        id: bug.id,
        ruleIndex: i,
        tentative: bug.match.any[i]!.confirm === "manual",
      };
  }
  for (const decoy of truth.decoys) {
    const i = decoy.match.any.findIndex((r) => ruleMatches(r, f));
    if (i >= 0) {
      return {
        kind: "decoy",
        id: decoy.id,
        ruleIndex: i,
        tentative: decoy.match.any[i]!.confirm === "manual",
      };
    }
  }
  return undefined;
}
