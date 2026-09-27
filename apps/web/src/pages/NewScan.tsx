// New scan (FR-1, ADDENDUM A5): URL, mode with its warning, test account, hint, requirements, budget.
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type LiveInfo, type NewScanBody, type Suppression } from "../api";
import { navigate, Link } from "../router";
import { btnPrimary, input, Notice } from "../components/ui";
import { originOf } from "../format";

const BUDGETS = [
  { id: "quick", label: "Quick", detail: "About 3 minutes · 2 journeys · AI spend up to $0.50" },
  { id: "standard", label: "Standard", detail: "Up to 8 minutes · 3 journeys · AI spend up to $2" },
  { id: "deep", label: "Deep", detail: "Up to 15 minutes · 8 journeys · AI spend up to $5" },
] as const;

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|local|test)$/;
const isLocal = (url: string) => {
  try {
    return LOCAL.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Remembered between visits (never the password). */
const REMEMBER = "witness.newScan";
type Remembered = Pick<NewScanBody, "url" | "mode" | "budget" | "username" | "hint">;
function remembered(): Partial<Remembered> {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER) ?? "{}") as Partial<Remembered>;
  } catch {
    return {};
  }
}

export function NewScanPage({ live }: { live: LiveInfo | null }) {
  const q = new URLSearchParams(location.search);
  const saved = remembered();
  const [url, setUrl] = useState(q.get("url") ?? saved.url ?? "http://localhost:5180");
  const [mode, setMode] = useState<NewScanBody["mode"]>(
    (q.get("mode") as NewScanBody["mode"] | null) ?? saved.mode ?? "staging",
  );
  const [budget, setBudget] = useState<NewScanBody["budget"]>(
    (q.get("budget") as NewScanBody["budget"] | null) ?? saved.budget ?? "standard",
  );
  const [username, setUsername] = useState(q.get("user") ?? saved.username ?? "");
  const [password, setPassword] = useState("");
  const [hint, setHint] = useState(saved.hint ?? "");
  const [requirements, setRequirements] = useState("");
  const [reqFile, setReqFile] = useState<string>();
  const [confirmStaging, setConfirmStaging] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [suppressed, setSuppressed] = useState<Suppression[]>([]);

  const needsConfirm = mode === "staging" && !!url && !isLocal(url);
  const origin = originOf(url);

  useEffect(() => {
    if (!origin) return setSuppressed([]);
    const t = setTimeout(() => {
      api
        .suppressions(origin)
        .then((r) => setSuppressed(r.suppressions))
        .catch(() => setSuppressed([]));
    }, 300);
    return () => clearTimeout(t);
  }, [origin]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      setError("Requirements must be a .md or .txt file.");
      return;
    }
    const text = await file.text();
    if (text.length > 5000) {
      setError(`That file has ${text.length.toLocaleString()} characters; the limit is 5,000.`);
      return;
    }
    setError(undefined);
    setRequirements(text);
    setReqFile(file.name);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (needsConfirm && !confirmStaging) {
      setError(
        "Confirm that this site is a test copy Witness may change, or choose Production (read-only).",
      );
      return;
    }
    setBusy(true);
    try {
      localStorage.setItem(
        REMEMBER,
        JSON.stringify({ url, mode, budget, username, hint } satisfies Remembered),
      );
    } catch {
      // Private window: nothing to remember.
    }
    try {
      const { runId } = await api.start({
        url: url.trim(),
        mode,
        budget,
        ...(username.trim() ? { username: username.trim(), password } : {}),
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(requirements.trim() ? { requirements } : {}),
        ...(needsConfirm ? { confirmStagingOnNonLocal: confirmStaging } : {}),
        ...(offline ? { llmCache: "replay" as const } : {}),
      });
      setPassword("");
      navigate(`/runs/${runId}/live`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the Witness server.");
      setBusy(false);
    }
  };

  const label = "block font-medium";
  const help = "mt-1 text-sm text-stone-600 dark:text-stone-400";
  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Test a web app</h1>
      <p className="mt-2 text-lg text-stone-700 dark:text-stone-300">
        Witness maps the app, tries its main journeys like a careful tester, and reports only what
        it can check and repeat.
      </p>
      {live && (
        <div className="mt-4">
          <Notice tone="warn">
            A scan is already running.{" "}
            <Link className="font-medium underline" to={`/runs/${live.runId}/live`}>
              Watch it
            </Link>{" "}
            — a new one can start when it finishes.
          </Notice>
        </div>
      )}
      <form onSubmit={submit} className="mt-6 space-y-6" noValidate>
        <div>
          <label className={label} htmlFor="url">
            App address
          </label>
          <input
            id="url"
            className={`${input} mt-1 text-lg`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://staging.example.com"
            required
            inputMode="url"
            autoComplete="off"
          />
          {suppressed.length > 0 && (
            <p className={help}>
              {suppressed.length} finding{suppressed.length === 1 ? " is" : "s are"} marked “Not a
              bug” for this app and will be listed under Discarded.
            </p>
          )}
        </div>

        <fieldset>
          <legend className={label}>Mode</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(
              [
                [
                  "staging",
                  "Staging",
                  "Witness may submit forms and change data. For test copies only.",
                ],
                [
                  "production",
                  "Production (read-only)",
                  "Every form submission and data change is blocked, except logging in.",
                ],
              ] as const
            ).map(([id, name, desc]) => (
              <label
                key={id}
                className={`cursor-pointer rounded-lg border-2 p-3 ${mode === id ? "border-teal-700 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40" : "border-stone-200 dark:border-stone-700"}`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={id}
                  checked={mode === id}
                  onChange={() => setMode(id)}
                  className="mr-2"
                />
                <span className="font-medium">{name}</span>
                <span className="mt-1 block text-sm text-stone-600 dark:text-stone-400">
                  {desc}
                </span>
              </label>
            ))}
          </div>
          {needsConfirm && (
            <div className="mt-3">
              <Notice tone="warn">
                <p className="font-medium">
                  This isn’t a local address, and Staging mode can change its data.
                </p>
                <label className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={confirmStaging}
                    onChange={(e) => setConfirmStaging(e.target.checked)}
                    className="mt-1"
                  />
                  <span>I confirm this is a test copy that Witness may change.</span>
                </label>
              </Notice>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className={label}>Test account (optional)</legend>
          <p className={help}>
            The password stays in memory for this scan only. It is never saved, logged or shown to
            the AI.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input
              className={input}
              aria-label="Username or email"
              placeholder="Username or email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <input
              className={input}
              aria-label="Password"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </fieldset>

        <div>
          <label className={label} htmlFor="hint">
            What is the app for? (optional)
          </label>
          <input
            id="hint"
            className={`${input} mt-1`}
            maxLength={200}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="e.g. customers book and manage home cleaning"
          />
        </div>

        <div>
          <label className={label} htmlFor="req">
            Requirements (optional)
          </label>
          <p className={help}>
            Paste acceptance criteria, or upload a .md or .txt file. Each criterion is reported as
            Verified, Failed, Not found or Not tested.
          </p>
          <textarea
            id="req"
            className={`${input} mt-1 min-h-32 font-mono text-sm`}
            maxLength={5000}
            value={requirements}
            onChange={(e) => {
              setRequirements(e.target.value);
              setReqFile(undefined);
            }}
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <label className="cursor-pointer underline">
              Upload a file
              <input
                type="file"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {reqFile && <span>Loaded {reqFile}</span>}
            <span className="text-stone-500">
              {requirements.length.toLocaleString()} / 5,000 characters
            </span>
          </div>
        </div>

        <fieldset>
          <legend className={label}>How thorough</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {BUDGETS.map((b) => (
              <label
                key={b.id}
                className={`cursor-pointer rounded-lg border-2 p-3 ${budget === b.id ? "border-teal-700 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40" : "border-stone-200 dark:border-stone-700"}`}
              >
                <input
                  type="radio"
                  name="budget"
                  value={b.id}
                  checked={budget === b.id}
                  onChange={() => setBudget(b.id)}
                  className="mr-2"
                />
                <span className="font-medium">{b.label}</span>
                <span className="mt-1 block text-sm text-stone-600 dark:text-stone-400">
                  {b.detail}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <details className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
          <summary className="cursor-pointer font-medium">Offline fallback</summary>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={offline}
              onChange={(e) => setOffline(e.target.checked)}
              className="mt-1"
            />
            <span>
              Replay cached AI answers instead of calling the AI (works with no internet). The run
              is labelled as a replay of cached responses.
            </span>
          </label>
        </details>

        {error && <Notice tone="error">{error}</Notice>}
        <button
          type="submit"
          className={`${btnPrimary} px-6 py-3 text-lg`}
          disabled={busy || !!live || !url.trim()}
        >
          {busy ? "Starting…" : "Start scan"}
        </button>
      </form>
    </div>
  );
}
