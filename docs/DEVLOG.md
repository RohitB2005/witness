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

### P3 decisions (27 Sep 2026)

**D52 — Two stored-only check types: `notPresent` and `linkWorks`.** `notPresent` (no element matches, visible or not) is what DET-XSS proves: the inert canary must never become an element. `linkWorks` follows a link *as it is on the page now* and expects a status below 400. A broken-link replay or test must not re-request the old URL: a fixed link may point somewhere new (found when the first B10 test kept failing after the fix). Neither is described to the LLM (the prompts are unchanged); they're written by code only.

**D53 — The scorer never reads the writer's words.** The reporter (LLM) rephrases each finding after a code fact check. The deterministic wording is kept in `finding.template`, and the scorer's keyword rules search that. Alternative: score the text people read. Rejected because recall and precision would then move with an LLM's word choice (e.g. "still visible" vs "remains" decides B06's firm rule).

**D54 — The automatic probes run beside the AI stages, in their own read-only browsers.** DET-SORT, the interaction sweep and the reflected-input probe need no LLM. They run in parallel with planning and exploring, which is free time in a Standard run. Each uses a separate write-blocking policy and production-strict destructive-verb rules, *even in staging*, so nothing they click or type can change data, and they can't disturb a journey's data. The sweep runs in staging mode only; the other two (GET only) run in both modes. The deterministic pipeline (A0) runs them too.

**D55 — How replay is scheduled.**
- **Path sharing.** Candidates from one recorded path share a replay: the longest path runs once per attempt, and each candidate is judged at its own step.
- **Order.** Replays run in priority bands: what could reach Confirmed first, then Likely, then the rest, and improvements last. Within a band, read-only paths run three at a time, then paths that wrote data run one at a time, so no two replays change the same account's data at once (D50's reasoning).
- **Limits.** Every attempt logs in afresh (D37), and has a hard cap: 45 s static, 90 s path. A SauceDemo run hung for about 3 minutes without it.
- **Attempts.** A static finding needs one fresh re-run (FR-8). A path needs two agreeing attempts (D49), so a path that only got one attempt before time ran out is Needs review, not Confirmed.
- **Judge and skeptic.** They start as each finding's replay finishes. They're fed through a queue to workers created outside the replay's no-LLM context, so the replay guard stays absolute. The guard caught the first version of this, which called the skeptic from inside a replay.

**D56 — A check that expects text from another page is capped at Needs review.** If an expectation's only grounding is a quote from a different page ("Booking summary" from the booking form, asserted on the confirmation page), the check can never pass on the page where it runs: it's a guess about where text will appear. Like D46's cap on AI-guessed rules, this applies in the derived A1 tiers too. Alternative: leave it to the skeptic. In the gate run the skeptic said "unclear", which left a critical false positive at Likely.

**D57 — Explorer prompt caching: the site map and the journey brief are cached blocks.** Haiku 4.5 only caches a prefix of at least 4,096 tokens (checked in Anthropic's docs). The Explorer's tools and system prompt are about 2,700, which is why P2 never got a cache hit. Each turn now starts with two stable blocks, each with a cache breakpoint:
- the crawl's site map: the same one the Planner sees, wrapped as untrusted page content, and useful to the Explorer for finding its way;
- the journey brief: the goal, plus the planned checks, fixed at the journey's first turn.

Result: cache reads went from 0 to about 107k tokens per Quick run, and Explorer cost from $0.146 to $0.069 per Quick run. The gateway also fixed a real bug this exposed: the call log kept one shared "current entry", so calls running concurrently (writer, UX reviewer, judge, skeptic) overwrote each other's log lines. Each call now has its own entry, with a regression test.

**D58 — DET-TOTALS, DET-SORT and DET-XSS findings carry an equivalent check.** Replay and the test exporter then treat them exactly like failed expectations. Their grounding is the on-screen labels (a sort option's own text, the breakdown's labels), so they can reach Confirmed.
- A DET-SORT finding's route is the control's page (`/services`), not the URL after sorting (`/services?sort`). The finding is about the control, and apps that don't put the choice in the URL then get the same fingerprint.
- Honesty note: under the frozen rules, B01 and B02 name only check types (`numericRelation`, `ordered`) in their firm rules. So DET-TOTALS and DET-SORT findings match B01/B02 only through the `confirm: manual` rules, and they need a human label. The rules weren't changed and the findings weren't renamed to fit them.

**D59 — Pages with an error status that render a working app page are crawled as pages.**
- **The cause.** SauceDemo answers a direct load of `/inventory.html` with 404 and then renders the app (a single-page app on a static host).
- **The rule.** An error-status document with no error wording in its headings and at least 5 controls in its main content is crawled, probed and planned like a page (`appRendered`, real status kept). A link to it isn't a broken link.
- **Also.** The logged-in crawl pass now also starts from wherever the login landed, which the start page may not link to.

Both came from validating the probes on SauceDemo; both are generic. The bench's real "Not found" page is unaffected (B10 is still found).

**D60 — Time split and Standard journeys (measured, D50).** First Standard run with 5 journeys: 453 s. Edge inputs skipped 23 of 29 variants, including the login-message comparison and double submit, and 3 of 5 journeys completed.
- **Now.** Standard plans **3 journeys**. Exploring stops starting turns at 50% of the budget, edge inputs at 64%, and replays and the judge/skeptic at 25 s before the end; the writer and UX reviewer use the rest. The login-message comparison runs alongside the edge variants.
- **Gate runs.** 444 s buggy (the last before the final 50/64 split), 274 s and 216 s clean.
- **Quick** keeps 3 minutes and 2 journeys; its verification window is tight (below).

**D61 — Exported tests.**
- **Shape.** One Playwright spec per Confirmed or Likely bug with replayable steps, plus `witness-helpers.ts` and a config. The helpers use the engine's own reading rules (amount parsing, D35's label → value rule, list reading, rejection signals, route patterns, message prefixes).
- **Secrets** come only from `WITNESS_TEST_USER` / `WITNESS_TEST_PASSWORD` (test). Judgements aren't exported (no deterministic assertion).
- **A bug found by E3.** `waitForLoadState("networkidle")` returns at once if the page reached that state earlier, so the first B05 and B15 tests asserted before the request finished and passed with the bug on. `settle()` now tracks in-flight same-origin requests, like the engine's recorder.
- **New command.** `pnpm witness export <run>` rewrites a finished run's reports and tests without scanning again.

