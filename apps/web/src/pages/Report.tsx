// Report (FR-10), in the order Rohit set for the demo: the verdict line, then Requirements coverage and
// Security, then everything else. Always labelled as a finished run with its date and time.
import { useEffect, useState } from "react";
import type { Finding, RunResult } from "@witness/engine";
import {
  CRITERION_LABEL,
  SEVERITY_LABEL,
  TIER_LABEL,
  aiUseLabel,
  issueMarkdown,
  replayText,
  reportView,
  runTimeLabel,
} from "@witness/engine/view";
import { api, ApiError, urls } from "../api";
import {
  btnSecondary,
  input,
  Notice,
  Pill,
  RunKind,
  Section,
  SeverityBadge,
  TierBadge,
  VerdictBanner,
} from "../components/ui";
import { hostOf, originOf, testCommand } from "../format";

type Tab = "bugs" | "review" | "improvements" | "discarded";

export function ReportPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunResult>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("bugs");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRun(undefined);
    setError(undefined);
    api
      .run(runId)
      .then(setRun)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : "Couldn't load this run."),
      );
  }, [runId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!run) return <p className="text-lg">Loading the report…</p>;

  const v = reportView(run);
  const bugs = v.bugs.filter((f) => f.tier !== "needs_review");
  const review = v.bugs.filter((f) => f.tier === "needs_review");
  const lists: Record<Tab, Finding[]> = {
    bugs,
    review,
    improvements: v.improvements,
    discarded: v.discarded,
  };
  const tabOf = (f: Finding): Tab =>
    f.tier === "discarded"
      ? "discarded"
      : f.kind === "improvement"
        ? "improvements"
        : f.tier === "needs_review"
          ? "review"
          : "bugs";
  const show = (f: Finding) => {
    setTab(tabOf(f));
    setOpen((o) => new Set(o).add(f.id));
    requestAnimationFrame(() =>
      document.getElementById(f.id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const mins = (run.stats.durationMs / 60_000).toFixed(1);
  const criteria = run.requirements?.criteria ?? [];
  const byId = new Map(run.findings.map((f) => [f.id, f]));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <RunKind live={false} when={runTimeLabel(run.startedAt)} />
        {run.config.llmCache === "replay" && (
          <Pill className="border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            AI answers replayed from cache
          </Pill>
        )}
        {run.config.pipeline !== "full" && (
          <Pill className="border-stone-400 bg-white text-stone-700 dark:bg-stone-900 dark:text-stone-300">
            Pipeline: {run.config.pipeline}
          </Pill>
        )}
      </div>
      <h1 className="mt-2 text-3xl font-bold">Report: {hostOf(run.config.url)}</h1>
      <p className="mt-1 text-stone-600 dark:text-stone-400">
        {run.config.mode === "production" ? "Production (read-only)" : "Staging"} mode ·{" "}
        {run.config.budget} budget · took {mins} min · {run.stats.pages} pages mapped ·{" "}
        {aiUseLabel(run)}
        {run.config.loggedInAs ? ` · logged in as ${run.config.loggedInAs}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="self-center text-stone-600 dark:text-stone-400">Download:</span>
        <a className={btnSecondary} href={urls.export(run.runId, "html")}>
          HTML report
        </a>
        <a className={btnSecondary} href={urls.export(run.runId, "md")}>
          Markdown
        </a>
        <a className={btnSecondary} href={urls.export(run.runId, "json")}>
          JSON
        </a>
      </div>

      <div className="mt-6">
        <VerdictBanner verdict={run.verdict} cancelled={run.cancelled} />
        <p className="mt-3 text-lg">
          <strong>{v.bugs.length}</strong> bug{v.bugs.length === 1 ? "" : "s"} (Confirmed{" "}
          {v.counts.confirmed}, Likely {v.counts.likely}, Needs review {v.counts.needsReview}) ·{" "}
          <strong>{v.improvements.length}</strong> improvements · {v.discarded.length} set aside by
          verification
        </p>
      </div>

      <Section title="Requirements coverage" id="requirements">
        {criteria.length === 0 ? (
          <p className="text-stone-600 dark:text-stone-400">
            No requirements were given for this scan.
          </p>
        ) : (
          <>
            <p className="mb-3">
              {(["verified", "failed", "not_found", "not_tested"] as const)
                .map(
                  (s) => `${CRITERION_LABEL[s]}: ${criteria.filter((c) => c.status === s).length}`,
                )
                .join(" · ")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <thead>
                  <tr className="border-b-2 border-stone-300 dark:border-stone-700">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Criterion (from the requirements)</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-stone-200 align-top dark:border-stone-800"
                    >
                      <td className="py-2 pr-3 font-mono text-sm">{c.id}</td>
                      <td className="py-2 pr-3">{c.quote}</td>
                      <td className="py-2 pr-3">
                        <CriterionPill status={c.status} />
                      </td>
                      <td className="py-2">
                        {c.reason}
                        {c.findingIds
                          .map((id) => byId.get(id))
                          .filter((f): f is Finding => !!f)
                          .map((f) => (
                            <button key={f.id} className="ml-2 underline" onClick={() => show(f)}>
                              See the finding
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section title="Security" id="security">
        {v.security.length === 0 ? (
          <p className="text-stone-600 dark:text-stone-400">No security findings.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {v.security.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 p-3">
                <button
                  className="min-w-0 flex-1 text-left font-medium underline-offset-2 hover:underline"
                  onClick={() => show(f)}
                >
                  {f.title}
                </button>
                <span className="text-sm text-stone-600 dark:text-stone-400">
                  {f.kind === "bug" ? "Bug" : "Improvement"}
                </span>
                <SeverityBadge severity={f.severity} />
                <TierBadge tier={f.tier} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What wasn't tested">
        <ul className="list-disc space-y-1 pl-6">
          {(run.notTested.length ? run.notTested : ["Nothing noted."]).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        {run.timeCap && run.timeCap.cut.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold">
              What the {Math.round(run.timeCap.capMs / 60_000)}-minute time cap cut
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-6">
              {run.timeCap.cut.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {(run.notes?.length || run.aiStagesSkipped || run.error) && (
          <div className="mt-4 space-y-2">
            {run.error && !run.cancelled && (
              <Notice tone="error">The scan stopped early: {run.error}</Notice>
            )}
            {run.aiStagesSkipped && <Notice tone="warn">{run.aiStagesSkipped}</Notice>}
            {run.notes?.map((n, i) => (
              <Notice key={i}>{n}</Notice>
            ))}
          </div>
        )}
      </Section>

      <Section title="Findings" id="findings">
        <div role="tablist" aria-label="Findings" className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["bugs", "Bugs"],
              ["review", "Needs review"],
              ["improvements", "Improvements"],
              ["discarded", "Discarded"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-md border px-4 py-2 font-medium ${tab === id ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-300 bg-white hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"}`}
            >
              {name} ({lists[id].length})
            </button>
          ))}
        </div>
        <p className="mb-3 text-stone-600 dark:text-stone-400">
          {
            {
              bugs: "Confirmed and Likely bugs, most severe first.",
              review:
                "Something looked wrong but couldn't be verified. A person should look at these.",
              improvements: "Accessibility, speed, security hygiene and UX suggestions.",
              discarded: "Candidates verification set aside, with the reason for each.",
            }[tab]
          }
        </p>
        {lists[tab].length === 0 ? (
          <p>None.</p>
        ) : (
          <div className="space-y-3">
            {lists[tab].map((f) => (
              <FindingCard
                key={f.id}
                run={run}
                f={f}
                open={open.has(f.id)}
                onToggle={() => toggle(f.id)}
              />
            ))}
          </div>
        )}
      </Section>

      {run.appModel && (
        <Section title="What Witness understood the app to be">
          <p>{run.appModel.purpose}</p>
        </Section>
      )}

      {run.journeys.length > 0 && (
        <Section title={`Journeys and automatic checks (${run.journeys.length})`}>
          <ul className="space-y-2">
            {run.journeys.map((j) => (
              <li key={j.id}>
                <span className="font-medium">{j.title}</span>{" "}
                <span className="text-stone-600 dark:text-stone-400">
                  ({j.automatic ? "automatic" : j.priority}) —{" "}
                  {j.status === "completed"
                    ? "completed"
                    : `${j.status}${j.incompleteReason ? `: ${j.incompleteReason}` : ""}`}{" "}
                  · {(j.steps ?? []).length} steps
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function CriterionPill({ status }: { status: "verified" | "failed" | "not_found" | "not_tested" }) {
  const style = {
    verified:
      "border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    failed: "border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200",
    not_found:
      "border-red-400 border-dashed bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200",
    not_tested:
      "border-stone-400 bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  }[status];
  return <Pill className={style}>{CRITERION_LABEL[status]}</Pill>;
}

function FindingCard({
  run,
  f,
  open,
  onToggle,
}: {
  run: RunResult;
  f: Finding;
  open: boolean;
  onToggle: () => void;
}) {
  const [shot, setShot] = useState(true);
  const [copied, setCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [dismiss, setDismiss] = useState<"closed" | "form" | "saving" | "done">("closed");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();
  const dt = "text-sm font-semibold text-stone-600 dark:text-stone-400";
  return (
    <article
      id={f.id}
      className="scroll-mt-4 rounded-lg bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
    >
      <button
        className="flex w-full flex-wrap items-start gap-3 p-4 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span aria-hidden="true" className="mt-1 w-4 text-stone-500">
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold">{f.title}</span>
          <span className="mt-1 block text-stone-700 dark:text-stone-300">{f.impact}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          {f.kind === "bug" && <SeverityBadge severity={f.severity} />}
          <TierBadge tier={f.tier} />
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-stone-200 p-4 dark:border-stone-800">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
            <dt className={dt}>Where</dt>
            <dd className="font-mono text-sm">
              {f.route}
              {f.instances.length > 1 ? ` (and ${f.instances.length - 1} more places)` : ""}
            </dd>
            <dt className={dt}>Why {TIER_LABEL[f.tier]}</dt>
            <dd>{f.tierReason}</dd>
            <dt className={dt}>Why flagged</dt>
            <dd>{f.whyFlagged}</dd>
            {f.kind === "bug" && (
              <>
                <dt className={dt}>Expected</dt>
                <dd>{f.expected}</dd>
                <dt className={dt}>Actual</dt>
                <dd>{f.actual}</dd>
              </>
            )}
            {f.likelyCause && (
              <>
                <dt className={dt}>Likely cause</dt>
                <dd>
                  <Pill className="mr-2 border-stone-400 bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                    Hypothesis
                  </Pill>
                  {f.likelyCause.text}
                </dd>
              </>
            )}
            <dt className={dt}>Replay</dt>
            <dd>
              {replayText(f.replay)}
              {f.replay.notes && (
                <span className="block text-sm text-stone-600 dark:text-stone-400">
                  {f.replay.notes}
                </span>
              )}
            </dd>
            {f.skeptic && (
              <>
                <dt className={dt}>Second opinion</dt>
                <dd>{f.skeptic.reason}</dd>
              </>
            )}
          </dl>
          {f.steps.length > 0 && (
            <div>
              <h3 className="font-semibold">Steps to reproduce</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-6">
                {f.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {shot && (
            <img
              src={urls.screenshot(run.runId, f.id)}
              alt={`Screenshot: ${f.title}`}
              loading="lazy"
              onError={() => setShot(false)}
              className="max-h-[32rem] rounded border border-stone-200 dark:border-stone-700"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {f.testFile && (
              <a className={btnSecondary} href={urls.test(run.runId, f.id)} download={f.testFile}>
                Download test
              </a>
            )}
            {f.testFile && (
              <button
                className={btnSecondary}
                onClick={() =>
                  void navigator.clipboard.writeText(testCommand(run.runId, f.testFile ?? "")).then(
                    () => {
                      setCmdCopied(true);
                      setTimeout(() => setCmdCopied(false), 2000);
                    },
                    () => setErr("Couldn't copy to the clipboard."),
                  )
                }
              >
                {cmdCopied ? "Copied" : "Copy test command"}
              </button>
            )}
            <button
              className={btnSecondary}
              onClick={() =>
                void navigator.clipboard.writeText(issueMarkdown(f, run)).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => setErr("Couldn't copy to the clipboard."),
                )
              }
            >
              {copied ? "Copied" : "Copy as issue"}
            </button>
            {f.tier !== "discarded" && dismiss === "closed" && (
              <button className={btnSecondary} onClick={() => setDismiss("form")}>
                Not a bug
              </button>
            )}
          </div>
          {(dismiss === "form" || dismiss === "saving") && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const origin = originOf(run.scope) ?? run.scope;
                setDismiss("saving");
                api.suppress(origin, f.fingerprint, reason.trim()).then(
                  () => setDismiss("done"),
                  (x: unknown) => {
                    setErr(x instanceof ApiError ? x.message : "Couldn't save that.");
                    setDismiss("form");
                  },
                );
              }}
            >
              <label className="min-w-64 flex-1">
                <span className="text-sm font-medium">Why isn't it a bug?</span>
                <input
                  className={`${input} mt-1`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. intended: the minimum booking is 2 hours"
                  minLength={3}
                  maxLength={300}
                  required
                />
              </label>
              <button
                className={btnSecondary}
                disabled={reason.trim().length < 3 || dismiss === "saving"}
              >
                Save
              </button>
              <button type="button" className={btnSecondary} onClick={() => setDismiss("closed")}>
                Cancel
              </button>
            </form>
          )}
          {dismiss === "done" && (
            <Notice>
              Marked as not a bug. Future scans of {hostOf(run.scope)} will list it under Discarded.
            </Notice>
          )}
          {err && <Notice tone="error">{err}</Notice>}
          <p className="text-xs text-stone-500">
            {f.id} · {f.fingerprint} · {SEVERITY_LABEL[f.severity]} · {f.category}
          </p>
        </div>
      )}
    </article>
  );
}
