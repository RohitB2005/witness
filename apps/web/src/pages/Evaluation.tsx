// Evaluation: the latest scored results (eval/results/**/summary.json). Recorded numbers, labelled with the
// folder and when they were scored. Charts are plain SVG bars (no chart library, DEVLOG).
import { useEffect, useState } from "react";
import { runTimeLabel } from "@witness/engine/view";
import { api, ApiError, type EvalSummary } from "../api";
import { Notice, Section } from "../components/ui";
import { mean, money, pct } from "../format";

const PIPELINE_NAME: Record<string, string> = {
  full: "Witness (full verification)",
  "full-no-skeptic (derived)": "Without the skeptic",
  "ai-no-verify (derived)": "Trusting the AI (no verification)",
  deterministic: "Deterministic checks only (no AI)",
};

/** One measure per chart, one hue, a value label on each bar, and a hover title. */
function Bars({ rows, label }: { rows: { name: string; value: number | null }[]; label: string }) {
  const rowH = 34;
  const labelW = 250;
  const barW = 360;
  const h = rows.length * rowH + 8;
  return (
    <svg
      viewBox={`0 0 ${labelW + barW + 60} ${h}`}
      className="w-full max-w-3xl"
      role="img"
      aria-label={label}
    >
      <line
        x1={labelW}
        x2={labelW}
        y1={0}
        y2={h}
        className="stroke-stone-300 dark:stroke-stone-700"
        strokeWidth={1}
      />
      {rows.map((r, i) => {
        const y = i * rowH + 6;
        const w = r.value === null ? 0 : Math.max(2, r.value * barW);
        return (
          <g key={r.name}>
            <title>{`${r.name}: ${pct(r.value)}`}</title>
            <rect
              x={0}
              y={y - 4}
              width={labelW + barW + 60}
              height={rowH}
              className="fill-transparent hover:fill-stone-100 dark:hover:fill-stone-800"
            />
            <text
              x={labelW - 10}
              y={y + 15}
              textAnchor="end"
              className="fill-stone-800 text-[13px] dark:fill-stone-200"
            >
              {r.name}
            </text>
            {r.value !== null && (
              <rect
                x={labelW}
                y={y + 4}
                width={w}
                height={16}
                rx={4}
                className="fill-teal-700 dark:fill-teal-500"
              />
            )}
            <text
              x={labelW + w + 8}
              y={y + 17}
              className="fill-stone-700 text-[13px] font-semibold dark:fill-stone-300"
            >
              {pct(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function EvaluationPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.evalLatest>>>();
  const [error, setError] = useState<string>();
  const load = (p?: string) =>
    api
      .evalLatest(p)
      .then(setData, (e: unknown) =>
        setError(e instanceof ApiError ? e.message : "Couldn't load results."),
      );
  useEffect(() => {
    void load();
  }, []);
  if (error) return <Notice tone="warn">{error}</Notice>;
  if (!data) return <p>Loading…</p>;
  const s: EvalSummary = data.summary;
  const pipes = Object.entries(s.pipelines);
  const name = (p: string) => PIPELINE_NAME[p] ?? p;
  const sumOr = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);

  return (
    <div>
      <h1 className="text-3xl font-bold">Evaluation</h1>
      <p className="mt-1 text-stone-600 dark:text-stone-400">
        Recorded results from <code>eval/results/{data.path}</code>, scored{" "}
        {runTimeLabel(s.generatedAt)}
        {s.benchCommit ? ` (bench commit ${s.benchCommit})` : ""}. These are saved numbers, not a
        live run.
      </p>
      {s.unlabelled > 0 && (
        <p className="mt-2 text-amber-800 dark:text-amber-300">
          {s.unlabelled} finding{s.unlabelled === 1 ? " isn't" : "s aren't"} labelled in this
          scoring, so precision here is provisional (a finding that matches the other bug list shows
          as unlabelled).
        </p>
      )}
      {data.available.length > 1 && (
        <label className="mt-3 block">
          <span className="mr-2 font-medium">Show:</span>
          <select
            className="rounded-md border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-900"
            value={data.path}
            onChange={(e) => void load(e.target.value)}
          >
            {data.available.map((a) => (
              <option key={a.path} value={a.path}>
                {a.path} ({a.generatedAt.slice(0, 10)})
              </option>
            ))}
          </select>
        </label>
      )}

      <Section title="Recall: seeded bugs found (Confirmed or Likely)">
        <p className="mb-2 text-stone-600 dark:text-stone-400">
          Average over the buggy-bench runs.
        </p>
        <Bars
          label="Recall by pipeline"
          rows={pipes.map(([p, v]) => ({ name: name(p), value: mean(v.recall.confirmedLikely) }))}
        />
      </Section>

      <Section title="Bug precision: reported bugs that are real">
        <p className="mb-2 text-stone-600 dark:text-stone-400">
          Confirmed and Likely bugs only; runs with no reported bugs don't count.
        </p>
        <Bars
          label="Bug precision by pipeline"
          rows={pipes.map(([p, v]) => ({ name: name(p), value: mean(v.precision.bugs) }))}
        />
      </Section>

      <Section title="All numbers">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-stone-300 dark:border-stone-700">
                <th className="py-2 pr-3">Pipeline</th>
                <th className="py-2 pr-3">Runs</th>
                <th className="py-2 pr-3">Recall C</th>
                <th className="py-2 pr-3">Recall C+L</th>
                <th className="py-2 pr-3">Bug precision</th>
                <th className="py-2 pr-3">False bugs on the clean build</th>
                <th className="py-2 pr-3">Avg minutes</th>
                <th className="py-2">Avg cost</th>
              </tr>
            </thead>
            <tbody>
              {pipes.map(([p, v]) => {
                const fp = sumOr(v.cleanFalsePositives);
                const mins = mean(v.minutes);
                const cost = mean(v.costUsd);
                return (
                  <tr key={p} className="border-b border-stone-200 dark:border-stone-800">
                    <td className="py-2 pr-3">{name(p)}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.runs}</td>
                    <td className="py-2 pr-3 tabular-nums">{pct(mean(v.recall.confirmed))}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {pct(mean(v.recall.confirmedLikely))}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{pct(mean(v.precision.bugs))}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {fp === null
                        ? "–"
                        : `${fp} over ${v.cleanFalsePositives.length} run${v.cleanFalsePositives.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {mins === null ? "–" : mins.toFixed(1)}
                    </td>
                    <td className="py-2 tabular-nums">{cost === null ? "–" : money(cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Recall by kind of bug (full pipeline)">
        <Bars
          label="Recall by category"
          rows={Object.entries(s.recallByCategory).map(([k, v]) => ({ name: k, value: v }))}
        />
      </Section>

      <Section title="Each seeded bug">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-stone-300 dark:border-stone-700">
                <th className="py-2 pr-3">Bug</th>
                <th className="py-2 pr-3">Found in each buggy run</th>
                <th className="py-2 pr-3">Best tier</th>
                <th className="py-2">Expected tier</th>
              </tr>
            </thead>
            <tbody>
              {s.perBug.map((b) => (
                <tr key={b.id} className="border-b border-stone-200 dark:border-stone-800">
                  <td className="py-1.5 pr-3 font-mono">{b.id}</td>
                  <td className="py-1.5 pr-3">
                    {b.found.map((f, i) => (
                      <span key={i} className="mr-2">
                        {f ? "✓ found" : "· missed"}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 pr-3">{b.bestTier ?? "not found"}</td>
                  <td className="py-1.5">{b.expectedTier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-stone-600 dark:text-stone-400">
          Decoys (intended behaviour) flagged:{" "}
          {Object.values(s.decoysFlagged).reduce((a, b) => a + b, 0)} · Findings still waiting for a
          label: {s.unlabelled}
        </p>
      </Section>
    </div>
  );
}
