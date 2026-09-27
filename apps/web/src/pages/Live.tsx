// Live run (FR-13). Only the scan running now is shown as live; a finished run's page says when it ran and
// points to its report instead of replaying its events as if they were happening.
import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Journey, WitnessEvent } from "@witness/engine";
import { PHASES, PHASE_LABEL, TIER_LABEL, runTimeLabel } from "@witness/engine/view";
import { api, urls, type LiveInfo } from "../api";
import { Link, navigate } from "../router";
import { initialLiveState, liveReducer, stepParts, type LiveState } from "../live-state";
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  Notice,
  RunKind,
  TierBadge,
  VerdictBanner,
} from "../components/ui";
import { duration, hostOf, money } from "../format";

type Stream = { status: "connecting" | "live" | "finished" | "missing" | "lost" };

function useRunStream(runId: string): [LiveState, Stream] {
  const [state, dispatch] = useReducer(
    (s: LiveState, a: WitnessEvent | "reset") =>
      a === "reset" ? initialLiveState : liveReducer(s, a),
    initialLiveState,
  );
  const [stream, setStream] = useState<Stream>({ status: "connecting" });
  useEffect(() => {
    dispatch("reset");
    setStream({ status: "connecting" });
    const es = new EventSource(urls.events(runId));
    let live = false;
    es.addEventListener("hello", (m) => {
      live = (JSON.parse((m as MessageEvent<string>).data) as { live: boolean }).live;
      if (!live) {
        // A finished run: don't stream its record as if it were happening now.
        setStream({ status: "finished" });
        es.close();
      } else setStream({ status: "live" });
    });
    es.onmessage = (m: MessageEvent<string>) => {
      if (live) dispatch(JSON.parse(m.data) as WitnessEvent);
    };
    es.addEventListener("end", () => {
      setStream({ status: "finished" });
      es.close();
    });
    es.addEventListener("missing", () => {
      setStream({ status: "missing" });
      es.close();
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED)
        setStream((s) => (s.status === "live" ? { status: "lost" } : s));
    };
    return () => es.close();
  }, [runId]);
  return [state, stream];
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function LivePage({ runId }: { runId: string }) {
  const [state, stream] = useRunStream(runId);
  const [info, setInfo] = useState<LiveInfo | null>(null);
  /** When the run started: how every past run is labelled (History, Report). */
  const [startedAt, setStartedAt] = useState<string>();
  const now = useNow();

  useEffect(() => {
    api
      .runs()
      .then((r) => {
        if (r.live?.runId === runId) setInfo(r.live);
        const past = r.runs.find((x) => x.runId === runId);
        if (past) setStartedAt(past.startedAt);
      })
      .catch(() => undefined);
  }, [runId, stream.status]);

  if (stream.status === "missing")
    return <Notice tone="error">There's no run with the ID {runId}.</Notice>;

  // A run that isn't running now: never shown as live.
  if (stream.status === "finished" && !state.verdict) {
    return (
      <div className="max-w-3xl space-y-4">
        <RunKind live={false} when={startedAt ? runTimeLabel(startedAt) : "earlier"} />
        <h1 className="text-3xl font-bold">This run has finished</h1>
        <p className="text-lg">It isn't running now, so there's nothing live to watch.</p>
        <Link to={`/runs/${runId}`} className={btnPrimary}>
          Open its report
        </Link>
      </div>
    );
  }

  const elapsed = info ? now - Date.parse(info.startedAt) : 0;
  const finished = !!state.verdict || stream.status === "finished";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {finished ? (
              <RunKind
                live={false}
                when={
                  startedAt
                    ? runTimeLabel(startedAt)
                    : info
                      ? runTimeLabel(info.startedAt)
                      : "just now"
                }
              />
            ) : (
              <RunKind live when="" />
            )}
            {info && (
              <span className="text-stone-600 dark:text-stone-400">
                {info.mode === "production" ? "Production (read-only)" : "Staging"} · {info.budget}{" "}
                budget
              </span>
            )}
          </div>
          <h1 className="mt-2 text-3xl font-bold">
            {finished ? "Finished scanning" : "Scanning"} {info ? hostOf(info.url) : ""}
          </h1>
          {info?.llmCache === "replay" && (
            <p className="mt-1 font-medium text-amber-800 dark:text-amber-300">
              AI answers are replayed from the cache recorded earlier, not sent to the AI. The app
              itself is being tested now.
            </p>
          )}
        </div>
        {!finished && info && (
          <div className="flex flex-wrap items-center gap-6">
            <Meter
              label="Time"
              value={duration(elapsed)}
              of={`of ${duration(info.capMs)} max`}
              fraction={elapsed / info.capMs}
            />
            <Meter
              label="AI spend"
              value={money(state.cost.costUsd)}
              of={`cap ${money(info.costCapUsd)}`}
              fraction={state.cost.costUsd / info.costCapUsd}
            />
            <button
              className={btnDanger}
              onClick={() => {
                if (confirm("Stop this scan? Nothing will be reported."))
                  void api.cancel(runId).catch(() => undefined);
              }}
            >
              Cancel scan
            </button>
          </div>
        )}
      </div>

      {stream.status === "lost" && (
        <Notice tone="warn">
          Lost the connection to the Witness server. Reload the page to reconnect.
        </Notice>
      )}

      <PhaseStepper state={state} />

      <p
        aria-live="polite"
        className="rounded-lg bg-white p-4 text-xl font-medium shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
      >
        <span className="mr-2 text-stone-500">Now:</span>
        {state.now}
      </p>

      {state.verdict && (
        <div className="space-y-3">
          <VerdictBanner
            verdict={state.verdict}
            cancelled={state.error === "The scan was cancelled."}
          />
          <button
            className={`${btnPrimary} px-6 py-3 text-lg`}
            onClick={() => navigate(`/runs/${runId}`)}
          >
            Open the full report
          </button>
        </div>
      )}
      {state.error && !state.verdict && <Notice tone="error">{state.error}</Notice>}

      {state.plan && <PlanCard runId={runId} state={state} now={now} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={`Pages found (${state.pages.length})`}>
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {state.pages.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                {p.thumb && (
                  <img
                    src={urls.artifact(runId, p.thumb)}
                    alt=""
                    loading="lazy"
                    className="h-12 w-20 shrink-0 rounded border border-stone-200 object-cover object-top dark:border-stone-700"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm">{p.route}</span>
                  <span className="block truncate text-sm text-stone-600 dark:text-stone-400">
                    {p.title}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={`What Witness did (${state.steps.length} actions)`}>
          <ol className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {[...state.steps]
              .reverse()
              .slice(0, 40)
              .map((s) => (
                <li key={s.id} className="flex items-start gap-3">
                  {s.thumb ? (
                    <img
                      src={urls.artifact(runId, s.thumb)}
                      alt=""
                      loading="lazy"
                      className="h-12 w-20 shrink-0 rounded border border-stone-200 object-cover object-top dark:border-stone-700"
                    />
                  ) : (
                    <span className="h-12 w-20 shrink-0" />
                  )}
                  <span className="text-sm">
                    <span
                      className={`mr-1 font-semibold ${s.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
                    >
                      {s.ok ? "✓" : "✗"} {stepParts(s.description, s.ok).label}
                    </span>
                    {s.kind === "edge" && (
                      <span className="mr-1 text-stone-500">[unusual input]</span>
                    )}
                    {stepParts(s.description, s.ok).text}
                  </span>
                </li>
              ))}
          </ol>
        </Panel>
        <Panel title={`Findings being double-checked (${state.candidates.length})`}>
          <ul className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {state.candidates.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-stone-200 p-2 text-sm dark:border-stone-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{c.summary}</span>
                  {c.tier ? (
                    <TierBadge tier={c.tier} />
                  ) : (
                    <span className="shrink-0 text-stone-500">checking…</span>
                  )}
                </div>
                {c.progress.length > 0 && (
                  <p className="mt-1 text-stone-600 dark:text-stone-400">{c.progress.at(-1)}</p>
                )}
                {c.tier === "discarded" && c.reason && (
                  <p className="mt-1 text-stone-700 dark:text-stone-300">
                    <span className="font-medium">Why {TIER_LABEL.discarded.toLowerCase()}:</span>{" "}
                    {c.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {state.warnings.length > 0 && (
        <details className="text-sm text-stone-600 dark:text-stone-400">
          <summary className="cursor-pointer">Technical notes ({state.warnings.length})</summary>
          <ul className="mt-2 list-disc pl-6">
            {state.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Meter({
  label,
  value,
  of,
  fraction,
}: {
  label: string;
  value: string;
  of: string;
  fraction: number;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(fraction * 100)));
  return (
    <div className="w-40">
      <div className="text-sm text-stone-600 dark:text-stone-400">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-stone-600 dark:text-stone-400">{of}</div>
      <div className="mt-1 h-1.5 rounded bg-stone-200 dark:bg-stone-800" role="presentation">
        <div className="h-1.5 rounded bg-teal-700 dark:bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function PhaseStepper({ state }: { state: LiveState }) {
  const current = state.phase;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Progress">
      {PHASES.map((p) => {
        const seen = state.phasesSeen.includes(p);
        const isNow = current === p && p !== "done";
        const done = seen && !isNow;
        // After the scan, a phase that never ran (e.g. no AI) was skipped, not "next".
        const skipped = !seen && current === "done";
        return (
          <li
            key={p}
            aria-current={isNow ? "step" : undefined}
            className={`rounded-md border px-3 py-2 text-sm ${
              isNow
                ? "border-teal-700 bg-teal-50 font-semibold dark:border-teal-500 dark:bg-teal-950/50"
                : done
                  ? "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
                  : "border-dashed border-stone-300 text-stone-500 dark:border-stone-700"
            }`}
          >
            <span className="block text-xs uppercase tracking-wide">
              {isNow ? "Now" : done ? "Done" : skipped ? "Skipped" : "Next"}
            </span>
            {PHASE_LABEL[p]}
          </li>
        );
      })}
    </ol>
  );
}

function PlanCard({ runId, state, now }: { runId: string; state: LiveState; now: number }) {
  const plan = state.plan!;
  const journeys = plan.journeys.filter((j) => !j.automatic);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(journeys.map((j) => j.id)));
  const [sent, setSent] = useState(false);
  const left = plan.receivedAt + plan.autoApproveInMs - now;
  const reviewing = plan.autoApproveInMs > 0 && !sent && left > 0 && state.phase === "plan";
  const status = useMemo(() => state.journeyStatus, [state.journeyStatus]);
  const statusWord = (j: Journey) => {
    const s = status[j.id] ?? j.status;
    return s === "completed"
      ? "Done"
      : s === "running"
        ? "Testing now"
        : s === "skipped"
          ? "Skipped"
          : s === "incomplete"
            ? "Stopped early"
            : s === "approved"
              ? "Waiting"
              : s;
  };
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">The plan: {journeys.length} journeys to test</h2>
        {reviewing && (
          <span className="text-stone-600 dark:text-stone-400">
            Starting automatically in{" "}
            {Math.min(Math.ceil(left / 1000), Math.round(plan.autoApproveInMs / 1000))} s
          </span>
        )}
      </div>
      <ul className="mt-3 space-y-3">
        {journeys.map((j) => (
          <li key={j.id} className="flex items-start gap-3">
            {reviewing ? (
              <input
                type="checkbox"
                className="mt-1.5"
                aria-label={`Test "${j.title}"`}
                checked={picked.has(j.id)}
                onChange={(e) => {
                  const n = new Set(picked);
                  if (e.target.checked) n.add(j.id);
                  else n.delete(j.id);
                  setPicked(n);
                }}
              />
            ) : (
              <span className="mt-0.5 w-28 shrink-0 text-sm font-medium text-stone-600 dark:text-stone-400">
                {statusWord(j)}
              </span>
            )}
            <div>
              <p className="font-medium">
                {j.title}{" "}
                <span className="text-sm font-normal text-stone-500">
                  ({j.priority === "core" ? "core" : "secondary"})
                </span>
              </p>
              <p className="text-stone-700 dark:text-stone-300">{j.goal}</p>
              {j.expectations.length > 0 && (
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer text-stone-600 dark:text-stone-400">
                    {j.expectations.length} thing{j.expectations.length === 1 ? "" : "s"} it will
                    check
                  </summary>
                  <ul className="mt-1 list-disc pl-6">
                    {j.expectations.map((x) => (
                      <li key={x.id}>
                        {x.statement}
                        {x.grounding.kind === "ui_text" && (
                          <span className="text-stone-500">
                            {" "}
                            — from the page: “{x.grounding.quote}”
                          </span>
                        )}
                        {x.grounding.kind === "requirement" && (
                          <span className="text-stone-500"> — from the requirements</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
      {reviewing && (
        <div className="mt-4 flex gap-3">
          <button
            className={btnPrimary}
            onClick={() => {
              setSent(true);
              void api.approve(runId, [...picked]).catch(() => undefined);
            }}
          >
            Start testing {picked.size === journeys.length ? "all" : `${picked.size}`}
          </button>
          <button
            className={btnSecondary}
            onClick={() => setPicked(new Set(journeys.map((j) => j.id)))}
          >
            Select all
          </button>
        </div>
      )}
    </section>
  );
}
