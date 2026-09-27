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

### P1 decisions (23 Sep 2026)

**D16 — No "Ready" verdict when no user journey was exercised.** FR-9 says "Ready" means no Confirmed/Likely bugs *and* every core journey completed. With zero journeys (the deterministic pipeline, or AI stages skipped) that second half is vacuously true, and Witness would call an app "Ready" after only loading its pages. Chosen: `readinessVerdict` takes `journeysAttempted`; if false, the best possible verdict is "Ready with caveats: no user journeys were exercised". Alternative: follow FR-9 literally. Rejected because it overclaims, the one thing the product must never do.

**D17 — Provisional tiers until replay exists (P3).** FR-8 only allows Confirmed after a finding reproduces ≥ 2/3 times, and replay isn't built yet. In P1, detector *bugs* are capped at **Likely** with the reason "not yet replayed". Detector *improvements* (axe, perf, headers) are **Evidence-based**, because they're direct measurements. `report/findings.ts → provisionalTier` is the single place this happens; P3 replaces it with `verify/tier.ts`. Alternative: mark universal-oracle bugs Confirmed straight away. Rejected: it breaks the tier rules, and E1 would show A0 at a tier it hasn't earned.

**D18 — Two crawl passes, and the session is reused rather than re-logging in.** Pass 1 crawls logged out. Pass 2 (only with credentials) starts from the start page and visits only pages that were new or "login-gated" when logged out. A page counts as gated if it redirected, or showed a password form and isn't itself a login/sign-up page. Pass 2 uses the cookies and storage from the preflight login, kept in memory (never written to disk). Alternatives: (a) crawl everything twice, which roughly doubles pages and wastes budget (the bench would need ~42 of 40); (b) crawl only logged in, which loses the logged-out view (login form, sign-up). Cost: pages that look different when logged in but don't redirect (e.g. a pre-filled form) are seen only logged out.

**D19 — The production login allowlist is a one-shot "login window".** SECURITY T1 says production mode blocks every same-origin write "except the login request recorded during preflight". The login request can't be known before it's sent. So preflight *arms* the policy just before submitting the login form. The first same-origin write is allowed and recorded (method + path), and the window closes. Later writes to exactly that method and path stay allowed, because replays log in again; everything else stays blocked. Tested in `browser/policy.test.ts` and, from the server's side, in `test/scan.test.ts`.

**D20 — DET-OVERFLOW narrows the same page instead of loading it again.** After the desktop detectors, the page is resized to 375 × 667, checked, and resized back. Alternative: a second page load in a mobile context, which is twice the requests and time. Cost: an app that picks its layout only once at start-up (not by CSS or resize events) would be measured in its desktop layout. CSS media queries, the usual case, respond correctly.

**D21 — Crawl waits up to 6 s for the network to go quiet (3 s after actions in P2).** DET-PERF's API threshold is 2 s, so a 3 s cap would sometimes capture a page before a slow response arrives. Requests still pending at capture time are recorded with their elapsed time, so "still waiting after 6 s" is still a finding.

**D22 — Candidates carry deterministic wording, signals and a group key.** ARCHITECTURE §3's `Candidate` has only `summary`. I added `detail` (title, impact, expected, actual, whyFlagged, written from recorded facts), `signals` (what the scorer matches on), `groupKey` (what makes two candidates "the same problem"), `url`, `session` and `viewport`. The P3 writer can rephrase `detail` (fact-checked) and falls back to it. So a report never needs an LLM to be readable.

**D23 — Scorer: a human label overrides an automatic match.** EVALUATION §3 describes labels for unmatched and tentative findings. I let a label win over *any* match, because a keyword rule can match a finding that isn't that bug (see "Problems hit"). Labels are keyed by fingerprint, so one label covers every run. They live in `eval/labels.json`, are committed, and are reviewable.

**D24 — Scorer reads the rules literally.** "Description" in the keyword rule is the finding's plain-language `impact` sentence, so keywords search title + impact + expected + actual. "First match in file order wins" applies whether the match is firm or tentative. I chose the literal reading so the scorer does exactly what the frozen file says, and nothing I'd have to defend as a reinterpretation.

### Dependencies added in P1

| Package | Where | Why |
| --- | --- | --- |
| zod 4.6 | engine, eval | Validation at every boundary (CLAUDE.md) |
| playwright 1.63.0 | engine | Browser automation; pinned to the bench's version so one Chromium serves both |
| @axe-core/playwright 4.13.0 | engine | DET-A11Y; the same engine and version as the bench's clean-build audit |
| yaml | eval | Reading `bench/bugs.yaml` (Node has no YAML parser) |

No image library: Playwright writes JPEG screenshots at quality 60 itself.

### P1 — 23 Sep 2026

**Built.**
- `packages/engine`:
  - **config** (zod, budget presets)
  - **store** (JSON run store; redacts secrets on every write)
  - **browser** (locked-down contexts, safety policy, in-memory secret vault)
  - **record** (network, console and error recorder; evidence writer)
  - **preflight** (reachability, headers, login)
  - **crawl** (normalisation, structure hash, two-pass BFS)
  - **ten detectors** plus a registry
  - **report** (grouping, severity, fingerprint, verdict, Markdown)
  - `runScan`
