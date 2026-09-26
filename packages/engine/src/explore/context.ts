// Explorer turn context (AI_AGENT_SPEC.md §3.2, §5): text only. The page is the AI-mode aria snapshot
// wrapped as untrusted content; history is the last 8 step descriptions, never old snapshots.
import { pageContent } from "../llm/prompts/universal";
import type { Expectation, Journey } from "../types";

export interface TurnContext {
  journey: Pick<Journey, "id" | "title" | "goal" | "priority" | "suggestedSteps">;
  expectations: {
    exp: Expectation;
    status: "not checked yet" | "passed" | "FAILED" | "couldn't evaluate";
  }[];
  history: string[];
  newErrors: string[];
  evidenceIds: { id: string; what: string }[];
  stepNumber: number;
  stepBudget: number;
  url: string;
  title: string;
  snapshot: string;
  lastResult?: string;
  loggedIn: boolean;
  /** YYYY-MM-DD. Models don't know today's date; forms with dates need it. */
  today: string;
}

const AMOUNT_LABEL =
  /\b(total|subtotal|sub-total|tax|fee|discount|price|cost|balance|due|per)\b|%/i;
const AMOUNT = /[$€£¥]\s?\d|\d[.,]\d{2}\b/;

/**
 * Lines of the page that pair a label with an amount ("Total (incl. 10% tax) $178.54"). Listed as a hint:
 * a stated rule is the strongest kind of expectation, and small models tend to walk past it.
 */
export function labelledAmounts(snapshot: string, max = 8): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    if (!out.includes(t) && out.length < max) out.push(t);
  };
  const lines = snapshot.split("\n");
  // "- term: Subtotal" → "Subtotal"; drops refs and attributes.
  const clean = (line: string) =>
    line
      .replace(/^\s*- [a-z]+(?: "((?:[^"\\]|\\.)*)")?/, (_m, name?: string) => name ?? "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/^\s*:\s*/, "")
      .replace(/:\s*$/, "")
      .replace(/^"|"$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*- option\b/.test(line)) continue; // dropdown choices aren't results
    const text = clean(line);
    if (!text || text.length > 140) continue;
    const hasAmount = AMOUNT.test(text);
    const hasLabel = AMOUNT_LABEL.test(text);
    if (hasAmount && hasLabel) push(text);
    else if (hasLabel && !hasAmount && text.length <= 60) {
      // A label and its value on separate lines (<dl>, grids): "Subtotal" then "$135.00".
      const next = clean(lines[i + 1] ?? "");
      if (next && AMOUNT.test(next) && !/[a-z]{3,}/i.test(next.replace(/[A-Z]{2,3}\$?/g, ""))) {
        push(`${text}: ${next}`);
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

export function buildTurnPrompt(c: TurnContext): string {
  const amounts = labelledAmounts(c.snapshot);
  const exp = c.expectations.length
    ? c.expectations
        .map(({ exp, status }) => {
          const when = exp.when ? ` — when: ${exp.when}` : "";
          const planned =
            status === "not checked yet" || status === "couldn't evaluate"
              ? `\n  planned check: ${JSON.stringify(exp.check)}`
              : "";
          return `- ${exp.id} [${status}] "${exp.statement}"${when}${planned}`;
        })
        .join("\n")
    : "(none planned; assert your own if you see something checkable)";
  const path = safePath(c.url);
  return [
    `<journey id="${c.journey.id}" priority="${c.journey.priority}">`,
    `Title: ${c.journey.title}`,
    `Goal: ${c.journey.goal}`,
    c.journey.suggestedSteps.length
      ? `Suggested steps:\n${c.journey.suggestedSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "",
    `You are ${c.loggedIn ? "logged in with the test account" : "not logged in"}. Today's date is ${c.today}.`,
    `</journey>`,
    `<expectations>\n${exp}\n</expectations>`,
    `<recent_steps>\n${c.history.slice(-8).join("\n") || "(none yet)"}\n</recent_steps>`,
    c.lastResult ? `<last_result>${c.lastResult}</last_result>` : "",
    `<new_errors>\n${c.newErrors.length ? c.newErrors.slice(0, 5).join("\n") : "none"}\n</new_errors>`,
    `<evidence_ids>\n${c.evidenceIds.map((e) => `${e.id} (${e.what})`).join("\n")}\n</evidence_ids>`,
    amounts.length
      ? `<labelled_amounts hint="if a label states a rule, assert it">\n${amounts.join("\n")}\n</labelled_amounts>`
      : "",
    `Turn ${c.stepNumber} of ${c.stepBudget}. Page: ${path} "${c.title}"`,
    pageContent(compactSnapshot(c.snapshot), c.url),
    "Call exactly one tool.",
  ]
    .filter(Boolean)
    .join("\n");
}

const MAX_SIBLINGS = 20;

/**
 * Keeps the snapshot within ~6k tokens: drops cursor hints, collapses runs of more than 20 same-role
 * siblings ("… 34 more listitem"), and if still too long puts the `main` landmark first and truncates.
 */
export function compactSnapshot(snapshot: string, maxChars = 24_000): string {
  const lines = snapshot.replace(/ \[cursor=pointer\]/g, "").split("\n");
  const out: string[] = [];
  const runs = new Map<string, number>(); // indent|role → count in the current parent
  let skipIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const indent = line.length - line.trimStart().length;
    if (skipIndent >= 0) {
      if (indent > skipIndent) continue;
      skipIndent = -1;
    }
    const role = /^\s*- ([a-z]+)/.exec(line)?.[1];
    // Leaving a parent resets the counters of deeper levels.
    for (const k of [...runs.keys()]) if (Number(k.split("|")[0]) > indent) runs.delete(k);
    if (role) {
      const k = `${indent}|${role}`;
      const n = (runs.get(k) ?? 0) + 1;
      runs.set(k, n);
      if (n > MAX_SIBLINGS) {
        let more = 1;
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j]!;
          const ind = l.length - l.trimStart().length;
          if (ind < indent) break;
          if (ind === indent && new RegExp(`^\\s*- ${role}\\b`).test(l)) more++;
          else if (ind === indent) break;
        }
        if (n === MAX_SIBLINGS + 1) out.push(`${" ".repeat(indent)}- … ${more} more ${role}`);
        skipIndent = indent;
        continue;
      }
    }
    out.push(line);
  }
  let text = out.join("\n");
  if (text.length <= maxChars) return text;
  const mainAt = out.findIndex((l) => /^\s*- main\b/.test(l));
  if (mainAt > 0) {
    const ind = out[mainAt]!.length - out[mainAt]!.trimStart().length;
    let end = mainAt + 1;
    while (end < out.length && out[end]!.length - out[end]!.trimStart().length > ind) end++;
    text = [...out.slice(mainAt, end), ...out.slice(0, mainAt), ...out.slice(end)].join("\n");
  }
  return `${text.slice(0, maxChars)}\n- … (snapshot truncated)`;
}

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
