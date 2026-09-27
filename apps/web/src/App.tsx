import { useEffect, useState } from "react";
import { api, type LiveInfo } from "./api";
import { Link, usePath } from "./router";
import { NewScanPage } from "./pages/NewScan";
import { LivePage } from "./pages/Live";
import { ReportPage } from "./pages/Report";
import { HistoryPage } from "./pages/History";
import { EvaluationPage } from "./pages/Evaluation";
import { hostOf } from "./format";

/** The scan running now, if any (polled, so every page can point to it). */
function useLive(): LiveInfo | null {
  const [live, setLive] = useState<LiveInfo | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = () =>
      api
        .runs()
        .then((r) => !stop && setLive(r.live))
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 4_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return live;
}

export function App() {
  const path = usePath();
  const live = useLive();
  const m = /^\/runs\/([^/]+)(\/live)?$/.exec(path);
  let page;
  if (m) page = m[2] ? <LivePage runId={m[1]!} /> : <ReportPage runId={m[1]!} />;
  else if (path === "/history") page = <HistoryPage />;
  else if (path === "/evaluation") page = <EvaluationPage />;
  else page = <NewScanPage live={live} />;

  const nav = (to: string, label: string) => (
    <Link
      to={to}
      className={`rounded-md px-3 py-1.5 hover:bg-stone-200 dark:hover:bg-stone-800 ${path === to ? "bg-stone-200 font-semibold dark:bg-stone-800" : ""}`}
      aria-current={path === to ? "page" : undefined}
    >
      {label}
    </Link>
  );
  const watching = m?.[2] && m[1] === live?.runId;
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="text-xl font-bold tracking-tight">
            Witness
          </Link>
          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {nav("/", "New scan")}
            {nav("/history", "History")}
            {nav("/evaluation", "Evaluation")}
          </nav>
          {live && !watching && (
            <Link
              to={`/runs/${live.runId}/live`}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
            >
              <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-white" />
              Scan running now: {hostOf(live.url)} — watch it
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{page}</main>
    </div>
  );
}
