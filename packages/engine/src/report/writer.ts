// Reporter (AI_AGENT_SPEC.md §3.6): rewrites verified findings in plain language. The deterministic wording
// (D22) is the fallback and stays in the finding as `template`; the writer's text is used only if code's
// fact check passes: every number, quoted string and page path in the output must appear in the finding's
// fact sheet. One retry for the ones that fail; then the template. Steps to reproduce are never written by
// the LLM (they come from the recorded steps).
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway";
import { WRITER_INSTRUCTIONS } from "../llm/prompts/report";
import { normaliseText } from "../oracle/parse";
import type { Finding } from "../types";

const Entry = z.object({
  id: z.string(),
  title: z.string().min(3).max(80),
  impact: z.string().min(3).max(260),
  expected: z.string().min(3).max(320),
  actual: z.string().min(3).max(420),
  likelyCause: z.string().min(3).max(260).optional(),
});
const WriterOutputSchema = z.object({ findings: z.array(Entry).max(8) });
export type WriterEntry = z.infer<typeof Entry>;

/** The facts the writer may use: the deterministic wording plus what was recorded. */
export function factSheet(f: Finding): string {
  return [
    `id: ${f.id}`,
    `title: ${f.title}`,
    `impact: ${f.impact}`,
    `expected: ${f.expected}`,
    `actual: ${f.actual}`,
    `where: ${f.route}`,
    `category: ${f.category}; severity: ${f.severity}`,
    `why flagged: ${f.whyFlagged}`,
    `steps:\n${f.steps
      .slice(0, 14)
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n")}`,
  ].join("\n");
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const QUOTED = /["“”]([^"“”]{2,})["“”]/g;
const PATH = /(?:^|\s)(\/[A-Za-z0-9_\-/.:?=&]+)/g;

/** Problems with a written entry, judged against its fact sheet. Empty = it may be used. */
export function factCheck(entry: WriterEntry, sheet: string): string[] {
  const problems: string[] = [];
  const text = [
    entry.title,
    entry.impact,
    entry.expected,
    entry.actual,
    entry.likelyCause ?? "",
  ].join("\n");
  const sheetNumbers = new Set((sheet.match(NUMBER) ?? []).map((n) => n.replace(/,/g, "")));
  for (const n of text.match(NUMBER) ?? [])
    if (!sheetNumbers.has(n.replace(/,/g, ""))) problems.push(`the number ${n} isn't in the facts`);
  const sheetLoose = normaliseText(sheet).toLowerCase();
  for (const m of text.matchAll(QUOTED)) {
    const q = normaliseText(m[1]!).toLowerCase();
    if (!sheetLoose.includes(q)) problems.push(`the quote "${m[1]}" isn't in the facts`);
  }
  for (const m of text.matchAll(PATH))
    if (!sheet.includes(m[1]!.replace(/[.:]+$/, "")))
      problems.push(`the path ${m[1]} isn't in the facts`);
  return problems;
}

function prompt(findings: Finding[], retry?: Map<string, string[]>): string {
  return [
    ...findings.map((f) => {
      const issues = retry?.get(f.id);
      return `<finding>\n${factSheet(f)}\n</finding>${issues?.length ? `\nYour previous version of ${f.id} broke the rules: ${issues.join("; ")}. Fix exactly that.` : ""}`;
    }),
    "Write the report entries.",
  ].join("\n");
}

async function call(
  gateway: LlmGateway,
  batch: Finding[],
  retry?: Map<string, string[]>,
): Promise<WriterEntry[]> {
  const res = await gateway.structured({
    role: "reporter",
    tier: "smart",
    instructions: WRITER_INSTRUCTIONS,
    prompt: prompt(batch, retry),
    schema: WriterOutputSchema,
    schemaName: "reportEntries",
    timeoutMs: 45_000,
  });
  return res.ok ? res.value.findings : [];
}

export interface WriterMetrics {
  written: number;
  factCheckFailures: number;
  templateFallbacks: number;
}

/**
 * Rewrites the given findings in place (title, impact, expected, actual, likely cause); the deterministic
 * wording is kept in `template`. Never throws: a failed call leaves the templates.
 */
export async function writeFindings(
  gateway: LlmGateway,
  findings: Finding[],
  deadline: number,
): Promise<WriterMetrics> {
  const metrics: WriterMetrics = { written: 0, factCheckFailures: 0, templateFallbacks: 0 };
  const byId = new Map(findings.map((f) => [f.id, f]));
  const batches: Finding[][] = [];
  for (let i = 0; i < findings.length; i += 6) batches.push(findings.slice(i, i + 6));
  const apply = (e: WriterEntry) => {
    const f = byId.get(e.id)!;
    f.template ??= { title: f.title, impact: f.impact, expected: f.expected, actual: f.actual };
    f.title = e.title;
    f.impact = e.impact;
    f.expected = e.expected;
    f.actual = e.actual;
    if (e.likelyCause) f.likelyCause = { text: e.likelyCause, isHypothesis: true };
    f.wording = "writer";
    metrics.written++;
  };
  await Promise.all(
    batches.map(async (batch) => {
      if (Date.now() > deadline || gateway.budgetExhausted) return;
      const out = await call(gateway, batch).catch(() => []);
      const retry = new Map<string, string[]>();
      for (const f of batch) {
        const e = out.find((x) => x.id === f.id);
        const problems = e ? factCheck(e, factSheet(f)) : ["missing"];
        if (e && !problems.length) apply(e);
        else {
          if (e) metrics.factCheckFailures++;
          retry.set(f.id, problems);
        }
      }
      if (!retry.size || Date.now() > deadline || gateway.budgetExhausted) {
        metrics.templateFallbacks += retry.size;
        return;
      }
      const again = await call(
        gateway,
        batch.filter((f) => retry.has(f.id)),
        retry,
      ).catch(() => []);
      for (const id of retry.keys()) {
        const f = byId.get(id)!;
        const e = again.find((x) => x.id === id);
        if (e && !factCheck(e, factSheet(f)).length) apply(e);
        else {
          if (e) metrics.factCheckFailures++;
          metrics.templateFallbacks++;
        }
      }
    }),
  );
  return metrics;
}