### Dependencies added in P3

| Package | Where | Why |
| --- | --- | --- |
| @playwright/test 1.63.0 | root (dev) | Exported regression tests import it, so they must run from the repo (E3, the exporter's round-trip test). Same pinned version the bench already had, so nothing new was downloaded |

### P3 — 27 Sep 2026

**Built.**
- `verify/`:
  - evidence validation;
  - the **replayer** (D55);
  - the **judge** and **skeptic** (one structured call each, zod-validated, downgrade-only);
  - `tier.ts`, a pure function with table tests, recording each finding's tier at every stage (D51).

  The deterministic pipeline (A0) replays too (D26).
- `probes/`: **DET-SORT**, the **interaction sweep**, the **reflected-input probe** (D54). `detectors/totals.ts`: **DET-TOTALS**.
- Fixes found while labelling P2 (all generic):
  - `fieldRejected` counts a form-level alert or a 400/409/413/422 on the submit;
  - a dropdown's chosen option counts as visible text;
  - `ordered` reads each item's money amount;
  - login-form variants keep the password and never expect a changed login detail to be "accepted";
  - `ui_text` self-reference (D56);
  - value locators the agent wrote with digits are re-located by test id or position.
- Also generic:
  - typographic quotes match straight quotes in text checks;
  - the D46 cap on AI-guessed input rules;
  - the D44 report note (code finds page text addressed to automated tools and says it was ignored).
- `report/`:
  - the **writer**, with a fact check and template fallback;
  - the **UX reviewer** (quotes verified on the page);
  - severity rules for the new detectors;
  - Markdown and **self-contained escaped HTML**;
  - `export/`, the **Playwright test exporter**.
- CLI:
  - HTML output by default and tests in `runs/<id>/tests/`;
  - `witness suppress <fp> --origin --reason` (FR-12; suppressed findings are Discarded);
  - `witness export <run>`;
  - `caffeinate` on macOS for the length of a scan.
- `eval/`:
  - derived A1/A3 scoring from stage tiers (D51);
  - template-based keyword matching (D53);
  - `pnpm eval:tests` (E3).
- Tests: 469 (from 379).

**How data flows now.** The crawl is as in P1. Then:
1. **In parallel:**
   - the probes (sort, sweep, reflected input);
   - the AI stages: plan, explore (site map + journey brief cached), edge inputs, and the login-message comparison.
2. **Verify.** For each group of candidates:
   - check its evidence;
   - replay it without the LLM;
   - as each replay finishes: the judge for a flag, the skeptic for an arguable failure;
   - suppression;
   - tier (with the A1/A3 stage tiers).
3. **Report.** Findings; then, side by side, the writer (fact-checked; the template is kept) and the UX reviewer (skipped on Quick); then the verdict, "what wasn't tested" and notes.
4. **Export.** JSON, Markdown, HTML, and one regression test per exportable bug.

**How a replay decides (for Q&A).** Take B06 from the gate run. The Explorer cancelled HC-1002 and asserted it disappeared. The check failed: HC-1002 was still listed, because the bug deletes the next booking. The candidate carries its steps (go to /login, log in, go to /bookings, click "Cancel booking HC-1002", click "Yes, cancel", the check).
1. The replayer opens a fresh browser and logs in with the vault's password (never the session recorded earlier).
2. It clicks through the same stored locators, then evaluates the same check at the same step.
3. It fails again, so that's attempt 1 reproduced. Attempt 2 reproduces too, so it stops (D49).
4. The skeptic argues the innocent case and says "bug_likely". The expectation's grounding is verified on-screen text ("Cancel booking HC-1002" is the button being tested), so the tier is **Confirmed**.

The same finding on a fixed app: the first click removes HC-1002, the check passes, 0 of 2, and the finding is Discarded. That is exactly what the exported test encodes: it fails with B06 on and passes with it off (E3).

**Key decision + alternative.** Detectors produce *checks* (D58), and probes run in their own read-only browsers (D54). Alternative: special-case each new detector in replay and export. Rejected: one mechanism (steps + a check) now covers every finding type, so each new detector got replay and a regression test for free. On the bench, all 12 exported tests matched to seeded bugs behave, including DET-TOTALS (B01), DET-SORT (B02) and the probes' XSS (B15).

**Most likely failure mode.** Journey completion is noisy, and it decides the journey-only bugs (B03, B06, B08). The gate's buggy run completed 1 of 3 journeys (step budget, then time) and missed all three; the same code completed 3 of 3 on both clean runs, and 3 of 5 in the first Standard run (which found B06 at Confirmed and B08 at Likely). The probes and DET-TOTALS made the rest far less dependent on the agent: A0 alone went from 33% to 44% recall at C+L (+B02, B11, B15). Second risk: Quick's verification window (about 45 s) is too short to replay everything. Findings not replayed are honestly marked Needs review, but a Quick report has fewer Confirmed than the same findings would reach on Standard.

**Problems hit** (all fixed, with tests):
- **The call log dropped entries under concurrency** (D57).
- **The replay guard fired on the pipelined skeptic** (D55). The guard was right; the fix was a queue, not an exception to the guard.
- **Exported tests asserted too early** (`networkidle`, D61), and the **broken-link test re-requested the old URL** (D52).
- **A replay attempt hung for about 3 minutes** on SauceDemo, which led to the per-attempt caps (D55).
- **SauceDemo's 404-status app pages**, and the login landing page not linked from the start page (D59).
- **One XSS reported twice**: the edge inputs and the reflected probe used different group keys. It's now one key per page path and field.
- **Double work and "not replayed" on Quick**: read-only improvement re-runs queued ahead of high-priority write paths. Fixed by the priority bands (D55).
- **A curly-quote false positive**: "No services match "deep clean"" vs “deep clean”. Fixed in the evaluator; no user tells those quotes apart.
- **A bench port in a comment of the generated test config**, caught by the contamination test and made generic.

**Validation on SauceDemo (D46: "where they apply"; A0, staging mode, no LLM).**

| Item | Result |
| --- | --- |
| DET-SORT, `problem_user` (S2) | "Name (Z to A)", "Price (low to high)" and "Price (high to low)" flagged, all Confirmed by replay; "Name (A to Z)" (the default, correct) not flagged (`run_20260927-042918_r0zc`) |
| DET-SORT, `error_user` (S6) | The same three flagged; the "Sorting is broken!" alerts were dismissed and logged (`run_20260927-053440_ip1m`, 30 s) |
| DET-SORT, `standard_user` | 0 bugs (`run_20260927-043003_lrjt`) |
| DET-TOTALS, checkout overview (`standard_user`, reached by a scripted flow; the crawl can't get there) | Real page (Item total $39.98 + Tax $3.20 = Total $43.18): no finding. Same page with the total altered to $99.99: one finding, and its check fails |
| Interaction sweep / reflected input | Ran; nothing to find (no collapsed sections that crash; no GET search form) |

**Gate P3 results (27 Sep 2026, macOS, production bench on :5180, Standard budget, test account, Sonnet 5 + Haiku 4.5).** Results in `eval/results/p3-gate/` (runs.jsonl, summary.{json,md}, export-tests-*.json).

| Gate criterion | Result |
| --- | --- |
| A2 on the clean bench: zero Confirmed findings (2 runs, D48) | **Pass.** `…075935_ps4l` (274 s, $0.25) and `…080410_mmbp` (216 s, $0.14): 0 Confirmed and 0 Likely bugs in both; only AI-guessed items at Needs review (decimal hours; "booking summary doesn't update"). 3 of 3 journeys completed in both |
| Every exported test from a buggy run fails with its flag on and passes with it off | **Pass.** `…053847_3ih8`: 13 tests exported; **12 of 12** matched to seeded bugs behave (B01 ×3, B02, B05, B09, B10, B11, B15, B16, B17, B18). The 13th is the "Booking summary" false positive (no flag to test; D56 now keeps such findings out of exports). Earlier runs: 10/10 (Standard), 6/6 (A0) |
| Teach-back written | Yes (above) |

Buggy gate run `…053847_3ih8`: 444 s, 70 LLM calls, $0.376. Before labelling: recall C 50% / C+L 67% / all 72%, bug precision C+L 100%. Missed: B03, B06 and B08 (journey completion, above), and B07. The A1/A3 derived rows equal A2 in this run, because everything verification removed was unlabelled. A0 on the same code: recall C+L 44% (P2: 33%), and 0 bug findings on the clean bench.

**Needs a label (10 fingerprints, `summary.md`).** DET-TOTALS (B01) and DET-SORT (B02) are tentative matches under the frozen rules (D58). Plus: the "Booking summary" false positive, "$45 per hour", "booking summary doesn't update", and five UX suggestions. One UX suggestion ("no feedback after clicking Calculate") matched decoy D03 by keyword; it's an improvement, so it doesn't touch bug precision. I haven't labelled any (D25).

**Spend.** OpenRouter total usage **$4.93** (P2 wrap-up: $3.26), so P3 cost **$1.67**:
- development: 3 Quick runs and 1 Standard run;
- gate: 1 buggy and 2 clean Standard runs.

Balance: $5.07. Per Standard run now: about $0.14–0.38 (the Explorer's cache reads are most of the saving).

**Other checks.** `pnpm test` 469 passed; `pnpm typecheck`, `pnpm lint`, `prettier --check .` clean. Contamination tests pass for prompts and all engine source. Secrets: exported specs contain only environment lookups (test), and runs are redacted on write.

### Notes for later phases (from P3)

- **P3b** starts with the bench additions and the second freeze, then A1 → A4 → A3 → A5 (A2 and A6 are stretch, D47).
- **Labels:** Rohit to label the 10 fingerprints above (B01/B02 via DET-TOTALS/DET-SORT need `tp:` labels to count).
- **Journey completion** is the biggest recall variable (B03/B06/B08). Worth watching in P5; don't tune on the bench.
- **Duplicate B01 findings** (the Explorer's own checks plus DET-TOTALS on the same breakdown) aren't merged. Harmless for recall, noisy in a report.
- **Quick** replays only what fits in about 45 s. For the demo, use a Standard run or a cached one.
- **P4** needs the same `writeRunExports` for the dashboard's downloads, and the server needs `caffeinate` too.

### P3 wrap-up — 27 Sep 2026

**Approved by Rohit:** D50/D60 (Standard = 3 journeys, the new time split), D52, D53, D56 and D59. On D59: SauceDemo influenced the crawler, so it's no longer a fully held-out test. That is noted in `EVALUATION.md`, and the **Friction app stays completely untouched (no runs, no tuning) until P5**.

**Labels applied** (15 new in `eval/labels.json`). Rohit gave four:
- DET-TOTALS → `tp:B01`;
- DET-SORT → `tp:B02`;
- the "Booking summary" guess → `fp`;
- the sold-out UX suggestion → `fp`: it's decoy D01, and missed D01's rule only on "Sold-out" vs "sold out".

I checked the other six against the clean bench:
- `fp`: "$45 per hour" (the dropdown-text issue fixed in P3), and "booking summary doesn't update" (it does update; the check compared the dropdown's number).
- `tp_unseeded`: the empty booking summary before input, the sold-out service not marked on /quote, and the unexplained "Recommended" sort. All three are true on the clean bench.
- **Judgement call, flagged to Rohit:** "GST note not repeated on the booking page", labelled `tp_unseeded`. True: /book shows only "excl. GST" next to the estimate and never says GST is added. One run's wording overstated it.

One more, found in the confirmation run below: `fp` for a check that wanted the booking count unchanged after a cancel. Its own statement said "one fewer", and 5 → 4 is correct.

**Were the derived ablation rows broken? No: verification genuinely changed almost nothing *measurable* in these runs.** The stored stage tiers show why:
- replay discarded nothing (the bench is deterministic);
- the old A1 kept the D46/D56 grounding caps, so A1 had the same Needs-review items as A2;
- the skeptic's two downgrades fell on findings that were still unlabelled, which the scorer leaves out.

So A1 was measuring the wrong thing, not failing to measure.

**D62 — A1 is the raw AI claims** (Rohit, 27 Sep; replaces D29's A1 rule). Every bug candidate counts at face value (Confirmed), including ones verification later discarded, before the grounding caps, evidence validation, replay, judge and skeptic. `verify/tier.ts → unverifiedTier` records it that way. The scorer also computes it directly from the findings, so the gate runs are scored under the new definition without new runs.

Result (`eval/results/p3-gate/summary.md`):

| Run | A1 raw claims | A3 no skeptic | A2 full |
| --- | --- | --- | --- |
| Buggy gate `…053847` | recall C 78%, bug precision C+L 81% | recall C 61%, precision 86% | recall C 61% / C+L 72%, precision **92%** |
| Buggy confirmation `…085623` | recall C 78%, precision 81% | 61%, 92% | 61% / 72%, **92%** |
| Clean `…075935` | **1** false bug at Confirmed | 0 | **0** |
| Clean `…080410` | **2** false bugs at Confirmed | 0 | **0** |

In words: trusting the AI would put every guess at Confirmed. That gives more Confirmed recall (78%: B04 and AI-guessed rules count), but it reports false bugs on a clean app and loses 11 points of precision. Verification removes those false bugs, at the cost of B04 dropping to Needs review (the agreed D46 trade-off).

**Discard funnel (bug findings; `run.json` tier reasons):**

| Run | Candidates → groups → bugs | Evidence invalid | Not reproduced | Judge "not a bug" | AI-guessed cap (D46) | Text from another page (D56) | Skeptic ↓ | Not replayed / intermittent | Convention (Likely) | Final C / L / NR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `…053847` buggy | 35 → 23 → 16 | 0 | 0 | 0 | 1 | (1 at Likely: before D56) | 2 | 0 | 4 | 8 / 5 / 3 |
| `…085623` buggy | 33 → 23 → 16 | 0 | 0 | 0 | 0 | 1 | 0 | 3 | 4 | 8 / 4 / 4 |
| `…075935` clean | 4 → 4 → 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 / 0 / 1 |
| `…080410` clean | 5 → 5 → 2 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 / 0 / 2 |

On this bench, the work is done by grounding and the skeptic, not by replay: every bug reproduces. Replay's value (dropping flaky or environmental failures) will only show on apps with non-deterministic behaviour (P5: SauceDemo, Friction). Say so plainly in the talk.

**Why only 1 of 3 journeys completed in the gate run (diagnosed from its step logs).**
1. **"Get a price quote" used all 25 turns after its goal was done.** Once its total check failed (the B01 bug), the Explorer restated the same failing rule as new expectations: "…the correct total price…, with GST applied correctly", four times. Each was accepted as a new expectation, so it never finished.
2. **"Manage account and bookings" hit the time limit after 5 steps.** Nothing was wrong with it; the two journeys before it used the whole exploring window. It is the journey that holds B06 and B08. The search journey that holds B03 wasn't planned in this run.

**D63 — A result is recorded once, and journeys share exploring time fairly.** Both generic:
- **Restatements.** A new expectation that restates a decided one is refused, with "already recorded as FAILED/passed; carry on or finish". That means the same statement as any decided expectation, or a wider restatement of one that FAILED. A *stricter* version of one that passed is still allowed, because a weak check can pass where a precise one fails (B01's history). Three refusals stop the journey. The Explorer prompt says the same.
- **Time.** Each journey gets a fair share of the exploring time left, and time a journey doesn't use carries over, so one slow journey can't starve the rest.
- Tests: `duplicateOf` in `explore/edge.test.ts`.

**Confirmation run** (`run_20260927-085623_kd8k`, final code, buggy, Standard). 470 s, 67 LLM calls, $0.28.
- **Journeys: 2 of 3 completed** (gate run: 1 of 3). "Get a price quote" completed in 11 steps with no restatements, and "Manage account and bookings" completed (17 steps).
- **"Book a cleaning service" ran out of its time share for a different reason.** After confirming a booking, the Explorer went back and made a second one. That's the agent wandering, not the causes fixed here. I recorded it rather than tuning on the bench.
- **B03, B06 and B08 are still missed, now because of the checks the Explorer wrote**, not because journeys didn't finish:
  - its cancel check compared booking *counts*, which B06 doesn't change;
  - its profile check saved without editing anything, so B08 can't show;
  - no search journey was planned.

  The agent's choice of check remains the main recall limit (P2 teach-back).
- **E3:** 12 tests; 11 of 11 real seeded bugs behave. The 12th is the count-check false positive above. Its test fails on a correct app too, which is right, since the test encodes the wrong expectation.

**Spend.** OpenRouter total usage **$5.24** (after the P3 gate: $4.93). This wrap-up (one Standard run) cost $0.31. Balance: $4.76.

### P3b decisions (27 Sep 2026)

**D64 — Four test-design habits added to the Planner and Explorer guidance** (Rohit, 27 Sep). They're standard QA practice, written generically, and motivated by the P3 misses (B03, B06, B08 in the confirmation run):
- **Removals:** check that the specific item is gone (`notVisible`) and another remains (`visible`), not a count. ← B06: the cancel check compared counts, which B06 doesn't change.
- **Saves:** change a value, save, capture, reload, compare against the new value. ← B08: the profile check saved without editing anything.
- **Coverage (Planner):** every main interactive feature in the map (search, sort, filters, forms) is exercised by at least one journey, combining features when journeys are scarce. ← B03: no search journey was planned.
- **Finish when done (Explorer):** once the goal is reached, don't repeat its action. ← the booking journey made a second booking and ran out of time.

No bench words in either prompt (the example for "repeat" is "creating a second record"). Measured by a dedicated buggy Standard run *without* requirements in the P3b gate (Rohit chose option b), because the requirements run would confound it: `SCOPE.md` mentions search and cancelling.

**Second freeze: `bench/bugs-v2.yaml` frozen at `576591a`** (27 Sep), together with `bench/SCOPE.md` and the bench's v2 flags B19–B23 and decoys D05–D06, before any detector was written. `bench/bugs.yaml` is untouched. Bench tests: 61 pass, and each new flag's test fails when only that flag is on. The clean-build audit now includes the new booking details page and its reschedule states.

**D65 — How the v2 bench bugs are built.**
- **B19 and D05 live in a server-generated `/config.js`**, not the Vite bundle. Flags toggle at runtime, but the bundle is built once, and esbuild folds `"sk_" + "live_" + …` into one literal, which would put a full fake key in `dist/` whatever the flag. The server assembles the keys from fragments per request.
- **B20** builds hidden source maps (no `sourceMappingURL` comment). With the flag on, the server serves the maps and adds a `SourceMap` header.
- **B21 and B23 needed a new page.** The booking details page (`/bookings/:ref`, linked from My bookings) is what calls `GET /api/bookings/:ref`, and it is where rescheduling lives when B23 is off. Because the logged-in crawl reaches it, DET-AUTHZ can find B21 without the AI.
- **B22** triggers on `'` only. The XSS canary contains `"` and no `'`, so B15 and B22 don't mask each other when both are on.

**D66 — One run-level response observer feeds the three security detectors.** `record/responses.ts` attaches to every browser context the scan opens, through a registration in `browser/context.ts`. Crawl, journeys, edge inputs and probes are therefore covered without threading a new dependency through each stage. Replays and preflight opt out: replays repeat what was already seen, and preflight's context changes session mid-way when it logs in. Bodies (documents, scripts, JSON; up to 2 MB) are scanned in memory and dropped; only redacted matches, and the first logged-in JSON body per endpoint (for DET-AUTHZ's comparison), are kept, in memory. Alternative: have each stage's `PageRecorder` read bodies. Rejected: seven call sites, and the probes' and edge runner's contexts would be easy to miss. The detectors run once, after exploring and before verification, and verification re-fetches each finding (DET-AUTHZ with no cookies).

**D67 — DET-AUTHZ only tries endpoints that look private, and compares paths, not queries.** An endpoint is tried without a login only if it answered 200 while logged in, never answered 2xx logged out, and was called from a page that can't be reached logged out, or its data has contact fields (email, phone, address). "Same records" means the same key paths and at least half the values equal; an empty list never counts. **Found in the Quick smoke run:** keying endpoints by path *and* query keys made the public `/api/services?q&sort` (only the logged-in Explorer used those keys) look private, and it was reported: decoy D06's exact claim. Query keys don't change who may read an endpoint, so both the endpoint and the calling page are now compared by path. Fixture regression test added. Generic by construction.

**D68 — Reference numbers are IDs in route patterns.** A path segment with a short letter prefix and 3+ digits (`ORD-1042`, `INV2024`) now becomes `:id`, like numbers and UUIDs. Without it, each booking page was its own route (three DET-AUTHZ findings for one bug) and the crawl spent pages on duplicates. `v2`, `s1` and `page-2` stay words (tests).

**D69 — A database error and its 500 are one finding, led by the DB error.** DET-DBERROR uses DET-HTTP5XX's group key (method + path, no query) when the status is 5xx, and grouping puts the more specific detector first (`leads` in `report/findings.ts`). **Also found in the smoke run:** the first version keyed on path + query, so the 500 showed separately as "search crashes the page". A DB error seen in the response to a *write* request (an edge input) isn't re-sent on its own by replay, so it stays Needs review ("not replayed") rather than being discarded.

**D70 — Acceptance criteria: the Planner reads, code decides.** The Planner splits the requirements into numbered criteria, each with a verbatim quote (dropped if it isn't in the requirements), and links expectations and journeys to them. Every status is computed from the run: Verified (a linked check was evaluated and none failed), Failed (a linked check failed at Confirmed/Likely), Not found, Not tested (with the reason). "Not found in the app" needs two things: the Planner saw nothing for it, *and* no recorded page (crawl, journeys, probes) mentions the words it would use. It's a new source kind (`requirement`, `REQ-NOTFOUND`) capped at Likely, because an absence can't be replayed. **In the smoke run** the Planner called three existing features missing (My bookings, cancel, profile); the page search found their words and made them "Not tested" instead of false findings. I clarified in the prompt that `foundInApp` means "the app appears to have it", not "I'll test it". The criteria section is only added to the Planner prompt when requirements are given, so runs without them are unchanged.

**D71 — Secret keys are redacted in three places, whoever wrote the text.** `redactSecrets` (the same high-confidence patterns, first 4 + last 4) runs inside the JSON store on every text write (always, whatever redact function the caller passes), in the exporter, and in the gateway on every prompt, next to the vault placeholders. Findings only ever carry the redacted form plus a 12-character hash to match replays. Google `AIza…` keys are reported at Needs review (a `review` cap on the candidate; `verify/tier.ts`), and Firebase web configs, Supabase anon keys and publishable keys aren't findings.

**D72 — P3b gate runs use `--llm-cache off`.** With the cache on, the second clean run would reuse the first one's plan and edge answers (P2 noted this), and two runs would really be one. It costs a few cents more.

**Scoring notes (for P5, not changed now).** `pnpm eval:score --bugs bench/bugs-v2.yaml` scores against v2. The scorer's source ID now covers any source with an `id` (`REQ-NOTFOUND`). Two things for P5's combined scoring: (1) scoring one file shows the other file's true positives as unlabelled, so precision is only meaningful combined; (2) v1's frozen B15 keyword rule (`category: security`, "inject") also matches DET-DBERROR's title "possible SQL injection". B15 is found through DET-XSS anyway, so v1 recall doesn't change, but v1 precision counts that finding as a B15 true positive. Neither frozen file was edited.

**D73 — Found in the clean gate run: a logged-out context that logs in is no longer "logged out".** Some journeys start logged out and sign in partway through. Their context was labelled anonymous, so private API calls after the login counted as "answered without a login", and DET-AUTHZ skipped those endpoints as public: 0 tried in clean run 1, only 1 in the buggy runs. Now a context stops counting as logged-out evidence from its first same-origin write request, marked when the request starts, because a login's redirect may never surface as a response. Crawl and probe contexts never write, so nothing else changes. Regression test in `test/security-scan.test.ts`. Clean run 2 ran with this fix: 3 endpoints tried, all refused, no finding. This only ever makes more endpoints eligible, so any new risk is a false positive, which is exactly what clean run 2 and the A0 clean run measure. The buggy runs, made before the fix, found B21 anyway.

**D74 — A requirement missing from the app is never exported as a test.** Found by E3 on the v2 findings: the "Not found" finding became a spec with no assertion, which passes on any build. An absence has nothing to assert, so it's now skipped with that reason (unit test).

### P3b — 27 Sep 2026

**Gate P3b — passed.** Production bench on :5180, Standard budget, logged in as the test account, `--llm-cache off` (D72). Results: `eval/results/p3b-gate/` (`runs.jsonl`; `v1/` and `v2/` summaries).

| Gate item | Result |
| --- | --- |
| B19, B21, B22 detected (buggy) | All three **Confirmed** in both buggy runs and in A0 (`…125512_jhx0`, no LLM). B21's finding is critical (personal fields); the key is shown as `sk_l…CRET` |
| B23 detected (buggy, `--requirements bench/SCOPE.md`) | **Likely**: "No way found to reschedule an existing booking" (`…130217_vg4y`). AC9 is Not found; the page search looked for "Reschedule", "Change date", "Edit booking" across 24 pages |
| B20 | Not built (A2 is stretch, D47): an honest miss in v2 recall |
| D05, D06 not flagged | Not flagged in any run (the smoke run's D06-style false positive was fixed first, D67) |
| Zero new Confirmed on the clean bench, 2 runs | `…131858_a21a` and `…133005_qn8k`: **0 Confirmed, 0 Likely bugs** (1 and 3 at Needs review). A0 clean: 0 bugs |
| Clean criteria only Verified or Not tested (Rohit's addition) | Run 1: Verified 5, Not tested 6. Run 2: Verified 4, Not tested 7. **None Failed or Not found**; AC9 (reschedule) is Verified on the clean build in run 1 |
| Secrets redacted everywhere | Test `test/security-scan.test.ts` walks every file a run and its exports write; plus a real check: the bench's full fake key appears in **no file** of the four buggy runs (reports, run.json, evidence, LLM call logs, tests) or the response cache. Gateway test: a key in page content reaches the model as `sk_l…EKEY` |
| New booking details page passes the clean audit | `pnpm bench:test`: 61 passed; the audit covers `/bookings/HC-1001`, the reschedule form and the rescheduled state |

**E3 on the v2 findings** (`pnpm eval:tests … --bugs bench/bugs-v2.yaml`): the exported tests for B19, B21 and B22 each fail with only their flag on and pass with it off (3/3). B23's spec was the D74 defect, now fixed.

**Recall** (C = Confirmed; C+L = Confirmed or Likely):

| Run | v1 recall C / C+L | v2 recall C / C+L | Journeys | Time | Cost |
| --- | --- | --- | --- | --- | --- |
| Buggy + requirements `…130217_vg4y` | 72% / **83%** | 60% / **80%** | 1 of 3 | 489 s | $0.42 |
| Buggy, no requirements `…131110_waqv` (option b) | 67% / 72% | 60% / 60% (B23 needs requirements) | 2 of 3 | 419 s | $0.41 |
| A0 buggy `…125512_jhx0` | 50% / 50% | 60% / 60% | – | 78 s | $0 |
| P3 confirmation run (for comparison) | 61% / 72% | – | 2 of 3 | 470 s | $0.28 |

Bug precision is 100% on every buggy row, but that's before labelling. Scoring one truth file shows the other file's true positives as unlabelled (see the scoring notes above).

**What the guidance change (D64) did, measured without requirements** (`…131110_waqv`, option b):
- **B06 and B08 are now Confirmed; both were missed in the P3 confirmation run.** The cancel check was `all: [notVisible of the removed booking, visible of another]`, and the profile check changed the name, saved, reloaded and compared. These are exactly the two habits.
- **Coverage:** the first journey now combines browsing, search and sort.
- **B03 is still missed.** The search check it wrote was only "results are visible", which can't see case sensitivity. Recorded, not tuned.
- **Finish when done:** the booking journey didn't make a second booking, but it did run out of its time share (49 steps).
- v1 C+L equals P3's (72%): the B06/B08 gains were offset by B04 and B05 not being found this run (the booking journey ran out of its time share). One run each, so this is direction, not a measured effect size.

With requirements, v1 rises to 83% C+L: the SCOPE.md criteria pulled the past-date and apostrophe checks (B04, B05) into the plan.

**Proposed labels (for Rohit; `eval/labels.json` is unchanged):**
- `tp:B06`: `fp_a4abe8cbebd37e3b`, `fp_8c961abfcbec67da`, `fp_6b42bd7cd3ba2655` (a second cancel finding next to the Confirmed one; the duplicate problem from P3's notes).
- `tp:B08`: `fp_8e5d8914cb66379e`, `fp_164ec372b85c1608`.
- `fp`: the AI-guessed input rules at Needs review (`fp_e38a34ecea756a5f` half hours; phone format `fp_e9638a3d5b6b4bdd`, `fp_755e1d5164900d54`, `fp_316a32c2cba4ab42`, `fp_3aa7507552778b32`); the contact form "doesn't confirm" (`fp_cd9227181d688f8a`, `fp_ec3facead619473a`: the clean bench shows "Thanks — we'll reply within one working day", so the check was wrong); and the D44 canary suggestion `fp_20404a92a3d47f6e`.
- **Also for Rohit:** the UX suggestion "Quote page has no way to proceed to booking" matched decoy D03 by keyword in clean run 2. It isn't D03's claim (the spinner), just a keyword collision. Suggest `fp` (it's arguably true: there's no "Book this" from the quote), or `tp_unseeded`.
- The v2 true positives (B19, B21, B22, B23) match v2's firm rules and need no label. For P5's combined score they'll need `tp:B19`-style labels, or a combined truth file.
- The other UX suggestions (price-unit wording, date hint, login redirect note, "When" field) need a look at the clean bench before labelling; I haven't checked them.

**Spend (D48).** OpenRouter total usage **$6.81** (after P3: $5.24). P3b cost **$1.57**: the Quick smoke run $0.16, two buggy Standard runs $0.83, two clean Standard runs $0.58. **Balance $3.19**, above the $2 line. At about $0.35 per Standard run, that's roughly nine runs, and the P5 matrix alone plans eight (A2 buggy ×3, clean ×2, SauceDemo ×2, Friction ×1), so the $10 top-up will likely be needed before P5.

**Teach-back — P3b, the QA coverage pack.**

*What was built.* Three security detectors and an acceptance-criteria check, on a bench extended to test them.
- **DET-SECRETS** finds secret keys in anything the browser downloads.
- **DET-DBERROR** finds database error messages in responses and pages.
- **DET-AUTHZ** finds APIs that hand out private data without a login.
- **Requirements coverage** takes a scope document, splits it into acceptance criteria, and reports each one as Verified, Failed, Not found or Not tested.

*How data flows.* One observer watches every browser the scan opens (not replays) and looks at each same-origin response once.
- **Secrets and DB errors.** Text bodies are scanned in memory for key patterns and database error messages. Only redacted matches are kept; the bodies are thrown away.
- **Private APIs.** The observer notes which GET endpoints answered without a login, and keeps, in memory, the first logged-in JSON answer from each endpoint.
- **After exploring**, three things happen:
  - the secret and DB-error matches become candidates;
  - each logged-in-only endpoint called from a private page is requested again from a browser with no cookies, and if the same records come back, that's a finding;
  - the Planner's "not found" criteria are checked by searching every recorded page for the words the feature would use.
- **Verification** re-fetches each security finding exactly the way it was found. A not-found criterion is Likely at most, because an absence can't be replayed.
- **Coverage** is decided in code: a criterion links to expectations, and their results (passed, failed, never reached) decide its status.

*The key decision, and its alternative.* The key decision is: the AI reads, code decides.
- **The alternative** was to let the Planner mark criteria met or missing directly. That's faster, and it's the obvious design.
- **Why not.** In the smoke run the Planner called three existing features missing. The code check found their words on real pages and turned those three into "Not tested" instead of false bugs.
- **Same pattern for security.** A regex decides what a secret is, and a real no-cookie request decides whether data is private.

*The most likely failure mode.* DET-AUTHZ's idea of "logged out".
- **Found in this phase.** A journey that logs in partway through made private endpoints look public (D73).
- **Still true.** An app that gives every visitor a cookie still works, because logged-out evidence comes from contexts that never logged in. But an app whose private pages share one route with its public pages (a dashboard at `/` that changes after login) will only be checked when the data has contact fields.
- **"Not found".** The Planner can pick words the app doesn't use for a feature it does have. The finding is then a Likely false bug that a person has to dismiss.

*Say plainly in the talk.* A2 (served source maps) and A6 (prompt injection) aren't built. B20 is an honest miss. The bench's security bugs are easy for the detectors by design; the evidence that they generalise will be SauceDemo and Friction in P5.

### P3b loose ends — 28 Sep 2026

No paid runs. Tests: 32 files, all pass.

**Labels applied** (23 new in `eval/labels.json`; re-scored into `eval/results/p3b-gate/labelled/{v1,v2}/`; the gate's own `summary.md` files are left as the record).
- As proposed: `tp:B06` for `fp_a4abe8…` and `fp_8c961a…`; `tp:B08` for `fp_8e5d89…` and `fp_164ec3…`; `fp` for the five AI-guessed input rules, the two contact-form checks and the D44 canary suggestion.
- **Rohit's changes:**
  - `fp_6b42bd7cd3ba2655` → `fp`. It comes from clean run `…131858_a21a`, so it can't be B06: the booking was removed, and the Explorer read the "Booking HC-1001 cancelled." message as the booking still being there. Its check twin, `fp_2ea3c4d580491a45` (notVisible "HC-1001"), gets the same label and reason.
  - `fp_5feb33a82b0e8a81` → `fp`. "Book this clean" appears after Calculate; the reviewer only saw /quote before a quote.
- **The other UX suggestions, checked against the clean bench's source** (`bench/app/src/client/pages/`):
  - `tp_unseeded` ×4:
    - `fp_85e5cf…` and `fp_8c2541…`: /book's service dropdown drops the prices /quote shows.
    - `fp_93ef4f…`: /login?next=… gives no reason for the redirect.
    - `fp_61b812…`: /quote lists the sold-out service as normal; same as P3's `fp_8f54cc…`.
  - `fp` ×4:
    - `fp_5d1df8…`: "When" does fill in once a date is chosen.
    - `fp_fcfdeb…`: Date is a native date input, which shows its own format.
    - `fp_110f44…`: every price says "per hour" or "fixed price".
    - `fp_7b1e72…`: the GST note states the rule, and the breakdown appears right after Calculate. **Judgement call, flagged to Rohit:** "easy to miss" is a styling claim the reviewer can't see.
- **Effect:**
  - Clean runs: 0 unlabelled; A1's false bugs at Confirmed stay at 3 per clean run, and the old A1 clean-row "6% recall" artifact is gone.
  - Buggy v1: precision C+L 100% (A2), 88–89% (A1). The remaining 2–3 unlabelled are v2's true positives, the single-file limit already noted (combined scoring added to ROADMAP P5).

**D75 — Removal checks target the removed item's own control or row, not its text anywhere** (Rohit, 28 Sep; revises D64).
- **What went wrong.** In clean run a21a the cancel check was notVisible `{ by: "text", text: "HC-1001" }`. It failed on a correct app because the `role="status"` message "Booking HC-1001 cancelled." names the booking. Confirmation messages often repeat the item's name, so this happens in apps generally, not only the bench.
- **Rejected: ignoring status and alert regions in the evaluator.** Errors, "Saved", loading and thank-you messages live in exactly those regions. "No error is shown", "invalid input doesn't show 'Saved'" and "the loading message goes away" would always pass, and so would their exported tests.
- **The fix is where the check is written.**
  - The Planner and Explorer removal habit now says: target the item's own control or row by role and accessible name (e.g. `{ by: "role", role: "button", name: "Delete invoice 42" }`), or its text `within` the list or table that holds the items. Never its text anywhere on the page.
  - The Explorer is told to copy the name from the snapshot *before* removing, because the ref is gone afterwards.
  - The check language already expresses both forms, so it wasn't extended.
- **Test:** `oracle/evaluate.test.ts` "removal checks". Both forms pass when the row is gone and a status message names the item, and fail when the row is still there. A third case shows the bare-text form failing on the correct page.
- **Not yet measured on a real run.** It's a prompt change, so the next buggy run with a cancel journey shows whether the Explorer follows it.

**D76 — A replay that can't get through the steps is "couldn't repeat", not "didn't happen"** (Rohit, 28 Sep; consistent with D69).
- **What went wrong.** In a21a, both replays failed at step 7: the first run had cancelled HC-1001, so its button was gone. The finding was still Discarded with "It didn't happen again when replayed". That reason was false: the replays never reached the check.
- **The fix.**
  - The replayer now records, per attempt, whether it stopped at a step before the candidate's check or signature, and which step.
  - If *every* attempt stopped that way, the outcome is `couldnt_repeat`. The finding is Needs review with "Couldn't repeat the steps: step 7 (Click the "Cancel booking HC-1001" button) failed in both replays. The app's data may have changed after the first attempt, so a person needs to check this."
  - If one attempt got through and didn't reproduce, that is real evidence, so it stays `not_reproduced` → Discarded.
  - The verification funnel counts these separately (`verify.couldntRepeat`).
- **Tests:** table rows in `verify/tier.test.ts`, and a fixture replay in `verify/replay.test.ts` where the button is gone on replay.
- **Trade-off.** On an app whose first run changes shared data, more findings land in Needs review instead of vanishing. The count grows, but the report stops claiming what it didn't observe.

**D77 — UX reviewer: snapshots are single moments** (Rohit, 28 Sep). Two false suggestions came from pages seen before a form was filled in (the quote before Calculate, the booking summary before a date). One generic line was added to its rules: content that appears only after the user fills in or submits a form may not be in the snapshot, so don't claim it's missing or never shown. The contamination test passes.

**ROADMAP P5 additions** (not done now):
- combined v1+v2 scoring where a finding counts for at most one seeded bug (the DB-error finding is B22, not B15);
- clean-run rows show "–" for recall and precision.
