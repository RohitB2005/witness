// History: every past run, labelled with its date and time. Only the scan running now is marked Live.
import { useEffect, useState } from "react";
import type { RunSummary } from "@witness/engine";
import { VERDICT_LABEL, runTimeLabel } from "@witness/engine/view";
import { api, type LiveInfo } from "../api";
import { Link } from "../router";
import { Notice, RunKind } from "../components/ui";
import { duration, hostOf } from "../format";

type Row = RunSummary & { live: boolean };

function result(r: Row): string {
  if (r.live) return "Running now";
  if (r.cancelled) return "Cancelled";
  if (r.error && r.verdict) return `Stopped early — ${VERDICT_LABEL[r.verdict.level]}`;
  if (r.verdict) return VERDICT_LABEL[r.verdict.level];
  return "Didn't finish (no result saved)";
}

export function HistoryPage() {
  const [rows, setRows] = useState<Row[]>();
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .runs()
      .then((r) => {
        setRows(r.runs);
        setLive(r.live);
      })
      .catch(() => setError("Couldn't reach the Witness server."));
  }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!rows) return <p>Loading…</p>;
  const liveRow = live && !rows.some((r) => r.runId === live.runId);
  return (
    <div>
      <h1 className="text-3xl font-bold">History</h1>
      <p className="mt-1 text-stone-600 dark:text-stone-400">
        Every scan on this machine, newest first. Past runs are records: each shows when it ran.
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-stone-300 dark:border-stone-700">
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">App</th>
              <th className="py-2 pr-3">Result</th>
              <th className="py-2 pr-3">Bugs (Confirmed / Likely / Needs review)</th>
              <th className="py-2 pr-3">Took</th>
              <th className="py-2">Budget</th>
            </tr>
          </thead>
          <tbody>
            {liveRow && (
              <tr className="border-b border-stone-200 dark:border-stone-800">
                <td className="py-2 pr-3">
                  <RunKind live when="" />
                </td>
                <td className="py-2 pr-3">{hostOf(live.url)}</td>
                <td className="py-2 pr-3">
                  <Link className="underline" to={`/runs/${live.runId}/live`}>
                    Watch it
                  </Link>
                </td>
                <td className="py-2 pr-3">–</td>
                <td className="py-2 pr-3">–</td>
                <td className="py-2">{live.budget}</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.runId}
                className="border-b border-stone-200 align-top dark:border-stone-800"
              >
                <td className="py-2 pr-3 whitespace-nowrap">
                  {r.live ? <RunKind live when="" /> : runTimeLabel(r.startedAt)}
                </td>
                <td className="py-2 pr-3">{hostOf(r.url)}</td>
                <td className="py-2 pr-3">
                  {r.live || r.verdict ? (
                    <Link
                      className="font-medium underline"
                      to={r.live ? `/runs/${r.runId}/live` : `/runs/${r.runId}`}
                    >
                      {result(r)}
                    </Link>
                  ) : (
                    <span className="text-stone-600 dark:text-stone-400">{result(r)}</span>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {r.bugs ? `${r.bugs.confirmed} / ${r.bugs.likely} / ${r.bugs.needsReview}` : "–"}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {r.durationMs !== undefined ? duration(r.durationMs) : "–"}
                </td>
                <td className="py-2">
                  {r.budget ?? "–"}
                  {r.pipeline && r.pipeline !== "full" && (
                    <span className="block text-sm text-stone-500">
                      {r.pipeline === "deterministic" ? "no AI" : r.pipeline}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
