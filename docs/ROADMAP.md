# Witness — roadmap and progress

Claude Code: tick items as they're done, and don't start a phase until the previous gate passes. Each phase ends with a **teach-back**: a short plain-English explanation (in `DEVLOG.md`) of what was built, how it works, and what could go wrong, written so Rohit can explain it in Q&A.

Presentation: 7, 8 or 9 October 2026. Feature freeze: **Saturday 3 October**. Presentation laptop must run a full scan by **Thursday 1 October**.

## P0 — Foundations (Wed 23 – Thu 24 Sep)

- [x] pnpm monorepo scaffold per `ARCHITECTURE.md` §1; TypeScript strict; Vitest; ESLint + Prettier; root scripts
- [x] Bench app (`bench/app`) per `BENCH_SPEC.md`: all pages, seed data, flags B01–B18 and C01, decoys D01–D04, `/__bench/*` routes, production build on :5180
- [x] Bench's own Playwright tests: one per bug (pass clean, fail when flagged) + clean-build criteria (axe clean, no console errors, no broken links, fast APIs, no overflow)
- [x] Commit `bench/bugs.yaml`; record commit hash in `DEVLOG.md` ("bugs.yaml frozen at …") — ff7f6a9
- [ ] ~~Spike~~ — **moved to the start of P2** (no API key yet; Rohit, 23 Sep). See DEVLOG D13.
- [x] `.env` present; `pnpm demo:check` stub (API key still to add — needed at the start of P2)

**Gate P0:** bench clean and buggy builds both run; every bench bug test behaves; spike logs in. Teach-back written.

**P0 gate — passed 23 Sep 2026 except the spike**, which was deferred to P2 by decision (results in `DEVLOG.md`).

## P1 — Deterministic engine (Fri 25 – Sat 26 Sep)

- [x] Config + budgets (zod); `RunStore` JSON implementation; event emitter
- [x] Browser layer + safety policy (origin guard, production write block, permissions, downloads, dialogs, masking) + tests (`SECURITY.md` §4)
- [x] Evidence recorder (IDs, screenshots, AI-mode aria snapshots, console, network, page errors, timings)
- [x] Preflight (reachability, login detection, credential login, success signal)
- [x] Crawler (BFS, same-origin, route normalisation, structure-hash dedupe, budget)
- [x] Detectors: DET-PAGEERROR, DET-CONSOLE, DET-HTTP5XX, DET-REQFAIL, DET-BROKENLINK, DET-BROKENIMG, DET-A11Y, DET-PERF, DET-OVERFLOW, DET-SECHEADERS (DET-XSS and DET-HTTP4XX land with edge inputs in P2) — each with fixture tests
- [x] Minimal report: JSON + Markdown; CLI `witness scan` with exit codes; `--pipeline deterministic`
- [x] Eval scorer v1 (`eval/score.ts`) against `bugs.yaml` — written by Claude at Rohit's request (23 Sep); matching explained in the P1 teach-back

**Gate P1:** A0 on the buggy bench finds the universal-oracle bugs reachable by crawling (B09, B10, B12, B13, B14, B16 at minimum); A0 on the clean bench reports no bug-category findings; production-mode write-block test passes. Teach-back written.

**P1 gate — passed 23 Sep 2026.** A0 buggy: all six found, no decoys; A0 clean: 0 bug findings (staging + production mode); policy tests pass. Results in `DEVLOG.md` and `eval/results/p1-gate/`.

## P2 — AI exploration (Sun 27 – Mon 28 Sep)

