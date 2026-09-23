# Witness — dev log

Append-only. Decisions (ADR-lite), problems hit, and a teach-back at the end of every phase. Rohit uses this to prepare Q&A answers ("what was hardest?", "what would you change?"), so record real problems and how they were solved.

## Planning decisions (23 Sep 2026)

**D1 — Input is a running app's URL, not a repo.** Alternatives: repo link, upload. Chosen because it works for any stack, tests what users experience, needs no source access, and never executes untrusted code on the host. Cost: black-box findings can't point at a line of code.

**D2 — "AI proposes, code proves."** Alternatives: LLM-as-judge (noisy: published web-agent testers flag many passing cases as failures), rules-only (misses logic bugs). Chosen: LLM infers journeys and expectations; expectations compile to a deterministic check language; every candidate replays 3× without the LLM before it's reported.

**D3 — Only the Explorer is an agent.** Alternatives: multi-agent personas. Planning, judging and reporting are single structured calls; agency there adds non-determinism with no measurable gain.

**D4 — Accessibility snapshots, not screenshots, as the agent's view.** Roughly 2–5 KB vs 100 KB+; semantic roles and names; refs map to stable locators.

**D5 — Tiers, not a single "bug" label.** Confirmed / Likely / Needs review / Discarded. Replay proves reproducibility, not that the expectation was right — so expectations grounded only in convention cap at Likely.

**D6 — Evaluate with a seeded-bug benchmark + decoys + external apps.** App-level mutation analysis; ablation to show what the AI adds and what verification removes.

**D7 — TypeScript monorepo; Express + SSE; JSON run store; Vercel AI SDK.** Familiar stack, Playwright-native, no native builds on Windows, provider switch.

## Frozen ground truth

- `bench/bugs.yaml` frozen at commit: `ff7f6a95229a05d0d60b2e0feb7613fd31f8f2d8` (23 Sep 2026, "Add planning docs and brief"). SHA-256 of the file: `eb16281ebdd853c58bf10a4f88f6b6af7ef9613c22bbe654a86703bb07cd38fc`. It is excluded from Prettier so tooling can't reformat it.

## Phase log

<!-- ### P0 — <date>
Built: …
How it works: …
Key decision + alternative: …
Most likely failure mode: …
Problems hit: … -->

### P0 decisions (23 Sep 2026)

**D8 — No build step for Node code; `tsx` runs TypeScript directly, `tsc` only typechecks.** Alternative: compile every package to `dist/` with `tsc`/`tsup`. Chosen because it removes a whole class of "forgot to rebuild" and ESM-extension problems, and works the same on Windows. Cost: slightly slower start-up (esbuild transpiles on load, well under a second). The bench frontend is still a real Vite production build.

**D9 — The bench's production server returns HTTP 404 for unknown paths, 200 for real app routes.** Alternative: the usual SPA fallback (every path returns `index.html` with 200). A 200-for-everything server would make B10's dead Terms link invisible to any broken-link detector, and would teach Witness a bad habit. Real routes (including `/services/s1`–`s8`) are 200; `/services/s99`, `/terms-and-conditions`, unknown `/api/*` and missing files are 404. `tests/routes.spec.ts` enforces it. The Vite **dev** server still returns 200 for everything, so evals and the demo must use the production build (as `EVALUATION.md` already says).

