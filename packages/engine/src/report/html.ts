// Self-contained HTML report (SPEC FR-10, SECURITY T7). One file, no network: inline CSS, screenshots as
// data URIs. Every interpolated value goes through `esc` — page text can contain markup, and the report must
// never render it. Severity and tier are always written as words, never shown by colour alone.
import type { Finding, RunResult } from "../types";
import { replayText } from "../verify/tier";
import { CRITERION_LABEL } from "./requirements";

const VERDICT = {
  ready: "Ready",
  caveats: "Ready with caveats",
  not_ready: "Not ready",
} as const;
const TIER: Record<Finding["tier"], string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  needs_review: "Needs review",
  discarded: "Discarded",
  evidence_based: "Evidence-based",
  suggestion: "Suggestion",
};

function requirementsTable(r: RunResult): string {
  const cs = r.requirements!.criteria;
  const link = new Map(r.findings.map((f) => [f.id, f.title]));
  const rows = cs
    .map(
      (c) =>
        `<tr><td>${esc(c.id)}</td><td>${esc(c.quote)}</td><td><strong>${esc(CRITERION_LABEL[c.status])}</strong></td><td>${esc(c.reason)}${c.findingIds
          .filter((id) => link.has(id))
          .map((id) => ` <a href="#${esc(id)}">(finding)</a>`)
          .join("")}</td></tr>`,
    )
    .join("");
  return `<h2>Requirements coverage (${cs.length} criteria)</h2><table><thead><tr><th>#</th><th>Criterion (from the requirements)</th><th>Status</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface HtmlOptions {
  /** evidence id → data URI (image/jpeg), for the finding's screenshot. */
  images?: Map<string, string>;
}

const CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#555;--line:#ddd;--card:#fafafa;--bad:#a4161a;--warn:#8a5a00;--ok:#1b6e3a}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#aaa;--line:#333;--card:#1c1c1c;--bad:#ff8a8a;--warn:#ffcf70;--ok:#7fd99a}}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
*{box-sizing:border-box}body{margin:0 auto;max-width:960px;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.2rem;margin:32px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}h3{font-size:1.05rem;margin:0 0 6px}
.verdict{border:2px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0}.verdict strong{font-size:1.1rem}
.v-not_ready{border-color:var(--bad)}.v-caveats{border-color:var(--warn)}.v-ready{border-color:var(--ok)}
.meta{color:var(--muted);font-size:.9rem}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
.badges span{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 6px;margin:0 6px 4px 0;font-size:.85rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
img{max-width:100%;border:1px solid var(--line);border-radius:4px;margin-top:8px}code{overflow-wrap:anywhere}ol{margin:6px 0 6px 20px;padding:0}
details{margin:8px 0}summary{cursor:pointer}`;

function card(f: Finding, n: number, o: HtmlOptions): string {
  const img = f.evidenceIds
    .map((id) => o.images?.get(id))
    .find((x) => x && x.startsWith("data:image/"));
  return `<article class="card" id="${esc(f.id)}">
<h3>${n}. ${esc(f.title)}</h3>
<div class="badges"><span>Severity: ${esc(f.severity)}</span><span>Tier: ${esc(TIER[f.tier])}</span><span>Category: ${esc(f.category)}</span><span>Route: <code>${esc(f.route)}</code></span></div>
<p>${esc(f.impact)}</p>
<dl>
<dt>Expected</dt><dd>${esc(f.expected)}</dd>
<dt>Actual</dt><dd>${esc(f.actual)}</dd>
<dt>Why this tier</dt><dd>${esc(f.tierReason)}</dd>
<dt>Why flagged</dt><dd>${esc(f.whyFlagged)}</dd>
<dt>Replay</dt><dd>${esc(replayText(f.replay))}${f.replay.notes ? ` — ${esc(f.replay.notes)}` : ""}</dd>
${f.skeptic ? `<dt>Skeptic</dt><dd>${esc(f.skeptic.verdict)}: ${esc(f.skeptic.reason)}</dd>` : ""}
${f.judge ? `<dt>Judge</dt><dd>${esc(f.judge.verdict)} (${Math.round(f.judge.confidence * 100)}% confident)</dd>` : ""}
${f.likelyCause ? `<dt>Likely cause</dt><dd>Hypothesis: ${esc(f.likelyCause.text)}</dd>` : ""}
${f.testFile ? `<dt>Regression test</dt><dd><code>tests/${esc(f.testFile)}</code></dd>` : ""}
</dl>
<p><strong>Steps to reproduce</strong></p>
<ol>${f.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
${img ? `<img src="${esc(img)}" alt="Screenshot for this finding">` : ""}
<p class="meta">Evidence: ${esc(f.evidenceIds.join(", "))} · Fingerprint: ${esc(f.fingerprint)}</p>
</article>`;
}

export function renderHtml(r: RunResult, o: HtmlOptions = {}): string {
  const bugs = r.findings.filter((f) => f.kind === "bug" && f.tier !== "discarded");
  const improvements = r.findings.filter((f) => f.kind === "improvement" && f.tier !== "discarded");
  const discarded = r.findings.filter((f) => f.tier === "discarded");
  const count = (t: Finding["tier"]) => bugs.filter((f) => f.tier === t).length;
  const mins = (r.stats.durationMs / 60_000).toFixed(1);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Witness report: ${esc(r.scope)}</title><style>${CSS}</style></head><body>
<h1>Witness report</h1>
<p class="meta">${esc(r.scope)} · ${esc(r.config.mode)} mode · ${esc(r.config.budget)} budget · pipeline ${esc(r.config.pipeline)} · ${esc(r.startedAt)} · ${esc(mins)} min · ${esc(r.stats.llmCalls)} AI calls (US$${esc(r.stats.costUsd.toFixed(2))})</p>
<section class="verdict v-${esc(r.verdict.level)}"><strong>Verdict: ${esc(VERDICT[r.verdict.level])}.</strong> ${esc(r.verdict.reason)}</section>
<p>Bugs: ${bugs.length} (Confirmed ${count("confirmed")}, Likely ${count("likely")}, Needs review ${count("needs_review")}) · Improvements: ${improvements.length} · Discarded: ${discarded.length} · Pages mapped: ${esc(r.stats.pages)}</p>
${r.notes?.length ? `<h2>Notes</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
${r.error ? `<p><strong>Scan error:</strong> ${esc(r.error)}</p>` : ""}
<h2>What wasn't tested</h2><ul>${(r.notTested.length ? r.notTested : ["Nothing noted."]).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
${r.appModel ? `<h2>What Witness understood the app to be</h2><p>${esc(r.appModel.purpose)}</p>` : ""}
${r.requirements ? requirementsTable(r) : ""}
<h2>Bugs (${bugs.length})</h2>${bugs.length ? bugs.map((f, i) => card(f, i + 1, o)).join("\n") : "<p>None found.</p>"}
<h2>Improvements (${improvements.length})</h2>${improvements.length ? improvements.map((f, i) => card(f, i + 1, o)).join("\n") : "<p>None found.</p>"}
${
  discarded.length
    ? `<h2>Discarded (${discarded.length})</h2><details><summary>Candidates verification set aside, and why</summary><ul>${discarded
        .map((f) => `<li>${esc(f.title)} — ${esc(f.tierReason)}</li>`)
        .join("")}</ul></details>`
    : ""
}
${
  r.journeys.length
    ? `<h2>Journeys and automatic checks (${r.journeys.length})</h2><ul>${r.journeys
        .map(
          (j) =>
            `<li><strong>${esc(j.title)}</strong> (${esc(j.automatic ? "automatic" : j.priority)}): ${esc(j.status)}${j.incompleteReason ? ` — ${esc(j.incompleteReason)}` : ""}; ${(j.steps ?? []).length} steps</li>`,
        )
        .join("")}</ul>`
    : ""
}
<p class="meta">Generated by Witness. Findings are verified by deterministic checks and replays; AI-written wording is fact-checked against the recorded facts.</p>
</body></html>
`;
}
