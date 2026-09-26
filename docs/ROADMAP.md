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

- [ ] **First (moved from P0):** add the API key, verify model IDs on the provider, then the spike: open the bench with Playwright, take an AI-mode aria snapshot, and have the LLM log in via one tool-calling loop (throwaway; proves the API, model access and snapshot format)
- [ ] LLM gateway: providers, zod structured output, repair retry, backoff, cache (`off|rw|replay`), replay guard, cost accounting + caps, call log, redaction + test
- [ ] Prompt-contamination test
- [ ] Planner (app-map summary builder, prompt, schema, grounding verification)
- [ ] Oracle engine: check language, evaluators, number parsing — full unit tests (*alternative candidate for Rohit to write*)
- [ ] Executor: ref → stable locator, uniqueness check, safety policy, waits, step recording, secret placeholders
- [ ] Explorer loop: tools, context builder, stop conditions, escalation
- [ ] Edge-input generator + deterministic EdgeRunner (fixed safe set, double submit, login message comparison), DET-XSS, DET-HTTP4XX
- [ ] `--pipeline ai-no-verify` producing candidates as findings (for the ablation)
- [ ] **Requirements hook only** (`ADDENDUM_QA_COVERAGE.md` A5): `ScanConfig` and the Planner input schema accept an optional `requirements: string` (≤ 5,000 chars), and grounding supports kind `requirement` (a quote verified by string match against the supplied text). No feature work (criteria splitting, coverage table) until P3b

**Gate P2:** Explorer completes ≥ 3 bench journeys in a Standard run; at least three logic bugs (from B01, B02, B03, B06, B08) appear as candidates; B05 appears via edge inputs. Teach-back written.

## Tue 29 Sep — light day

- [ ] Run A0 and A1 once each; note results in `DEVLOG.md`

## P3 — Verification and reporting core (Wed 30 Sep – Thu 1 Oct)

- [ ] Evidence validation; replayer (fresh context, preamble, locators, signatures, no LLM); 3 attempts
- [ ] **A0 uses replay too** (Rohit, 26 Sep): once replay exists, the deterministic pipeline replays its detector candidates as well (static detectors re-run on a fresh load, FR-8), so its findings can reach Confirmed. This replaces D17's provisional "Likely at most" cap
- [ ] Judge (fallback); skeptic; `verify/tier.ts` pure function with table-driven tests
- [ ] Grouping + fingerprints; severity rules; readiness verdict; "what wasn't tested"
- [ ] Reporter writer with fact check + template fallback; UX reviewer
- [ ] Playwright test exporter + helpers; secrets test
- [ ] HTML (self-contained, escaped) + Markdown + JSON exporters
- [ ] Suppressions

**Gate P3:** A2 on the clean bench: zero Confirmed findings (3 runs); every exported test from a buggy run fails with its flag on and passes with it off. Teach-back written.

## P3b — QA coverage pack (after the P3 gate, before P4)

Spec: `docs/ADDENDUM_QA_COVERAGE.md` (approved by Rohit, 26 Sep). Build in this order; A6 is optional.

- [ ] Bench additions **first**: `bench/bugs-v2.yaml` (same schema and matching rules as `bugs.yaml`) and `bench/SCOPE.md`; flags B19–B23 (B24 if A6), decoys D05–D06; fake secrets built from fragments at runtime (no realistic literal in the repo); bench Playwright tests for B19–B24 and D05–D06 (pass clean, fail when flagged). Commit, and record the hash in `DEVLOG.md` as the second freeze. `bugs.yaml` stays untouched
- [ ] A1 — DET-SECRETS: secrets exposed to the browser (high-confidence patterns only; publishable keys aren't findings; always redacted to first 4 + last 4; never sent to the LLM)
- [ ] A4 — DET-DBERROR: database error signatures in responses and page text (existing apostrophe edge inputs plus one quote-heavy string; no destructive payloads); group with a 5xx from the same request
- [ ] A3 — DET-AUTHZ: GET JSON APIs seen only while logged in, replayed with no cookies or auth headers (GET only, so allowed in production mode)
- [ ] A5 — Acceptance criteria: Planner splits `requirements` into numbered criteria mapped to journeys and checks; `requirement` grounding counts like `ui_text`; "Not found in the app" findings; Requirements coverage in the report; verdict counts failed and not-found criteria; CLI `--requirements <file>`
- [ ] A2 — DET-SOURCEMAP: publicly downloadable source maps (improvement, evidence-based, low)
- [ ] A6 (optional, only if time) — prompt-injection probe for chat-like UI (≤ 3 canary probes; staging mode or `--probe-ai` only)

**Gate P3b:** B19–B23 detected on the buggy bench (B24 if A6 built); D05 and D06 not flagged; zero new Confirmed findings on the clean bench over 3 runs; secrets redacted everywhere (test). Teach-back written.

## P4 — Dashboard and server (Thu 1 – Fri 2 Oct)

- [ ] Express server: REST + SSE, artifact route (traversal-safe), one-scan lock, bind 127.0.0.1
- [ ] New scan page (mode warning, credentials, hint, budget; requirements textarea + `.md`/`.txt` upload — addendum A5)
- [ ] Live run page (phases, map, plan review with auto-approve, action log with thumbnails, candidate → tier transitions, cost meter)
- [ ] Report page (verdict banner, not-tested list, tabs, finding cards with evidence, Download test, Copy as issue, Not a bug, Discarded list; **Requirements coverage** table and **Security** section — addendum)
- [ ] History page; Evaluation page (reads latest `summary.json`)
- [ ] Demo scripts (`DEMO_RUNBOOK.md` §1)
- [ ] **By Thu 1 Oct:** full scan from the UI on the presentation laptop

**Gate P4:** full Standard scan from the UI on the presentation laptop in < 8 min. Teach-back written.

## P5 — Evaluate and stabilise; FEATURE FREEZE (Sat 3 Oct)

- [ ] E1–E4 on the bench; E5 SauceDemo; E6 Friction; label findings; `summary.json` + charts. Report the v1 set (B01–B18) and the v2 set (B19–B24) separately and combined; the ablation stays on v1 so earlier numbers remain comparable (addendum)
- [ ] Fix only bugs that affect the demo or the numbers' validity
- [ ] Offline replay tested with Wi-Fi off; screen recording made
- [ ] README: what it is, how to run, architecture sketch, results, limitations
- [ ] Tag `demo-v1`

**Gate P5:** every item in "What must be proven" (strategic plan §31) is ticked or explicitly noted as a limitation.

## P6 — Present (Sun 4 – Tue 6 Oct)

- [ ] Slide deck (built from real results)
- [ ] Three timed rehearsals; Q&A drill; runbook dry run on the laptop
- [ ] Stretch items only if all gates are green: re-run diff, Istanbul coverage, GitHub issue export, mobile journey pass

## Cut line if behind (cut from the top)

Stretch → UX reviewer → skeptic → HTML export → dashboard polish (CLI + static HTML report can carry the demo). **Never cut:** bench, verification, eval, demo fallbacks.

Within P3b (addendum): A6 → A3 cross-user stretch → A2 → A4 → A3 → A5 → A1. A1 and A5 are the last to cut: they carry the demo's security moment and the acceptance-criteria story.