**D10 — Prove "each bug test fails when flagged" with a second Playwright project, not 18 server restarts.** The same `bugs.spec.ts` runs twice: project `clean` (all flags off, must pass) and project `flagged` (a fixture switches on only that test's own flag through `POST /__bench/bugs` and marks the test `fail()` — "expected to fail"). If a bug test ever passes with its bug on, Playwright reports it as a failure. Alternative: restart the server with `BENCH_BUGS=Bxx` 18 times. Chosen because it's one command (`pnpm bench:test`, ~1.6 min) and also exercises the runtime toggle the demo uses. I also checked every flagged failure is for the right reason (see gate results).

**D11 — Pin TypeScript 6.0.x.** TypeScript 7.0 (the Go-native compiler) is current, but typescript-eslint 8.x supports `<6.1`. Revisit when typescript-eslint supports 7.

**D12 — Improvement tiers in recall** (agreed with Rohit before the freeze): `evidence_based` counts as Confirmed and `suggestion` as Needs review for recall only; improvement precision stays separate. Written into `EVALUATION.md` §3; `bugs.yaml` untouched.

**D13 — LLM login spike moved from P0 to the start of P2** (Rohit's call: no API key yet). The model-ID check moves with it. P0 therefore proves nothing about model access; that risk is carried into P2.

**D14 — Bench flag precedence.** Code default is all bugs off. `pnpm bench` and `pnpm bench:serve` load the repo-root `.env` (so `BENCH_BUGS=all` there gives the buggy app locally). Variables already set in the environment win over `.env` (Node's `process.loadEnvFile` doesn't override), which is how `bench:test` forces `none` on its own port (5199) regardless of `.env`.

### Dependencies added in P0

| Package | Where | Why |
| --- | --- | --- |
| typescript ~6.0 | root | Typechecking (see D11) |
| tsx | root | Run TS scripts and the bench server without a build step (D8) |
| vitest | root | Unit tests across packages (in the plan) |
| eslint, @eslint/js, typescript-eslint, eslint-config-prettier, prettier | root | Lint + format (roadmap P0); eslint-config-prettier stops the two fighting |
| @types/node | root | Node types |
| express | bench | Bench API + production static server (in the plan) |
| react, react-dom, react-router | bench | Bench frontend (in the plan) |
| vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite | bench | Bench build + styling (in the plan) |
| @playwright/test, @axe-core/playwright | bench | Bench's own tests; axe is the same engine DET-A11Y will use |
| @types/express, @types/react, @types/react-dom | bench | Types |

No LLM packages yet — they arrive with the spike at the start of P2.

### Notes for later phases (found while building the bench)

- **Chromium logs a console error ("Failed to load resource … 4xx/5xx") for every failed fetch.** If DET-CONSOLE counts those, one 500 becomes two findings, and every deliberate 4xx (e.g. a wrong-password login during edge inputs) becomes a console "bug". P1 should treat network-failure console messages as already covered by DET-HTTP5XX/4XX/REQFAIL. This is a generic rule about browsers, not about the bench.
- **Playwright's `pageerror` puts the error type in `error.name`, not `error.message`** (B11 gives `message = "Cannot read properties of undefined (reading 'links')"`, `name = "TypeError"`). `bugs.yaml` matches B11 on `message: "TypeError"`, so DET-PAGEERROR must record `signals.errorMessage` as `"<name>: <message>"` (which is also what a developer expects to read). Generic, not bench-specific.
- `/__bench/*` routes are never linked, but a crawler that guesses paths could find them. Witness only follows links, so this is fine; don't add path-guessing.
- The clean bench has no Content-Security-Policy and no frame protection. That's deliberate (realistic small app): DET-SECHEADERS findings on the clean bench are true improvements, not false positives, and are not bug-category findings.

### P0 — 23 Sep 2026

**Built.**
- A pnpm monorepo: `packages/engine` (stub), `apps/cli`, `apps/server` and `apps/web` (stubs), `bench/app` (complete), `eval/` (placeholder), `scripts/` (Node helpers). Strict TypeScript, ESLint, Prettier and Vitest run from the root.
- **Harbour Clean**, the benchmark app: every page in BENCH_SPEC §3, the seed data, all 18 bug flags, the C01 canary, decoys D01–D04, the `/__bench/*` control routes, a dev mode (:5173 + API :5174) and a production build (:5180).
- The bench's own Playwright suite (49 tests), bench unit tests (40), and `pnpm demo:check`, `bench:reset`, `bench:fix` and `bench:break` as Node scripts, so they work in PowerShell.

**How it works.**
- **The bench is one Express server holding everything in memory.** It has users, bookings and login sessions, seeded on start. The seed includes Alex Demo's three bookings, dated 3, 7 and 14 days after the server started. `POST /__bench/reset` puts the seed back.
- **Every seeded bug is one `if (isBugOn("Bxx"))` branch.** The branches live in `src/shared/bugs.ts`, so `grep isBugOn` lists all of them.
  - The server fills the active set from `BENCH_BUGS` at start-up, and `POST /__bench/bugs` can change it while the app runs.
  - The browser fetches the active set once before it draws the page.
  - So a runtime toggle takes effect on the next page load, which is what the demo's "fix B01 and re-run the test" moment needs.
- **Bugs sit on whichever side a real app would have them.** The GST calculation, sorting, search, cancel, profile save, the apostrophe crash, slow bookings, login messages and the broken image URL are on the server. The contrast, labels, overflow, dead footer link, FAQ crash, double-submit, stale badge and raw-HTML heading are in the browser.
- **The tests.** Every bug test describes the *correct* behaviour ("the total equals subtotal × 1.15"). A shared *fixture* is setup code Playwright runs before every test. Here it resets the data and switches all flags off. In the `flagged` project it then turns on just that test's bug and tells Playwright "this test should fail now". So one run shows both halves: each test passes on the clean app and fails on its own bug.
- **The clean-build audit.** `clean.spec.ts` visits every page, logged out and logged in, plus key interactive states: the quote breakdown, the FAQ fully open, form errors, the cancel dialog, the "Profile saved" toast. On each it checks:
  - zero axe violations
  - no console errors or uncaught exceptions
  - no 4xx/5xx responses
  - every API call under 500 ms
  - every image loads
  - no sideways scrolling at 375 px
  - every link it found returns 200

**Key decision + alternative.** The flagged-project approach (D10) instead of restarting the server per bug. It's faster and it also exercises the runtime toggle. The trade-off: all tests share one server, so they must run one at a time (`workers: 1`) and reset state before each test.

**Most likely failure mode.** The clean bench stops being clean without anyone noticing, for example after a Tailwind or axe upgrade adds a new rule. Every false-positive number in the evaluation depends on this. Guard: run `pnpm bench:test` before every eval, and after any dependency change.

A second risk: seed dates are relative to when the server *started*. A bench left running past midnight shifts "today", which the past-date check (B04) depends on. Restart the bench before evals; `bench:reset` also recomputes the dates.

**Problems hit.**
- **pnpm 12 blocks dependency install scripts.** It failed the install on esbuild's postinstall. I allowed exactly that package in `pnpm-workspace.yaml`.
- **Prettier would have reformatted the frozen `bugs.yaml` and the hand-written docs.** Both are now in `.prettierignore`. `git diff` confirms `bugs.yaml` is byte-identical to ff7f6a9.
- **`import()` of an absolute file path breaks on Windows** (it needs a `file://` URL). `demo-check` uses `createRequire` instead.
- **React Router resolved to v8** (the plan assumed v7). The typechecker confirmed the APIs used (`BrowserRouter`, `Routes`, `NavLink`, `useSearchParams`…) are unchanged.
- **An `<aside>` inside `<main>` breaks the axe rule `landmark-complementary-is-top-level`.** I caught this while writing the booking summary and changed it to a `<section>`.
- **The spike was not done** (D13).

**Gate P0 results (23 Sep 2026, macOS, Node 22.23.2).**

| Check | Result |
| --- | --- |
| `pnpm test` (Vitest) | 40/40 passed |
| `pnpm typecheck` | 5/5 packages clean |
| `pnpm lint`, `prettier --check .` | clean |
| `pnpm bench:test` | **49 passed** in 1.6 min: 30 `clean` (18 bug tests, C01 absent + C01-when-on, 4 clean-build audits, 4 decoys, 2 route-status) and 19 `flagged`, all failing as expected |
| Flagged failures are for the right reason | Checked each one: B01 total 178.54 ≠ 155.25 · B02 not ascending · B03 no results for "window" · B04 no "future date" error · B05 no confirmation (server 500) · B06 HC-1001 still listed · B07 badge still 3 · B08 phone reverted · B09 one broken image · B10 Terms → 404 · B11 4th FAQ item won't open (TypeError) · B12 axe `label` + `button-name` · B13 axe `color-contrast` · B14 3505 ms · B15 probe element injected · B16 scrollWidth 605 > 376 · B17 2 bookings created · B18 "No account found for that email" · C01 canary present |
| Clean and buggy builds both run | `pnpm bench:serve` with `.env` `BENCH_BUGS=all` → all 19 flags on, `GET /api/quote?service=s1&hours=3` total 17854 cents (GST twice); `pnpm bench:fix B01` → 15525; `pnpm bench:break B01` restores it; `pnpm bench` dev mode serves :5173 with API :5174 |
| Route statuses | `/services/s1`…`s8` and all real routes 200; `/terms-and-conditions`, `/services/s99`, `/api/nope`, missing image 404 |
| `pnpm demo:check` | passes: Node, deps, Chromium, disk and bench are OK; the API-key WARN and the provider/cache TODOs are expected at this stage |
| Spike logs in | **Not run — deferred to start of P2 (D13)** |

Not yet verified: Windows. Scripts avoid bash-only syntax and use `node:path`, but nothing has run on Windows 11 yet. Worth running `pnpm install && pnpm bench:test` on the desktop before P1 ends.

**D15 — macOS only for testing (23 Sep 2026, Rohit).** Development and the presentation both happen on Rohit's Mac. Scripts stay portable (Node scripts, `node:path`, no bash-only syntax), but Windows isn't verified. This replaces the P0 note suggesting a Windows run. Also from today: each phase ends with a commit starting `P<n>:` plus a push, once the gate passes (`CLAUDE.md`).