- `apps/cli`: `pnpm scan <url>` with exit codes 0/1/2/3.
- `eval/`: `pnpm eval:score`, the scorer (written by me at Rohit's request).
- Tests:
  - **134 engine tests:** policy (the SECURITY §4 T1/T3 tests), a positive and a negative fixture page for every detector, table-driven rule tests, the store and redaction, and an end-to-end scan of a small fixture site.
  - **17 eval tests.**

**How data flows.** A scan runs in phases, and each phase emits events that go to the run store and the CLI.
1. **Preflight** opens the start page in a fresh, locked-down browser and saves its response headers as evidence. It looks for a login form (a password field, or a "Log in" link). With credentials, it types the username and the password from the vault, submits inside the policy's login window, and checks it really got in (a log-out control, leaving the login page, or the account name on screen). If not, the scan stops with "Couldn't log in with the details provided", and nothing else runs.
2. **Map.** The crawler visits same-origin links breadth-first. It never follows log-out links, file downloads or other sites.
   - For each page it records the evidence bundle: AI-mode aria snapshot, JPEG screenshot with password fields masked, network log, console, uncaught errors and timing.
   - It gives the page a *route pattern* (`/orders/42` → `/orders/:id`) and a *structure hash* (roles and names from the snapshot, ignoring text and numbers), and skips pages it has already seen.
   - It runs the page detectors, then narrows the window to phone width for DET-OVERFLOW.
3. **Site detectors.** After the crawl, DET-BROKENLINK checks the link graph for targets that returned 404/410/5xx. DET-SECHEADERS checks the start page's headers and cookies.
4. **Report.** Candidates are grouped by group key: one broken image seen on two pages becomes one finding with two instances. Each finding gets a severity (FR-9 rules), a provisional tier (D17), a stable fingerprint, and numbered steps generated from the recorded facts. The verdict and "what wasn't tested" are computed, and `run.json`, `report.md` and `report.json` are written.

**How the scorer matches (for Q&A).** The scorer answers one question per finding: *which seeded bug, if any, is this?* The rules live in the frozen `bench/bugs.yaml`. Each bug has a short list of alternative rules (`match.any`), and a rule is a set of conditions that must **all** hold. The conditions are:
- where it came from: `source` (detector ID or check type), `source_kind`
- what kind of problem it is: `category`
- where it happened: `route` (a regex on the finding's route), `request_path`, `method`, `status_gte`
- what the tools reported: `axe_rule`, `message` (a regex on the error text)
- what the text says: `keywords_any` and `keywords_all`, searched in the title, impact, expected and actual text

A finding matches a bug if **any** one of its rules holds. The scorer tries bugs in file order (B01 → B18), then the decoys (D01 → D04), and **the first rule that holds wins**. So a finding counts for at most one bug. Some rules are marked `confirm: manual`. These are the vague, keyword-only ones. A match on one of them is only **tentative**: it isn't counted until a human confirms it in `eval/labels.json`.

Each finding then gets one of three outcomes:
- **True positive:** it matched a bug firmly, or a human labelled it `tp:Bxx` or `tp_unseeded`.
- **False positive:** it matched a decoy, or a human labelled it `fp`.
- **Unlabelled:** a tentative match, or no match at all. Unlabelled findings are left out of precision and reported as a count.

**Recall** at a tier is the share of the 18 seeded bugs found by at least one true-positive finding at that tier or better. **Precision** is TP ÷ (TP + FP), computed separately for bugs and improvements.

*Worked examples* (each is a test in `eval/score.test.ts`):
1. **Matches a bug.** DET-HTTP5XX reports `POST /api/bookings → 500` on `/book`. B01–B04 all fail on their first condition. B05's first rule needs source `DET-HTTP5XX`, a request path matching `^/api/bookings$`, and method `POST`, and all three hold. Result: firm match to **B05**, a true positive, and B05 counts as found at the finding's tier.
2. **Matches a decoy.** DET-PERF reports "Slow API call: GET /api/quote took 2.1 s" on `/quote`. The scorer tries every bug. The closest is B14, but its first rule fails on request path (`/api/quote` isn't `/api/bookings`) and its second on route (`/quote` isn't `/bookings`). Then it tries the decoys. D03's first rule is route `^/quote` plus category `performance`, which holds. Result: **decoy D03**, a false positive. This is exactly the over-eager claim the decoy exists to catch (the ~800 ms "Calculating…" is by design).
3. **Tentative.** A judged finding on `/quote` says "Total is $178.54 but subtotal $135.00 plus GST should be $155.25". B01's first rule needs source `numericRelation` (a deterministic check), which a judgement isn't, so it fails. B01's second rule (category `functional`, route `^/quote`, a keyword from gst/total/tax) holds, but it's marked `confirm: manual`. Result: **tentative B01**. It's listed under "Needs a label" and doesn't count towards recall. Once Rohit adds `"<fingerprint>": "tp:B01"`, it counts, at Likely. This is by design: an LLM's opinion on its own can't claim a grounded bug for recall.

**Key decision + alternative.** The safety policy decides every request with one pure function (`SafetyPolicy.decide`), and the browser layer simply routes every request through it. This covers every page and popup in the context, including navigations the page's own JavaScript starts. Alternative: check the target in each place Witness acts (`goto`, click handlers). Rejected because the page's own code, redirects and popups would bypass it. The policy can also be tested with a table, without a browser, and then again against a real server that counts what it received.

**Most likely failure mode.** A false "bug" on a real app from a noisy universal detector, most likely DET-CONSOLE (third-party scripts log errors) or DET-REQFAIL (analytics or long-poll requests cut off when the crawler navigates). Mitigations in place: browser echoes of network failures are dropped, navigation-cancelled requests are ignored, requests Witness itself blocked are ignored, and console errors that repeat a page error are merged. The real fix is P3's replay: noise that doesn't reproduce drops to Discarded. Second risk: login detection on unusual forms (multi-step, username then password, or a submit button outside the `<form>`). In that case preflight fails loudly with a screenshot, so the failure is visible rather than silent.

**Problems hit.**
- **The CSP improvement matched the XSS bug (B15).** B15's second rule is category `security` plus any of `xss/script/escap/inject`, and the CSP finding's impact sentence says "if an attacker ever gets *script* into a page". The literal rules counted it as finding B15, which the crawl can't detect, and inflated recall@C from 17% to 22%. I didn't edit `bugs.yaml` (it's frozen) or reword the finding to dodge the keyword (that's tuning to the answer key). Instead I labelled the three security-header findings `tp_unseeded` in `eval/labels.json`: they're real (the bench genuinely lacks those headers, P0 note) but they aren't B15. That's why D23 lets a label override a match. Lesson for Q&A: keyword rules are the weakest part of the ground truth, which is why most are `confirm: manual`.
- **An aborted cross-origin navigation lands on Chromium's error page** (`chrome-error://chromewebdata/`), not back on the previous page. It's still safe (the other server received nothing), but the P2 executor must go back after a blocked navigation, or the agent will be stuck on an error page.
- **The logged-in pass revisited `/login`, `/login?next` and `/signup`,** because any page with a password field looked login-gated. Fixed with an auth-page pattern: a login or sign-up page isn't "gated content".
- **`/book` and `/book?service` gave two overflow findings.** They're different states (query keys are part of the route pattern), but the same layout problem. Overflow and page-timing findings now group by path.
- **`page.evaluate` serialises functions,** and tsx/esbuild can wrap named inner functions in a `__name()` helper that doesn't exist in the page. I kept helper functions out of every in-page function as a precaution.
- **Consumers typecheck the engine's source** (no build step, D8), so `apps/cli` and `eval` also need the DOM lib in their tsconfig for the in-page code.
- **Vitest's 5 s default timeout** is too short for browser tests; the engine project uses 60 s.

**Gate P1 results (23 Sep 2026, macOS, production bench on :5180, Standard budget, logged in as the test account).**

| Check | Result |
| --- | --- |
| A0 on the buggy bench (`BENCH_BUGS=all`) | `run_20260923-040149_s2y0`: 23 pages, 34 s. Found **B09, B10, B12, B13, B14, B16**, all six required. B12–B14 at Evidence-based (counts as Confirmed for recall, D12); B09, B10, B16 at Likely (D17). No decoys flagged. Recall C 17% / C+L 33%; bug precision 100% |
| A0 on the clean bench (`BENCH_BUGS=none`) | `run_20260923-040259_m9hr` (staging) and `run_20260923-040338_0bwa` (production mode): 23 pages each, **0 bug-category findings**, 3 improvements (the missing security headers, which are real) |
| Production-mode write block | `browser/policy.test.ts` (T1 block + login allowed, T3 off-origin) passes; `test/scan.test.ts` shows from the server's side that the login POST was the only write and a page's own POST never arrived; the production-mode bench scan logged in with no writes blocked or leaked |
| Scored | `pnpm eval:score eval/results/p1-gate` → `eval/results/p1-gate/summary.{json,md}` (0 unlabelled after the 3 labels above) |
| `pnpm test` | 191 passed (40 bench, 134 engine, 17 eval) |
| `pnpm typecheck`, `pnpm lint`, `prettier --check .` | clean |
| Secrets | No test password in `runs/` (grep); the store redacts vault values on every write (tested) |
| `bugs.yaml` | SHA-256 unchanged (`eb16281e…`) |
| Bench knowledge in the engine | none (grep for bench names, routes, ports, bug IDs in `packages/engine/src` and `apps/cli/src`) |

What the gate doesn't show: the three not-yet-reachable universal bugs (B05 needs an edge input, B11 needs a click, B15 needs the canary). They arrive in P2. The quick-scan-of-the-bench rule in CLAUDE.md applies from P4.

### Notes for later phases (from P1)

- **P2 executor:** after the policy blocks a navigation, the page is on `chrome-error://`; call `goBack()` and tell the agent the link leaves the site.
- **P2:** DET-HTTP4XX and DET-XSS need step context (happy vs edge), so they plug into the executor, not the crawl registry. Everything else in `detectors/registry.ts` should run on agent states unchanged.
- **P3:** replace `provisionalTier` with `verify/tier.ts`; static detectors "reproduce" by re-running on a fresh load (FR-8), so B09/B10/B16 should reach Confirmed.
- A Standard crawl of the bench takes ~34 s for 23 pages (axe on every state is the biggest cost), leaving most of the 8-minute budget for the AI stages.

### P1 wrap-up — 26 Sep 2026

**Approved by Rohit:** D16 (no "Ready" without an exercised journey), D17 (provisional tiers until replay) and D23 (a human label overrides an automatic match).

**D25 — Every label carries a one-line reason.** `eval/labels.json` is now `fingerprint → { label, reason }`, validated by a zod schema in `eval/score-lib.ts`: keys must be finding fingerprints (`fp_` + 16 hex), the label must be `tp:Bxx`, `tp_unseeded` or `fp`, and the reason must be one non-empty line (≤ 200 chars). The scorer refuses a file that breaks this, and a test checks the committed file. The reason also appears in the scorer's "why" column. Why: D23 lets a human override the answer key, so every override has to be reviewable, or the labels become a quiet way to tune the numbers. Re-scoring `eval/results/p1-gate` with the new file gives identical numbers and outcomes. The committed gate summary was left as it was on 23 Sep.

**D26 — The deterministic pipeline (A0) will use replay too** (Rohit's call). Once P3's replayer exists, A0 replays its detector candidates as well, so its findings can reach Confirmed. That removes D17's Likely cap for A0 in the ablation, and A0 vs A2 compares like with like. Added to ROADMAP P3.

**D27 — QA coverage addendum approved; new phase P3b.** `docs/ADDENDUM_QA_COVERAGE.md` adds secrets, source maps, broken access control, leaked DB errors, acceptance criteria and an optional prompt-injection probe. It becomes P3b, after the P3 gate and before P4. `bench/bugs-v2.yaml` and `bench/SCOPE.md` are written and frozen before any of it is built. P2 gets only the hook: an optional `requirements` input and a `requirement` grounding kind. Risk: P3b sits between P3 (ends Thu 1 Oct) and the feature freeze (Sat 3 Oct), so it competes with P4 for time. The addendum's cut order (A6 first, A1 and A5 last) is in the roadmap.

**P2 pre-check: model IDs (26 Sep).** Checked against OpenRouter's live model list (`GET /api/v1/models`, 458 models):

| Env var | Slug | On OpenRouter | Price in/out per M tokens | Tools | Structured outputs |
| --- | --- | --- | --- | --- | --- |
| `WITNESS_MODEL_SMART` | `anthropic/claude-sonnet-5` | yes | $2 / $10 | yes | yes |
| `WITNESS_MODEL_FAST` | `anthropic/claude-haiku-4.5` | yes | $1 / $5 | yes | yes |

The key authenticates (`GET /api/v1/key` → 200). The account shows $10 credit and $0 used, and **no per-key spend limit** is set on OpenRouter. Witness's own per-run cap (FR-14) is therefore the only guard, so an OpenRouter-side key limit would be a sensible second layer.

### P2 decisions (26 Sep 2026)

**D28 — OpenRouter only for now** (Rohit, 26 Sep). `llm/settings.ts` builds the two models; the gateway only sees AI SDK `LanguageModel` objects, so the direct Anthropic provider is one factory function later. Dependencies: `ai` 7.x and `@openrouter/ai-sdk-provider` 3.x (below).

**D29 — Provisional tiers for AI candidates until replay (P3).** Pipeline `full` (and `full-no-skeptic`): a failed check is **Likely** ("not yet replayed"), whatever its grounding; an Explorer flag (`flag_candidate`, a judgement) is **Needs review**; detector bugs stay Likely (D17). Pipeline `ai-no-verify` (ablation A1) reports what an unverified AI tester would claim: a detector hit or a check grounded in verified on-screen/requirements text is **Confirmed**, anything else Likely — no replay, no skeptic. Alternative for A1: call every candidate Confirmed. Rejected: grounding is part of the AI design, not of verification, so A1 vs A2 should isolate replay + skeptic.

**D30 — Three small additions to the step/check language.** (1) Asserts and captures are recorded as steps (`action: { type: "check" }`), so a replay re-evaluates them in the same place with the same captured values. (2) `click.clickCount: 2` for the double-submit variant. (3) A `maxRequests` check (at most N successful same-origin requests with this method + path since the step began), so "double submit creates two records" is a replayable check instead of an ad-hoc count. Alternative: a special detector. Rejected: it wouldn't replay or export as a test.

**D31 — Reasoning effort is set per call; default off.** Problem hit (below): through OpenRouter, Sonnet 5 reasons by default. The Planner uses effort `low` and a 120 s timeout (the spec's 60 s applies to every other call); every other role uses `none`. Alternative: accept default reasoning. Rejected: ~6k hidden tokens per plan, 70 s and 3× the cost, for no visible gain in the plan.

**D32 — The Planner writes each check as a JSON string.** Structured outputs follow the schema the model is shown: an open-object `check` field came back as `{}` in a probe, and the full recursive check schema is large and nested. So the model sees `check: string`, and code parses it and validates it with the real zod `CheckSchema`. Invalid checks are dropped per expectation, and invalid journeys per journey (a fallback schema), so one bad check doesn't sink the plan.

**D33 — The Explorer's check fields are open objects in the tool schema, and the check language is described once in its system prompt** (~500 tokens, as TypeScript types). Tool calls aren't schema-constrained, so this keeps every Explorer call small while code still validates each check with the strict schema (and repairs once).

**D34 — Ref → stable locator reads role and name from a fresh page-level AI snapshot.** Found while testing: an element-level `ariaSnapshot()` invalidates every `aria-ref` on the page, while a new page-level AI snapshot keeps refs stable per element. Locator preference: to act, role+name → label → placeholder → test id → text → css; to read a value, test id first, and never a locator built from text that contains digits (the value changes when the bug is fixed). A list target becomes `{ role: item role, within: <the list's locator> }`. Each candidate must match exactly one element — the same element handle as the ref.

**D35 — What `read` means.** The first non-percentage amount in the element's own text (an input's value; a dropdown's visible option label). If the element is a label with no amount ("Total (incl. 10% tax)"), the first amount that follows the label's text in the nearest enclosing row, up to 3 levels up. Deterministic, documented, unit-tested; it lets the Planner and Explorer point at a label and still read the right number.

**D36 — Edge inputs are planned from recorded forms and run without the LLM.** Forms are recovered from the happy-path steps (fills + submit + the path that led there); a probe opens each form once and adds the fields the Explorer didn't type into (pre-filled ones). Variants: always-first fixed set (XSS canary, apostrophe name, double submit), then up to 3 AI proposals (temperature 0.4), then the rest of the fixed set, capped at 8 per form (quick: 4). Two variants run in parallel, each in a fresh context. Production mode skips forms whose submit writes (it would be blocked, so nothing to observe). The login-message comparison runs as a small synthetic "edge" journey.

**D37 — Journeys reuse the preflight session (cookies in memory) instead of re-logging in.** Faster and doesn't touch the login endpoint repeatedly. Cost: P3's replayer must log in itself (the preamble), because a replay must not depend on a session captured earlier.

**D38 — Time split within the wall-clock budget.** Exploring stops starting turns at 68% of the budget; edge inputs run until 35 s before the end (the report needs the rest); the edge generator is only called with ≥ 40 s left. Anything not reached goes to "What wasn't tested".

**D39 — A decided expectation is frozen.** Found in a bench run: the Explorer re-asserted a failed expectation with a different check, so the stored check no longer matched the one that failed (replay would test the wrong thing). Now only an unchecked or unevaluable expectation accepts a new check; to check something else, the agent adds a new expectation.

**D40 — Two readings of one planned expectation.** The Planner's check runs first, and a failure there stands: a weaker replacement can't mask it. Otherwise the Explorer's own check, if it gave one, decides; if that can't be evaluated, a planned pass stands. Found over three bench runs, both ways round:
- run 1: the Explorer replaced a good planned `ordered` check with one that passes trivially;
- run 3: the planned check ("some `$` is visible") was the weak one, and the Explorer's precise relation was being discarded.

Alternative: always trust the Planner (smart model). Rejected because a planned check written before the result page exists is often only a placeholder (D32's "don't guess formulas").

**D41 — For `equalsCaptured`, a value that has disappeared is a failure, not "can't evaluate".** The same locator found the value at capture time; its absence now is the change being tested (e.g. a search in different letter case returns nothing). Other missing targets are still errors.

**D42 — Edge-input bases must be real successes.** A submit that stayed on the page and showed an error-like message (the Explorer testing bad input on purpose) isn't used as a happy path. A success signature never uses error-like or transient progress text ("Calculating…", "Saving…"). Found in run 2: a signature built on a transient "Calculating…" made every "accept" variant on that form fail, and it matched decoy D03 by keyword.

**D43 — Labelled amounts: a deterministic hint plus a one-turn escalation.** Each turn lists lines that pair a label with an amount, including a `<dl>`/grid label on one line with its value on the next ("Subtotal: $135.00"); dropdown options are skipped. The first time a state shows such amounts, that turn uses the smart model: writing the relation a label states ("Total (incl. 15% GST)") is where the small model was weakest. Generic by construction (no app words); it was motivated by bench runs, which is recorded here on purpose.

**D44 — Page text aimed at automated tools is noted, not flagged.** The Explorer flagged the injection canary's sentence as a "security issue". Per the universal rules, it now ignores such text and mentions it in its finish note. A finding about the page's wording isn't a bug in the app.

**Honesty note on iteration.** D39–D44 came from reading four Standard runs on the bench. Each change is generic (no app names, routes or bug knowledge; the contamination tests pass), but iterating on the bench can still overfit the Explorer's behaviour. E5 (SauceDemo) and E6 (Friction) exist to check that, and the ablation numbers in P5 will come from fresh runs.

**D45 — One failed Explorer call is a bad turn, not an outage.** A provider error or timeout on one turn counts as a bad turn; two in a row end exploration ("AI unavailable"), and the spend cap or a replay-cache miss ends it at once. Explorer calls time out after 30 s (a normal turn takes 2–4 s). Over-long free text in tool calls (notes, summaries, "why") is trimmed in code instead of being rejected, because a repair call costs ~2.5 s and ~$0.006 for nothing.

### Dependencies added in P2

| Package | Where | Why |
| --- | --- | --- |
| ai 7.0.x (Vercel AI SDK) | engine | Tool calling, structured output, provider switch, and a mock model for tests (in the plan, D7) |
| @openrouter/ai-sdk-provider 3.1.x | engine | OpenRouter models for the AI SDK, with the provider's real per-call cost (D28) |

### P2 spike (26 Sep 2026, moved from P0 by D13)

- **Model IDs** checked against OpenRouter's live list (P1 wrap-up entry): both exist, with tool calling and structured outputs.
- **Login loop.** A throwaway script opened the production bench and gave Haiku 4.5 an AI-mode snapshot with three tools (click, fill, finish). It logged in with `{{secret:password}}` in **6 turns**:
  - ~1.7–2k input tokens per turn, 1.8–3.8 s per call;
  - $0.014 in total.

  The snapshot format (`[ref=e23]`, roles and names) worked as the only view of the page.
- **Structured output.** Sonnet 5 produced JSON that our zod schema then correctly rejected (an array too long), which is exactly what the repair step is for.
- **Finding: aria snapshots include typed password values** (see "Problems hit"). This alone justified doing the spike.

### P2 — 26 Sep 2026

**Built.**
- `llm/`: the **gateway**, the only door to a model. It handles redaction and the leak check, a replay guard, the spend cap, a response cache (`off|rw|replay`), retries with backoff, per-call timeout and reasoning effort, our own zod validation with one repair, and a call log (`llm-calls.ndjson`). There are three generic prompts (Planner, Explorer, edge inputs) and a contamination test.
- `oracle/`: the **check language** (zod), number parsing, and the deterministic **evaluator**. The evaluator has three outcomes (pass, fail, error) and a plain-language message for each.
- `plan/`: the **app-map summary**, built from the crawl's snapshots, and the **Planner**, which is one call followed by code-side validation.
- `explore/`: the **executor** (safety, ref → stable locator, secrets, waits, steps, detectors on every step), the **Explorer loop** (tools, context, stop conditions, escalation) and the **edge-input runner** (forms from recorded steps, a field probe, fixed + AI variants, DET-XSS, double submit, login-message comparison).
- New detectors: DET-HTTP4XX on happy steps, and DET-XSS through the canary.
- Pipelines: `ai-no-verify` and `full` (provisional tiers, D29). The requirements hook (`requirements` in the config and Planner input; `requirement` grounding).
- Tests: 178 new (379 in all, from 201).

**How data flows.**
1. After the crawl, the **app-map summary** turns ~23 snapshots into about 3–8k characters: per page, the headings, fields (with dropdown options), buttons, links and "notable" text (amounts, totals, sort/save/search words). Site navigation is listed once, and same-layout pages are grouped.
2. The **Planner** (Sonnet 5, low reasoning) returns an app model and up to 5 journeys, each with expectations. An expectation is a statement, a check written as JSON, grounding, impact, category, and *when* to check it. Code then keeps only what it can verify:
   - checks must parse;
   - start routes must exist;
   - `ui_text` quotes must literally appear on a recorded page, or they become "convention";
   - journeys beyond the budget are dropped, core first.
3. Each journey runs in a **fresh browser** with the logged-in cookies from preflight. Every turn, the **Explorer** (Haiku 4.5) gets text only:
   - the goal and the expectations with their status;
   - the last 8 steps and any new errors;
   - evidence IDs and a hint listing labelled amounts;
   - the page snapshot, wrapped as untrusted.

   It calls exactly one tool. After two bad turns, one turn escalates to Sonnet.
4. The **executor** carries out the call. It converts the ref into a locator that matches exactly that element, refuses destructive controls and off-site targets, and types secrets from the vault. It waits for the page to settle, records the step with evidence, and runs the log detectors, plus the page detectors the first time a state is seen.
   An `assert` makes the **evaluator** run the check on the live page. A failure becomes a **candidate** carrying the steps that led to it.
5. The **edge-input runner** finds each submitted form in the recorded steps and probes it for all its fields. It asks Sonnet for up to 3 context-aware inputs, adds the fixed safe set, and replays each variant in a fresh browser **without the LLM** (the guard enforces it). Code judges the outcome: 5xx, page errors, the canary element, whether the field was rejected, whether the success signature appeared, and request counts.
6. The **report** groups candidates into findings. Severity now uses journey context (a crash during a core journey is critical). Tiers are provisional until P3 (D29). Repro steps are the recorded step descriptions, never LLM text.

**How a check is evaluated (for Q&A).** A check is JSON. The model wrote it, but only code runs it, in the same way on every run. Three rules first:
- **Validation:** the JSON must match the zod schema of the check language. Unknown check types, extra fields, bad regexes and refs in stored checks are all rejected.
- **Locators:** each locator becomes a Playwright locator, and the evaluator waits up to 1.5 s for a visible match.
- **Outcomes:** a missing element or a missing number is an *error*, not a failure. The Explorer is told and can point the check at the right element; an error never becomes a finding.

*Worked example 1: the GST total.* After calculating a quote, the page shows `Subtotal $135.00` and `Total (incl. 15% GST) $178.54`. The Explorer points at the two amounts by ref, and the executor stores them as stable locators. The check:
```json
{ "type": "numericRelation",
  "left":  { "read": <the total's amount> },
  "op": "eq",
  "right": { "op": "mul", "a": { "read": <the subtotal's amount> }, "b": { "const": 1.15 } } }
```
It is grounded in the on-screen label `Total (incl. 15% GST)`, and code verifies that the quote is really on the page. Evaluation:
1. **Read the left side.** Take the element's text and find the first amount that isn't a percentage, so `15%` in a label is skipped. `$178.54` → 178.54, marked as money because it has a currency sign.
2. **Read the right side.** `$135.00` → 135.00; × 1.15 = 155.25.
3. **Choose the tolerance.** Money defaults to ±0.01.
4. **Compare.** |178.54 − 155.25| = 23.29 > 0.01, so the check **fails**.
5. **Explain.** The message is built from the numbers: "…total is 178.54; …subtotal ($135.00) × 1.15 is 155.25. Expected 178.54 = 155.25 (±0.01), but 178.54 ≠ 155.25."

The result is stored as a `check_result` evidence item and recorded as a step. It becomes a candidate with source `check/numericRelation` and signature `check_failed`. On a correct app, 135.00 × 1.15 = 155.25 = total, so the same check passes. That's why it can later be replayed, and exported as a test.

To be precise about what's proven: the evaluator is covered by fixture-page tests with exactly this relation (`oracle/evaluate.test.ts`, using 10% tax). In the P2 gate runs, though, the Explorer never wrote this check. It checked `subtotal = 45 × 3` instead, which is true, so **B01 was missed**. The limit is the agent's choice of check, not the evaluator.

*Worked example 2: the price sort.* After choosing "Price: low to high", the check is:
```json
{ "type": "ordered", "items": { "by": "role", "role": "listitem", "within": <the services list> },
  "read": "number", "direction": "asc" }
```
It is grounded in the option label `Price: low to high`. Evaluation:
1. **Find the items.** Take every visible list item in that list. Fewer than 2 would be an *error*.
2. **Read each item.** Take the first amount in each item's text: "Carpet shampoo $8 per hour" → 8.
3. **Compare neighbours.** Check each adjacent pair in order. The first pair out of order fails the check, e.g. "item 2 (20) comes after item 1 (100)", with the whole order listed.

Sorting the prices as text gives `$100, $20, $45, $50, $55, $60, $75, $8`, so the check fails at item 2. Sorted numerically, it passes.

The "items" locator came from the Explorer pointing at the list. The executor turned that ref into "every list item inside this list", so the check replays even when the list's contents change.

In the gate runs this check did run. The Planner wrote it with `items: text "per hour"`, and code kept it over the Explorer's weaker replacement (D40). But the Explorer sorted a *search-filtered* list of 5 services priced $45–$75. Those prices all have two digits, so a text sort and a numeric sort agree, and the check correctly **passed**: B02 was missed. The prompt now says to sort the full list, and the evaluator's "fewer than 2 items" message says the same, but in run 5 the Explorer still searched first.

**Key decision + alternative.** The LLM writes *checks*, not verdicts, and code evaluates them (D2 in practice). Alternative: let the Explorer judge pass/fail from what it sees. Rejected because the verdict would not be reproducible or exportable, and the bench run shows why: the Explorer's own wording of a finding is sometimes wrong, while the evaluator's message is built from numbers read off the page.

**Most likely failure mode.** It's already visible in the gate runs: the Explorer not asserting the precise rule, or not setting up the scenario that shows the bug. For example, it confirms "a price is shown" but never checks the tax relation, or it sorts a filtered list. Mitigations in place:
- the Planner's "when" hints;
- the deterministic labelled-amounts hint in every turn;
- escalation to Sonnet after bad turns and on the first view of labelled amounts;
- "planned check first" (D40);
- the prompt rules.

These mitigations got B03, B06 and B08 from Explorer *flags* (Needs review) in run 1 up to deterministic check failures (Likely) in runs 2–5. They did not get B01 or B02.

Second failure mode: **false positives from wrong expectations.** Examples are the Planner guessing that a "Booking summary" appears after confirming, and AI edge-input guesses like "a decimal number of hours should be accepted". Replay (P3) won't remove these, because they reproduce. P3's skeptic ("argue the expectation was wrong") is the designed defence, and these runs give it concrete test cases.

Third risk: **time.** Standard runs took 422–472 s of the 480 s cap: well under NFR-1's 8 minutes, but over the 5-minute demo target. The demo needs the Quick budget or a cached run.

**Problems hit.**
- **Playwright aria snapshots include what was typed into a password field**, in plain text and in both snapshot modes (found by the spike). Any snapshot taken after logging in would have carried the password into the next prompt. The gateway now turns every vault value into `{{secret:name}}` (plain, URL-encoded and JSON-escaped forms), then refuses to send a payload that still contains one (`llm/redaction.test.ts`, built on a real snapshot). Disk was already safe: the run store redacts every write.
- **Sonnet 5 reasons by default through OpenRouter.** The first Quick run's Planner call hit the 60 s timeout; a probe showed 6,012 hidden reasoning tokens out of 6,142 output tokens, 70 s and $0.068. With effort `low`, it takes 17 s and $0.022, and its output is valid first time (D31). The aborted call was billed by the provider but can't be counted (no usage came back); that's a small, documented gap in cost accounting.
- **Structured outputs follow the schema literally.** An open-object field came back as `{}`, so the Planner's checks go over the wire as JSON strings (D32).
- **An element-level `ariaSnapshot()` invalidates every ref on the page** (D34). Found by a failing executor test, not in production.
- **A `<select>` read as its internal value ("s1"), not its label.** This produced a false "rate doesn't match" failure in the second Quick run. Fixed, with a regression test.
- **The Explorer (Haiku 4.5) writes weak checks.** Across Standard runs it replaced a good `ordered` check with one that always passes, asserted "invalid login is rejected" without trying an invalid login, captured a value *before* editing it, and sorted a search-filtered list. Fixes: D39–D44 and prompt rules. Remaining weakness: B01 and B02 were still missed in every Standard run (see results), and the Planner can guess result-page text (a critical false positive: "a 'Booking summary' is shown after confirming", when the page says "Booking confirmed"). P3's skeptic is designed for that second class: "the expectation was wrong".
- **Haiku doesn't know today's date** and booked for 2025. Each turn now states today's local date.
- **The fixture server resolved function routes before reading the request body**, so body-dependent test routes couldn't work. It now reads the body first.
- **Run 4 was interrupted by the laptop sleeping** (one model call "took" 200 s). Its numbers are recorded below but it isn't counted towards the gate.
- **pnpm 12's supply-chain guard blocked the newest AI SDK.** `ai@7.0.116` and two of its packages were only ~12 hours old, inside pnpm's minimum-release-age window. `pnpm add` quietly wrote an exemption list into `pnpm-workspace.yaml`. I removed the exemptions and pinned `ai` to **7.0.113** (3 days old), which passes the guard (SECURITY T13). The five gate runs used 7.0.116; after the pin, all 379 tests pass and a real Quick scan ran end to end (below).

**Gate P2 results (26 Sep 2026, macOS, production bench on :5180 with `BENCH_BUGS=all`, Standard budget, logged in as the test account, models Sonnet 5 + Haiku 4.5).** All runs are in `eval/results/p2-gate/` (runs.jsonl + summary.json/.md). No run was dropped.

| Run | Code | Time | Planned journeys completed | LLM calls | Cost | Recall C+L | Bug precision C+L | Decoys |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 `…040918_ykwq` | first full version | 447 s | 3/5 | 97 | $0.61 | 50% | 75% | D03 |
| 2 `…042245_y1z1` | + D39, D40 (first form), D42 (refused submits) | 459 s | 4/5 | 88 | $0.56 | 61% | 89% | D03 |
| 3 `…043405_1k8m` | + D43, transient text | 452 s | 4/5 | 90 | $0.52 | 56% | 100% | none |
| 4 `…044517_0m6x` | + D40 (final), D41, D44 | 472 s | 3/5 | 85 | $0.50 | 44% | 100% | none |
| 5 `…051200_38ne` | + D45 (final code) | 422 s | 3/5 (+ login check) | 92 | $0.51 | 67% | 100% | none |
| A0 `…051940_8f4c` | deterministic, buggy | 35 s | – | 0 | $0 | 33% | 100% | none |
| A0 `…052025_dbtu` | deterministic, **clean** | 32 s | – | 0 | $0 | – | 0 bug findings | none |

Run 4 was interrupted by the laptop sleeping mid-call: the last journey was stopped and the edge phase had no time left. It's kept in the set but not used for the gate.

*Note added 27 Sep:* the bug precision figures above exclude the 37 unlabelled findings (19 fingerprints; see `summary.md`). Most of them are expected to be false positives, so precision will drop once they're labelled. See "P2 wrap-up".

All runs used `--llm-cache rw`. Runs 3–5 reused run 2's plan, and some edge-generator answers, from the response cache, because those prompts hadn't changed (run 5: 5 cache hits). The Explorer's turns were live in every run. This makes runs 2–5 a fairer comparison of the Explorer changes, but it also means they share one plan.

| Gate criterion | Result |
| --- | --- |
| Explorer completes ≥ 3 bench journeys in a Standard run | **Pass.** 3–4 of 5 planned journeys in every run (run 5: 3 of 5, plus the login-message check) |
| ≥ 3 of B01, B02, B03, B06, B08 appear as candidates | **Pass.** Run 5 has B03 (`equalsCaptured`, uppercase search returns nothing), B06 (`notVisible`, the cancelled booking is still listed) and B08 (`equalsCaptured`, name reverts after reload) as failed checks, plus Explorer flags for B03 and B06. The same three appear in runs 2 and 3; in run 1 as flags and checks. **B01 and B02 were missed in all five Standard runs** (see the teach-back). B01 was then caught in the post-pin Quick smoke run (`…082522_ifha`: total 238.05 ≠ subtotal + GST 207.00) |
| B05 appears via edge inputs | **Pass.** DET-HTTP5XX `POST /api/bookings → 500` from the apostrophe-name variant in runs 1, 2, 3 and 5 (run 4 had no edge phase), plus the smoke run. The pre-filled "Full name" field was found by the form probe (D36) |
| Teach-back written | Yes (above) |

Also found by edge inputs: **B04** (a past date accepted), **B17** (double submit creates two bookings; `maxRequests`), and in run 5 **B18** (login messages reveal whether an account exists).

**Scorer notes (for Rohit to label).**
- B06's check failures read "…is still visible", but its firm rule wants "still present" or "remains". They match only the `confirm: manual` rule, so B06 shows as "not found" until labelled.
- Run 3's B15 "match" is a keyword hit on the Explorer flagging the injection-canary sentence ("inject"). It isn't the XSS bug; label it `fp`. D44 now stops that flag.
- `eval/results/p2-gate/summary.md` lists 37 findings needing a label. I haven't labelled any: labels are a human verdict (D25).

**Other checks.**
- `pnpm test`: 379 passed (engine 312, bench 40, eval 27).
- `pnpm typecheck`, `pnpm lint`, `prettier --check .`: clean.
- The P1 gate still holds: A0 buggy finds B09, B10, B12, B13, B14 and B16; A0 clean has 0 bug findings.
- Contamination tests pass for the prompts and all engine source.
- Secrets: the test password doesn't appear in `runs/`, `.witness-cache/` or any prompt (redaction test, plus a grep of the run folders).
- Spend on the OpenRouter account: **$3.03** for all of P2 (spike, probes, 3 Quick and 5 Standard runs).

**Post-pin smoke run** (`run_20260926-082522_ifha`, Quick, `ai@7.0.113`): 139 s, 31 calls, $0.23. It found B01, B05, B17 and B18 as candidates, and B09, B10 and B16 from the crawl, with no decoys.

### Notes for later phases (from P2)

- **P3 replayer:** it must log in itself (D37) and replay `check` steps with their captures. Edge-variant steps are stored on their journey (kind `edge`), and the candidate's `stepIds` give the order.
- **P3, locators the agent writes directly:** the smoke run's B01 check reads values with `{ by: "text", text: "$238.05" }`. That's stable only until the bug is fixed, so the exported test would error instead of passing. Agent-written read locators whose text contains digits should be converted to a stable one when stored (test id → label → css), as refs already are (D34).
- **P3, grounding quotes:** the agent quoted the labelled-amounts hint ("Subtotal: $180.00 …") rather than the page's own label, so code downgraded it to convention. Tell it to quote only the label, and consider verifying `ui_text` quotes against the page's visible text as well as the snapshot.
- **P3 skeptic, test cases from these runs:**
  - a Planner-guessed result text ("Booking summary" after confirming);
  - AI edge guesses on the "accept" side (decimal hours, mixed-case email, very large hours);
  - an expectation asserted before its moment ("without required fields → rejected" asserted after a full, valid submit).

  Consider capping AI-generated convention edge candidates at Needs review unless the page states the rule.
- **P4 demo:** Standard runs take 7–8 min, over the 5-minute target, so the demo should use Quick (~2.3 min) or a cached run. Prompt caching never hit for the Explorer (`cacheReadTokens` 0), probably because the prefix is under the model's minimum cacheable length.
- **P5 cost:** ~$0.50–0.61 per Standard run, so the ~23-run matrix is ≈ $12–14.

### P2 wrap-up — 27 Sep 2026

**Labelling rules (Rohit).**
- B06's failed checks and Explorer flags are `tp:B06`. Their wording ("…is still visible") misses the keywords of B06's firm rule, so they only matched the `confirm: manual` rule.
- The injection-canary flag is `fp`, consistent with D44. The same applies to run 3's canary flag (`fp_ab96703e98ce5bf5`), which matched B15 firmly on the keyword "inject". So **B15 was never actually found in P2**: the run-3 tick in the per-bug table is that keyword match.
- AI-guessed input rules (decimal hours, email whitespace or case, phone format, very large hours, and the Planner's "Booking summary" guess) are `fp` when the app never promised that behaviour.
- `tp_unseeded` only for something a real user would clearly hit.

The proposed labels for the 37 findings (19 fingerprints, plus run 3's canary flag) are with Rohit for approval. `eval/labels.json` is unchanged until then.

**Found while checking the evidence for those labels.** Four generic Witness defects, proposed as P3 fixes:
1. **`fieldRejected` misses a form-level rejection.** For "1000 hours" on the quote form, the server answered 400 and the page showed an alert ("Maximum booking is 12 hours"). The check only looks at the field itself (`aria-invalid`, browser validity, its described-by message) and the success signature, so it reported "accepted". Three fingerprints.
2. **Login-form variants drop the password.** The edge runner rightly never varies password fields, but it also leaves them out of the variant, so every "accept" variant on a login form submits with no password and can't succeed. The AI also swapped the account's email for an unknown one. Three fingerprints.
3. **A `visible` text check can't see a `<select>`'s chosen option.** "The service's hourly rate is shown" failed while the rate was on screen in the dropdown. One fingerprint.
4. **`ui_text` grounding accepts a quote from any recorded page.** "Booking summary" appears on the booking form, so an expectation about the confirmation page counted as grounded, at critical severity. One fingerprint, in four runs.

**D46 — P3 additions from P2 misses (Rohit, 27 Sep).** Each item answers something the P2 gate runs missed or got wrong:
- **DET-TOTALS** ← B01 was missed in all five Standard runs. The Explorer checked subtotal = rate × hours instead of the tax relation. A deterministic detector doesn't depend on the agent choosing the right check.
- **DET-SORT** ← B02 was missed in all five. The Explorer sorted a search-filtered list whose prices all had two digits, so a text sort and a numeric sort agreed.
- **Safe interaction sweep** (staging only) ← B11 was never found, because nothing clicked the collapsed item that throws.
- **Reflected-input probe** ← B15 was never found (see above). The canary only went into forms the Explorer happened to submit.
- **Cap AI-guessed input rules at Needs review** ← 14 of the 19 fingerprints are proposed as `fp`; 9 of those are AI-guessed edge-input rules. Replay won't remove them, because they reproduce.
- **Report note when D44 applies** ← a tester should see that page text aimed at AI tools was found and ignored, not have it skipped silently.
- **`caffeinate` for long runs** ← run 4 was lost to the laptop sleeping.

The rule for all of them: generic code, with no app names, routes, labels or bug knowledge (CLAUDE.md rule 4; the contamination test covers engine source). They were motivated by the bench, which is recorded here on purpose. Each is validated on SauceDemo where it applies (totals on the checkout overview, the inventory's sort dropdown), and E5/E6 check generality.

**D47 — A2 and A6 moved to stretch (Rohit, 27 Sep).** This protects the schedule: P3 now carries seven more items, and P3b sits between P3 and the feature freeze. B20 (served source maps) stays in the planned `bugs-v2.yaml` and the bench. Ground truth is written before detection is built, so an unbuilt detector shows as an honest miss in v2 recall rather than a bug quietly removed. Gate P3b is now B19 and B21–B23 (B20 only if A2 is built, B24 only if A6 is).

**Labels applied (Rohit approved, 27 Sep).** All 19 proposed labels plus run 3's canary flag (`fp_ab96703e98ce5bf5`) are in `eval/labels.json`, including `fp` for the "sort breaks search" flag. Re-scored into `eval/results/p2-gate/labelled/`; the original `summary.md` is left as the gate record. With labels: recall C+L **50–72%** (B06 and B08 now count), bug precision C+L **53–86%** (was 75–100% before labelling), 0 unlabelled, and B15 not found in any run.

**D48 — LLM budget is a hard limit (Rohit, 27 Sep).** Everything left (P3, P3b, P4, evaluation, demo) must fit in about **US$16.74**: the $6.74 left on the account plus at most one $10 top-up. Consequences:
- Develop and debug on the Quick budget with the response cache on (`--llm-cache rw`).
- Gates use the minimum runs: the clean-bench gates (P3, P3b) use 2 runs, not 3.
- No separate ablation runs. A1 and A3 are derived from the A2 runs (D51).
- P5 matrix: A0 as needed (free), A2 buggy ×3, A2 clean ×2, SauceDemo ×2, Friction ×1; the injection comparison ×1 only if budget allows.
- Spend is logged here after each gate. Claude warns Rohit before anything that would take total spend past **$15**, and says when the balance drops below **$2** (the moment to add the $10). "Total spend" is read as the OpenRouter account's total usage: **$3.26 on 27 Sep** (balance $6.74).

**D49 — Replay stops early (Rohit, 27 Sep).** Two attempts; a third only when the first two disagree. With 2/2 or 0/2 a third attempt can't change the tier (≥ 2/3 either way, or at most 1/3), so it's skipped and the report says "reproduced 2 of 2" or "0 of 2". This saves about a third of replay time and cost. FR-8 still reads "three attempts"; this is the recorded deviation.

**D50 — Journeys stay sequential; Standard gets fewer journeys (Rohit, 27 Sep).** Alternative: two journeys at once, each in its own browser. Rejected because they'd share one test account's data (one journey cancels a booking while another lists them), which produces exactly the false positives verification exists to remove. Instead, the Standard preset's journey count is reduced until a run with replay fits in 8 minutes; the number is set in P3 from a measured run.

**D51 — Derived ablation.** A1 (`ai-no-verify`) and A3 (`full-no-skeptic`) are scored from each A2 run's recorded stage tiers instead of separate runs (`EVALUATION.md` §2). Better control (same exploration, only verification differs) and no extra cost. What it can't show: a standalone A1 run would spend verification's time on more exploring.
