# Witness — roadmap and progress

Claude Code: tick items as they're done, and don't start a phase until the previous gate passes. Each phase ends with a **teach-back**: a short plain-English explanation (in `DEVLOG.md`) of what was built, how it works, and what could go wrong, written so Rohit can explain it in Q&A.

Presentation: 7, 8 or 9 October 2026. Feature freeze: **Saturday 3 October**. Presentation laptop must run a full scan by **Thursday 1 October**.

## P0 — Foundations (Wed 23 – Thu 24 Sep)

- [ ] pnpm monorepo scaffold per `ARCHITECTURE.md` §1; TypeScript strict; Vitest; ESLint + Prettier; root scripts
- [ ] Bench app (`bench/app`) per `BENCH_SPEC.md`: all pages, seed data, flags B01–B18 and C01, decoys D01–D04, `/__bench/*` routes, production build on :5180
- [ ] Bench's own Playwright tests: one per bug (pass clean, fail when flagged) + clean-build criteria (axe clean, no console errors, no broken links, fast APIs, no overflow)
- [ ] Commit `bench/bugs.yaml`; record commit hash in `DEVLOG.md` ("bugs.yaml frozen at …")
- [ ] Spike: a script that opens the bench with Playwright, takes an AI-mode aria snapshot, and has the LLM log in via one tool-calling loop (throwaway; proves the API, model access and snapshot format)
- [ ] `.env` configured; `pnpm demo:check` stub

**Gate P0:** bench clean and buggy builds both run; every bench bug test behaves; spike logs in. Teach-back written.

## P1 — Deterministic engine (Fri 25 – Sat 26 Sep)

- [ ] Config + budgets (zod); `RunStore` JSON implementation; event emitter
- [ ] Browser layer + safety policy (origin guard, production write block, permissions, downloads, dialogs, masking) + tests (`SECURITY.md` §4)
- [ ] Evidence recorder (IDs, screenshots, AI-mode aria snapshots, console, network, page errors, timings)
- [ ] Preflight (reachability, login detection, credential login, success signal)
- [ ] Crawler (BFS, same-origin, route normalisation, structure-hash dedupe, budget)
- [ ] Detectors: DET-PAGEERROR, DET-CONSOLE, DET-HTTP5XX, DET-REQFAIL, DET-BROKENLINK, DET-BROKENIMG, DET-A11Y, DET-PERF, DET-OVERFLOW, DET-SECHEADERS (DET-XSS and DET-HTTP4XX land with edge inputs in P2) — each with fixture tests
- [ ] Minimal report: JSON + Markdown; CLI `witness scan` with exit codes; `--pipeline deterministic`
- [ ] Eval scorer v1 (`eval/score.ts`) against `bugs.yaml` — *good candidate for Rohit to write himself*

**Gate P1:** A0 on the buggy bench finds the universal-oracle bugs reachable by crawling (B09, B10, B12, B13, B14, B16 at minimum); A0 on the clean bench reports no bug-category findings; production-mode write-block test passes. Teach-back written.

## P2 — AI exploration (Sun 27 – Mon 28 Sep)

- [ ] LLM gateway: providers, zod structured output, repair retry, backoff, cache (`off|rw|replay`), replay guard, cost accounting + caps, call log, redaction + test
- [ ] Prompt-contamination test
- [ ] Planner (app-map summary builder, prompt, schema, grounding verification)
- [ ] Oracle engine: check language, evaluators, number parsing — full unit tests (*alternative candidate for Rohit to write*)
- [ ] Executor: ref → stable locator, uniqueness check, safety policy, waits, step recording, secret placeholders
- [ ] Explorer loop: tools, context builder, stop conditions, escalation
- [ ] Edge-input generator + deterministic EdgeRunner (fixed safe set, double submit, login message comparison), DET-XSS, DET-HTTP4XX
- [ ] `--pipeline ai-no-verify` producing candidates as findings (for the ablation)

**Gate P2:** Explorer completes ≥ 3 bench journeys in a Standard run; at least three logic bugs (from B01, B02, B03, B06, B08) appear as candidates; B05 appears via edge inputs. Teach-back written.

## Tue 29 Sep — light day

- [ ] Run A0 and A1 once each; note results in `DEVLOG.md`

## P3 — Verification and reporting core (Wed 30 Sep – Thu 1 Oct)

- [ ] Evidence validation; replayer (fresh context, preamble, locators, signatures, no LLM); 3 attempts
- [ ] Judge (fallback); skeptic; `verify/tier.ts` pure function with table-driven tests
- [ ] Grouping + fingerprints; severity rules; readiness verdict; "what wasn't tested"
- [ ] Reporter writer with fact check + template fallback; UX reviewer
- [ ] Playwright test exporter + helpers; secrets test
- [ ] HTML (self-contained, escaped) + Markdown + JSON exporters
- [ ] Suppressions

**Gate P3:** A2 on the clean bench: zero Confirmed findings (3 runs); every exported test from a buggy run fails with its flag on and passes with it off. Teach-back written.

## P4 — Dashboard and server (Thu 1 – Fri 2 Oct)

- [ ] Express server: REST + SSE, artifact route (traversal-safe), one-scan lock, bind 127.0.0.1
- [ ] New scan page (mode warning, credentials, hint, budget)
- [ ] Live run page (phases, map, plan review with auto-approve, action log with thumbnails, candidate → tier transitions, cost meter)
- [ ] Report page (verdict banner, not-tested list, tabs, finding cards with evidence, Download test, Copy as issue, Not a bug, Discarded list)
- [ ] History page; Evaluation page (reads latest `summary.json`)
- [ ] Demo scripts (`DEMO_RUNBOOK.md` §1)
- [ ] **By Thu 1 Oct:** full scan from the UI on the presentation laptop

**Gate P4:** full Standard scan from the UI on the presentation laptop in < 8 min. Teach-back written.

## P5 — Evaluate and stabilise; FEATURE FREEZE (Sat 3 Oct)

- [ ] E1–E4 on the bench; E5 SauceDemo; E6 Friction; label findings; `summary.json` + charts
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
