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
