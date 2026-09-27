// Shared pieces. Severity, tier and verdict are always written as words; colour only reinforces them.
import type { ReactNode } from "react";
import type { Finding, RunResult } from "@witness/engine";
import { SEVERITY_LABEL, TIER_HELP, TIER_LABEL, VERDICT_LABEL } from "@witness/engine/view";

export const btn =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btn} bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500`;
export const btnSecondary = `${btn} border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800`;
export const btnDanger = `${btn} border border-red-300 bg-white text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-stone-900 dark:text-red-300 dark:hover:bg-red-950`;
export const input =
  "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900 placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  critical: "bg-red-700 text-white border-red-700",
  high: "bg-red-50 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
  medium:
    "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  low: "bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-600",
};
const TIER_STYLE: Record<Finding["tier"], string> = {
  confirmed:
    "bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100",
  likely:
    "bg-white text-stone-900 border-stone-500 dark:bg-stone-900 dark:text-stone-100 dark:border-stone-400",
  needs_review:
    "bg-amber-50 text-amber-900 border-amber-400 border-dashed dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700",
  discarded:
    "bg-stone-100 text-stone-500 border-stone-300 line-through dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  evidence_based:
    "bg-sky-50 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  suggestion:
    "bg-violet-50 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
};

export function Pill({
  className,
  children,
  title,
}: {
  className: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-2 py-0.5 text-sm font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Finding["severity"] }) {
  return <Pill className={SEVERITY_STYLE[severity]}>Severity: {SEVERITY_LABEL[severity]}</Pill>;
}

export function TierBadge({ tier }: { tier: Finding["tier"] }) {
  return (
    <Pill className={TIER_STYLE[tier]} title={TIER_HELP[tier]}>
      {TIER_LABEL[tier]}
    </Pill>
  );
}

const VERDICT_STYLE: Record<RunResult["verdict"]["level"], { box: string; mark: string }> = {
  not_ready: { box: "border-red-700 bg-red-50 dark:bg-red-950/60", mark: "✕" },
  caveats: { box: "border-amber-600 bg-amber-50 dark:bg-amber-950/60", mark: "!" },
  ready: { box: "border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60", mark: "✓" },
};

/** The line the presenter reads aloud: big enough to read from across the room. */
export function VerdictBanner({
  verdict,
  cancelled,
}: {
  verdict: RunResult["verdict"];
  cancelled?: boolean;
}) {
  if (cancelled)
    return (
      <section
        className="rounded-xl border-4 border-stone-400 bg-stone-100 p-6 dark:bg-stone-900"
        aria-label="Verdict"
      >
        <p className="text-4xl font-bold">Cancelled</p>
        <p className="mt-2 text-xl">{verdict.reason}</p>
      </section>
    );
  const v = VERDICT_STYLE[verdict.level];
  return (
    <section className={`rounded-xl border-4 p-6 ${v.box}`} aria-label="Verdict">
      <p className="flex items-center gap-4 text-4xl font-bold sm:text-5xl">
        <span
          aria-hidden="true"
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-current text-3xl"
        >
          {v.mark}
        </span>
        <span>Verdict: {VERDICT_LABEL[verdict.level]}</span>
      </p>
      <p className="mt-3 text-xl leading-snug">{verdict.reason}</p>
    </section>
  );
}

export function Section({
  title,
  children,
  id,
  aside,
}: {
  title: string;
  children: ReactNode;
  id?: string;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 pb-2 dark:border-stone-800">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const style = {
    info: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100",
    warn: "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100",
    error:
      "border-red-400 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 ${style}`}
    >
      {children}
    </div>
  );
}

/** Past runs are always labelled with when they ran; only the running scan is "Live". */
export function RunKind({ live, when }: { live: boolean; when: string }) {
  return live ? (
    <Pill className="border-red-600 bg-red-600 text-white">
      <span
        aria-hidden="true"
        className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white"
      />
      Live
    </Pill>
  ) : (
    <Pill className="border-stone-400 bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200">
      Finished run · {when}
    </Pill>
  );
}