- [x] **First (moved from P0):** add the API key, verify model IDs on the provider, then the spike: open the bench with Playwright, take an AI-mode aria snapshot, and have the LLM log in via one tool-calling loop (throwaway; proves the API, model access and snapshot format)
- [x] LLM gateway: providers, zod structured output, repair retry, backoff, cache (`off|rw|replay`), replay guard, cost accounting + caps, call log, redaction + test
- [x] Prompt-contamination test
- [x] Planner (app-map summary builder, prompt, schema, grounding verification)
- [x] Oracle engine: check language, evaluators, number parsing — full unit tests (written by Claude at Rohit's request, 26 Sep; worked examples in the P2 teach-back)
- [x] Executor: ref → stable locator, uniqueness check, safety policy, waits, step recording, secret placeholders
- [x] Explorer loop: tools, context builder, stop conditions, escalation
- [x] Edge-input generator + deterministic EdgeRunner (fixed safe set, double submit, login message comparison), DET-XSS, DET-HTTP4XX
- [x] `--pipeline ai-no-verify` producing candidates as findings (for the ablation)
- [x] **Requirements hook only** (`ADDENDUM_QA_COVERAGE.md` A5): `ScanConfig` and the Planner input schema accept an optional `requirements: string` (≤ 5,000 chars), and grounding supports kind `requirement` (a quote verified by string match against the supplied text). No feature work (criteria splitting, coverage table) until P3b

**Gate P2:** Explorer completes ≥ 3 bench journeys in a Standard run; at least three logic bugs (from B01, B02, B03, B06, B08) appear as candidates; B05 appears via edge inputs. Teach-back written.

**P2 gate — passed 26 Sep 2026.** Five Standard runs on the buggy bench (run 4 interrupted by the laptop sleeping). Every other run completed 3–4 of 5 journeys and found B03, B06 and B08 as failed checks, B05 via edge inputs, plus B04 and B17 (and B18 in run 5). B01 and B02 were missed in all Standard runs; B01 was caught in the post-pin Quick smoke run. Recall at Confirmed+Likely was 50–67% (A0 alone: 33%), bug precision 75–100%. **These precision figures exclude the 37 unlabelled findings** (19 fingerprints) and will drop once they're labelled. The P1 gate still holds (A0 clean: 0 bug findings). Results in `DEVLOG.md` and `eval/results/p2-gate/`.

## Tue 29 Sep — light day

- [ ] Run A0 and A1 once each; note results in `DEVLOG.md`

## P3 — Verification and reporting core (Wed 30 Sep – Thu 1 Oct)

**Added 27 Sep from P2 misses** (Rohit; why each one exists: `DEVLOG.md` D46). Generic: no app names, routes, labels or bug knowledge in code or prompts. Validate each on SauceDemo where it applies.

- [x] DET-TOTALS: on any page with a money breakdown (subtotal, tax/GST/VAT, shipping, discount, total), check the parts add up to the total within 1 cent
- [x] DET-SORT: for any sort control, apply each option on the unfiltered list and check the order
- [x] Safe interaction sweep (staging mode only): click each collapsed accordion, disclosure or tab once, with no links or submits, and watch for page errors
- [x] Reflected-input probe: put the inert XSS canary into GET query parameters and GET search forms, then run DET-XSS
- [x] Cap AI-guessed input rules (convention grounding, not stated on the page) at Needs review
- [x] When Witness ignores page text aimed at AI tools (D44), say so in a short note on the report
- [x] Wrap long runs in `caffeinate` so the Mac can't sleep mid-run (macOS only; runs the command unchanged elsewhere)

**Planned P3 scope:**

- [x] Evidence validation; replayer (fresh context, preamble, locators, signatures, no LLM); 3 attempts
- [x] **A0 uses replay too** (Rohit, 26 Sep): once replay exists, the deterministic pipeline replays its detector candidates as well (static detectors re-run on a fresh load, FR-8), so its findings can reach Confirmed. This replaces D17's provisional "Likely at most" cap
- [x] Judge (fallback); skeptic; `verify/tier.ts` pure function with table-driven tests
- [x] Grouping + fingerprints; severity rules; readiness verdict; "what wasn't tested"
- [x] Reporter writer with fact check + template fallback; UX reviewer
- [x] Playwright test exporter + helpers; secrets test
- [x] HTML (self-contained, escaped) + Markdown + JSON exporters
- [x] Suppressions (CLI `witness suppress`; the dashboard's "Not a bug" button is P4)

**Gate P3:** A2 on the clean bench: zero Confirmed findings (2 runs: budget, D48); every exported test from a buggy run fails with its flag on and passes with it off. Teach-back written.

**P3 gate — passed 27 Sep 2026.** Clean bench, 2 Standard A2 runs: 0 Confirmed and 0 Likely bugs. Buggy Standard run: 12 of 12 exported tests matched to seeded bugs fail with their flag on and pass with it off. Buggy recall at Confirmed+Likely 67%, bug precision 100% (before labelling 10 new fingerprints); A0 alone 44% (was 33%). New D46 detectors and probes validated on SauceDemo (sort: S2 and S6 found, standard_user clean; totals: no false positive at checkout). P3 cost $1.67 (total usage $4.93). Details in `DEVLOG.md` and `eval/results/p3-gate/`.

**P3 wrap-up (27 Sep).** Labels applied: buggy recall C 61% / C+L 72%, precision 92%. A1 redefined as raw AI claims (D62): 1–2 false Confirmed bugs per clean run that A2 removes. Journey fixes (D63): the confirmation run completed 2 of 3 journeys (was 1 of 3); the third wandered. Total usage $5.24.

## P3b — QA coverage pack (after the P3 gate, before P4)

Spec: `docs/ADDENDUM_QA_COVERAGE.md` (approved by Rohit, 26 Sep). Build in this order. A2 and A6 moved to stretch on 27 Sep to protect the schedule (D47).

- [x] Bench additions **first**: `bench/bugs-v2.yaml` (same schema and matching rules as `bugs.yaml`) and `bench/SCOPE.md`; flags B19–B23 (B20 stays although A2 is now stretch, D47; B24 only if A6 is built), decoys D05–D06; fake secrets built from fragments at runtime (no realistic literal in the repo); bench Playwright tests for B19–B24 and D05–D06 (pass clean, fail when flagged). Commit, and record the hash in `DEVLOG.md` as the second freeze. `bugs.yaml` stays untouched
- [x] A1 — DET-SECRETS: secrets exposed to the browser (high-confidence patterns only; publishable keys aren't findings; always redacted to first 4 + last 4; never sent to the LLM)
- [x] A4 — DET-DBERROR: database error signatures in responses and page text (existing apostrophe edge inputs plus one quote-heavy string; no destructive payloads); group with a 5xx from the same request
- [x] A3 — DET-AUTHZ: GET JSON APIs seen only while logged in, replayed with no cookies or auth headers (GET only, so allowed in production mode)
- [x] A5 — Acceptance criteria: Planner splits `requirements` into numbered criteria mapped to journeys and checks; `requirement` grounding counts like `ui_text`; "Not found in the app" findings; Requirements coverage in the report; verdict counts failed and not-found criteria; CLI `--requirements <file>`

**Gate P3b:** B19 and B21–B23 detected on the buggy bench (B20 only if A2 is built, B24 only if A6 is); D05 and D06 not flagged; zero new Confirmed findings on the clean bench over 2 runs (D48); secrets redacted everywhere (test). Teach-back written.

**Also (Rohit, 27 Sep):** on the clean runs every `SCOPE.md` criterion must be Verified or Not tested, never Failed or Not found; the new booking details page passes the clean-build audit. Planner and Explorer test-design guidance added first (D64), measured by a buggy run without requirements.

**P3b gate — passed 27 Sep 2026.** Buggy + requirements: B19, B21, B22 Confirmed; B23 Likely (Not found in the app); B20 not built. D05/D06 never flagged. Clean ×2: 0 Confirmed and 0 Likely bugs; criteria only Verified or Not tested. Secrets redacted in every file (test, plus a grep of the real runs). Bench tests 61 pass, including the new page's audit. v1 recall C+L 83% with requirements, 72% without (B06 and B08 now found; B03 still missed). P3b cost $1.57 (total usage $6.81, balance $3.19). Labels proposed, not applied. Details in `DEVLOG.md` (D64–D74) and `eval/results/p3b-gate/`.

## P4 — Dashboard and server (Thu 1 – Fri 2 Oct)

- [x] Express server: REST + SSE, artifact route (traversal-safe), one-scan lock, bind 127.0.0.1
- [x] New scan page (mode warning, credentials, hint, budget; requirements textarea + `.md`/`.txt` upload — addendum A5)
- [x] Live run page (phases, map, plan review with auto-approve, action log with thumbnails, candidate → tier transitions, cost meter)
- [x] Report page (verdict banner, not-tested list, tabs, finding cards with evidence, Download test, Copy as issue, Not a bug, Discarded list; **Requirements coverage** table and **Security** section — addendum)
- [x] History page; Evaluation page (reads latest `summary.json`)
- [x] Demo scripts (`DEMO_RUNBOOK.md` §1)
- [x] **By Thu 1 Oct:** full scan from the UI on the presentation laptop

**Gate P4:** full Standard scan from the UI on the presentation laptop in < 8 min. Teach-back written.

**Also in P4 (Rohit, 28 Sep):** P3b loose ends first (labels, D75 removal targeting, D76 replay honesty, D77 UX snapshot rule); plain-language live view for non-technical readers; report order verdict → Requirements coverage → Security → rest; past runs always labelled with date and time; Standard's 8 minutes made a hard cap that reports what it cut (D78); "Not a bug" never touches eval labels, and `demo:check` lists bench suppressions (D84).

**P4 gate — passed 28 Sep 2026.** Standard scan from the UI with `bench/SCOPE.md`: **7:56** (476 s), inside the now-hard cap. The cap cut 1 journey, 15 unusual inputs and 8 replays (listed in the report). B01 found and Confirmed. v1 recall C+L 89%, v2 80% (before labelling 8 findings). `demo:test` red → `bench:fix` → green verified for B01 and B06. Found and fixed while testing `demo:replay`: the response cache couldn't replay past planning because prompts carry per-run IDs (D86; proven with mock models). P4 cost $0.66 (total usage $7.47, balance $2.53). Details in `DEVLOG.md` (D78–D86) and `eval/results/p4-gate/`.

## P5 — Evaluate and stabilise; FEATURE FREEZE (Sat 3 Oct)

- [x] Cut matrix (budget, D48): A0 as needed (free), A2 buggy ×3, A2 clean ×2, SauceDemo ×2 (one per account), Friction ×1; the injection comparison ×1 only if budget allows. A1 and A3 are derived from the A2 runs (`EVALUATION.md` §2). Label findings; `summary.json` + charts. Report the v1 set (B01–B18) and the v2 set (B19–B24) separately and combined; the ablation stays on v1 so earlier numbers remain comparable (addendum). *Done 30 Sep; the 35 new labels approved by Rohit and applied.*
- [x] Combined v1+v2 scoring (Rohit, 28 Sep): one finding counts for at most one seeded bug across both files (the DB-error "possible SQL injection" finding is B22, not v1 B15, whose frozen keyword rule also matches it); precision is only reported combined
- [x] Clean-run rows show "–" for recall and precision (there's nothing to recall), not 0%
- [x] Fix only bugs that affect the demo or the numbers' validity (D87 + refinement, D91, D92)
- [ ] Offline replay tested with Wi-Fi off; screen recording made. *(Cache replay verified 30 Sep: the Standard rehearsal `…031814_2nd8` replays completely; the Demo rehearsal `…044424_04qv` replays with one Explorer miss. Wi-Fi-off run and recording: Rohit.)* Needs a rehearsal run made with `--llm-cache rw` **after D86** (earlier cache entries use the old keys); then `pnpm demo:check <run>` should show all its answers cached, and `pnpm demo:replay <run>` should complete its journeys
- [x] Decide the demo preset (Rohit, 30 Sep: `demo`, 2 journeys, 5-min cap; 3:45–3:57 measured) (Rohit, 28 Sep: option a) after timing a full rehearsal; the UI Standard scan took 7:56 with requirements (P4 gate)
- [x] Choose the live demo bug (Rohit, 30 Sep: **B02**, Confirmed in every buggy run) (B01 was found in 1 of 3 P3b buggy runs and in the P4 gate run); label the P4 gate run's 8 unlabelled findings (done: 0 unlabelled)
- [x] README: what it is, how to run, architecture sketch, results, limitations
- [x] Tag `demo-v1`

**P5 progress (30 Sep, stopped for review before the README).**
- **Done:**
  - D87 read-only fix;
  - the demo preset (D88);
  - `pnpm eval` and combined scoring (D89, D90);
  - the full matrix plus E4, the demo-preset run and A0;
  - E3: 42/42 tests behave;
  - the offline replay by cache: same bugs, tiers and journeys; 3 of 74 answers missed.
- **Rohit's decisions (30 Sep), applied:** labels approved, Friction triaged (`eval/results/p5/e6/triage.json`), preset `demo`, demo bug B02, then the Demo rehearsal (with the cache on), README and the `demo-v1` tag.
- **Still open (Rohit):** Wi-Fi-off replay and the screen recording.
- Results and teach-back: `DEVLOG.md` "P5 — runs and scoring".

**Gate P5:** every item in "What must be proven" (strategic plan §31) is ticked or explicitly noted as a limitation.

**P5 gate — passed 30 Sep 2026, with one manual item open.**
- The strategic plan (§31) isn't in the repo, so the gate was checked against the closest list here: the seven questions in EVALUATION.md §1.
  - (1) Recall per category and tier;
  - (2) precision 100%, 0 clean-build false bugs, no decoys flagged;
  - (3) A0 52% vs A2 65–83%;
  - (4) A1 precision 79–86% vs A2 100%;
  - (5) stability 0.70, $0.20–0.42 and 5–8 min per Standard run;
  - (6) 42/42 exported tests behave;
  - (7) SauceDemo 4/7 Confirmed, Friction 0 false bugs above Needs review, injection canary without effect.
- **Limitations, noted in README and DEVLOG:** the non-engineer read test (E7 and a reader test) wasn't run; the Wi-Fi-off replay and screen recording are Rohit's.

## P6 — Present (Sun 4 – Tue 6 Oct)

- [ ] Slide deck (built from real results)
- [ ] Three timed rehearsals; Q&A drill; runbook dry run on the laptop
- [ ] Stretch items only if all gates are green: A2 DET-SOURCEMAP and A6 prompt-injection probe (moved from P3b, 27 Sep; specs in the addendum), re-run diff, Istanbul coverage, GitHub issue export, mobile journey pass

## Cut line if behind (cut from the top)

Stretch → UX reviewer → skeptic → HTML export → dashboard polish (CLI + static HTML report can carry the demo). **Never cut:** bench, verification, eval, demo fallbacks.

Within P3b (addendum): A3 cross-user stretch → A4 → A3 → A5 → A1 (A2 and A6 are already stretch). A1 and A5 are the last to cut: they carry the demo's security moment and the acceptance-criteria story.
