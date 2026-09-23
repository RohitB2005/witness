# Witness — product specification

**Working name:** Witness (rename freely; "Kea" and "Proof" collide with existing testing tools).
**One line:** An AI pre-release check for small web apps. Give it a URL; in about five minutes it returns a readiness verdict, verified bugs with evidence and replayable Playwright tests, and a list of improvements.
**Design principle:** *AI proposes, code proves.* The LLM decides what to try and what "correct" should look like; deterministic code decides whether something is actually wrong and whether it reproduces.

The core requirements are traced in §9. Architecture is in `ARCHITECTURE.md`, LLM/agent behaviour in `AI_AGENT_SPEC.md`, security controls in `SECURITY.md`, evaluation in `EVALUATION.md`.

---

## 1. Problem

Small teams ship without a QA function. Before a release, someone should check that core flows work, nothing obviously breaks, and the experience holds up — but writing and maintaining a test suite is a project in itself, and manual click-throughs are slow, inconsistent and skipped under deadline pressure. Edge cases, unusual inputs, accessibility and performance are rarely tested; improvements are almost never surfaced systematically.

The product must be **trusted**: a tester that raises false alarms gets ignored, just like a flaky suite.

## 2. Users

| Persona | Needs |
| --- | --- |
| Developer on a 2–5 person team | Know what's broken before users do; actionable repro steps; a test to keep |
| Non-technical stakeholder (founder, client, delivery manager) | One-line "is it ready?" answer in plain language |
| Support/ops on a managed-hosting plan | Safe, read-only health checks of live apps |

## 3. Glossary

| Term | Meaning |
| --- | --- |
| Scan / run | One execution of Witness against one URL |
| State | A distinct page state (URL pattern + structure hash) |
| Journey | A goal-directed user flow the Planner proposes (e.g. "book a clean") |
| Expectation | A statement of correct behaviour, compiled into a **check** in the check language, with **grounding** |
| Grounding | Why Witness believes an expectation: `ui_text` (a literal quote from the page) or `convention` (common sense / domain rule) |
| Universal oracle | A detector for things that are always wrong (5xx, uncaught exception, broken link…) |
| Candidate | A suspected problem, not yet verified |
| Finding | A candidate after verification, with a tier, severity, evidence and repro steps |
| Evidence | A recorded artifact with an ID: screenshot, aria snapshot, network entry, console entry, page error, timing, check result, axe result |
| Tier | Confirmed · Likely · Needs review · Discarded (bugs); Evidence-based · Suggestion (improvements) |

## 4. Functional requirements

Each FR has acceptance criteria (AC). IDs are referenced by `ROADMAP.md` and tests.

### FR-1 Scan input and modes (brief R1)
- Inputs: `url` (required), `mode` (`staging` | `production`, default `staging` for localhost/127.0.0.1/*.local/*.test, otherwise `production`), optional `credentials` (`{ username, password }` or `{ email, password }`), optional `hint` (≤ 200 chars), `budget` preset (`quick` | `standard` | `deep`).
- AC: invalid URL, non-http(s) scheme or unreachable host fails preflight with a plain-language message.
- AC: scope is fixed to the URL's origin; the report states the scope.
- AC: in `staging` mode pointed at a non-local host, the UI shows a warning that requires confirmation.

### FR-2 Preflight
- Checks reachability (status < 400 on the start URL), records response headers, detects a login form, and — if credentials are given — performs login and verifies a post-login signal (URL change, logout control, or account name visible).
- AC: login failure stops the scan with "Couldn't log in with the details provided" and a screenshot; no AI stages run.

### FR-3 Map (crawl + evidence)
- Breadth-first crawl of same-origin links from the start URL (and after login), respecting the page budget; deduplicate states by normalised URL pattern (numeric/uuid path segments → `:id`, query keys sorted) + aria-structure hash.
- For each state, record evidence: URL, AI-mode aria snapshot, compressed screenshot (JPEG, ~60% quality, max 1280 px wide), console messages, page errors, network log (method, URL, status, timing, resource type), navigation timing, LCP.
- AC: bench app clean build is fully mapped (all routes in `BENCH_SPEC.md` §3 except auth-only ones when no credentials) within the Standard budget.

### FR-4 Universal detectors
Run on every recorded state (crawl and agent steps). IDs are stable (used by the scorer):

| ID | Detects | Default classification |
| --- | --- | --- |
| DET-PAGEERROR | Uncaught exception (`pageerror`) | Bug, crash |
| DET-CONSOLE | `console.error` messages (grouped by normalised message) | Bug candidate, low; excluded if the same message occurs on the start page before any interaction and the user suppressed it |
| DET-HTTP5XX | Same-origin response status ≥ 500 | Bug, crash |
| DET-REQFAIL | Same-origin request failed (not aborted by Witness's own policy) | Bug candidate |
| DET-HTTP4XX | Same-origin fetch/XHR 4xx **during a happy-path step** (not during an edge-input step, not 401 on a deliberate wrong-login step) | Bug candidate, Likely at most |
| DET-BROKENLINK | Crawled same-origin link returns 404/410/5xx | Bug, broken-resource |
| DET-BROKENIMG | `<img>` with a 4xx/5xx response or `naturalWidth === 0` after load | Bug, broken-resource |
| DET-A11Y | axe-core violations, grouped by rule; impact critical/serious → medium, moderate/minor → low | Improvement, evidence-based |
| DET-PERF | Document TTFB > 800 ms, LCP > 2.5 s, same-origin API response > 2,000 ms | Improvement, evidence-based |
| DET-OVERFLOW | At 375 × 667: `scrollWidth > clientWidth + 1`; report the widest offending element | Bug, responsive |
| DET-XSS | Reflected canary: an edge input containing an inert marker (`"><i data-witness-canary="TOKEN"></i>`) appears as a real DOM element | Bug, security |
| DET-SECHEADERS | Missing `Content-Security-Policy`, `X-Content-Type-Options`, frame protection; cookies without `HttpOnly`/`Secure`/`SameSite` (Secure/HSTS only on https) | Improvement, low |

- AC: on the bench clean build, detectors produce **zero** bug-category findings.
- AC: each detector has unit tests against small fixture pages (served by a tiny static server in tests).

### FR-5 Planner (brief R2)
- Input: app map summary (routes, headings, forms and their fields, primary buttons, nav labels), the user's hint, detector results summary.
- Output (schema-validated): an app model (purpose, domain, key entities) and 2–8 journeys, each with `priority` (`core` | `secondary`), a goal, a start route, suggested steps in plain language, and expectations. Each expectation has a check (check language), grounding, and an impact tag (`money` | `data-loss` | `blocks-completion` | `wrong-info` | `cosmetic`).
- AC: every check parses; every `ui_text` grounding quote is verified to literally appear (case/whitespace-insensitive) in a recorded snapshot or the expectation is downgraded to `convention`.
- AC: the plan is shown to the user; they can untick journeys; dashboard auto-approves after 10 s; CLI auto-approves.
- AC: Planner prompts contain no bench-specific content (enforced by a test, see `CLAUDE.md`).

### FR-6 Explorer agent (brief R2)
- Executes each approved journey in a fresh browser context (logged in via the recorded preamble when credentials exist), using the tool set in `AI_AGENT_SPEC.md` §4.
- Generates context-aware edge inputs for each form it meets (plus a fixed safe canary set), in separate "edge" passes so happy-path journeys still complete.
- Records every action as a **step** with a stable locator, the value (or secret placeholder), before/after evidence IDs, and whether the step is `happy` or `edge`.
- AC: completes ≥ 3 core journeys on the bench within the Standard budget.
- AC: never navigates top-level outside the scan origin; in production mode never sends a same-origin POST/PUT/PATCH/DELETE other than the login request (enforced in the browser layer; tested).

### FR-7 Oracle engine
- Evaluates checks deterministically against the live page (and captured values). Check language: `AI_AGENT_SPEC.md` §6.
- AC: 100% unit-test coverage of check evaluators against fixture pages, including tolerance handling and currency parsing (`$1,234.50`, `NZ$ 12`, `12.00`).

### FR-8 Verifier (brief: false positives)
- For each candidate: (1) **evidence validation** — every cited evidence ID exists in the run store; (2) **replay** — re-run the recorded steps from a fresh context three times **without any LLM calls**, and re-evaluate the same check or look for the same universal signature; (3) **grounding validation** — as FR-5; (4) **skeptic** — one LLM call that may only downgrade; (5) **suppression** — match against the user's "Not a bug" fingerprints for this origin.
- Tier rules:

| Tier | Rule |
| --- | --- |
| Confirmed | (universal oracle **or** check failure with `ui_text` grounding) **and** reproduced ≥ 2/3 **and** skeptic verdict ≠ `benign_likely` |
| Likely | (check failure with `convention` grounding **or** judge verdict) **and** reproduced ≥ 2/3 **and** skeptic verdict ≠ `benign_likely` |
| Needs review | reproduced 1/3 (label "intermittent"), **or** skeptic verdict `benign_likely`, **or** judge confidence < 0.7 |
| Discarded | reproduced 0/3, **or** evidence validation failed, **or** suppressed. Kept in a collapsed list with the reason |

- Static detectors that don't depend on interaction (axe, broken link, security headers, overflow) are "reproduced" by re-running the detector once on a fresh load.
- AC: bench clean build produces zero Confirmed findings across three runs.

### FR-9 Severity and readiness (deterministic rules over LLM-classified inputs)
- Severity:
  - **critical** — universal crash (5xx / page error) during a `core` journey step; a failed check tagged `money`, `data-loss` or `blocks-completion` in a `core` journey.
  - **high** — any other failed check in a `core` journey; crash outside core journeys; DET-XSS.
  - **medium** — failed check in a `secondary` journey; DET-OVERFLOW on a page in a core journey; DET-CONSOLE in a core journey; axe critical/serious.
  - **low** — everything else (broken links/images outside core flows, axe moderate/minor, DET-PERF, DET-SECHEADERS).
- Readiness verdict:
  - **Not ready** — any Confirmed or Likely bug of severity critical or high.
  - **Ready with caveats** — only medium/low bugs, or any Needs-review items, or a core journey that couldn't be completed.
  - **Ready** — no Confirmed/Likely bugs and all core journeys completed.
  - Always accompanied by a one-sentence reason and a "What wasn't tested" list (journeys not attempted or not completed, pages beyond budget, auth-only areas without credentials).

### FR-10 Report (brief R3, R4)
- Summary: verdict, reason, counts by tier/severity, scope, duration, cost, what wasn't tested.
- **Bugs** tab (sorted by severity, then tier) and **Improvements** tab (accessibility, performance, security hygiene, UX suggestions).
- Finding card: title; plain-language impact (one sentence a non-engineer understands); severity; tier with "why this tier"; *Why flagged* (which layer: detector ID, check + grounding, or judgement); steps to reproduce (numbered, human-readable, generated from recorded steps — not from LLM free text); expected vs actual; evidence (screenshot with the target element outlined, network/console excerpts); likely cause labelled **hypothesis**; instances (for grouped findings); actions: *Download test*, *Copy as issue* (Markdown), *Not a bug*.
- Discarded list (collapsed) with reasons.
- Exports: self-contained HTML (screenshots inlined), Markdown, JSON.
- AC: no raw logs in the main view; every card renders without the network (for the HTML export).

### FR-11 Regression-test export
- For every Confirmed/Likely bug with replayable steps, generate a Playwright Test file (`@playwright/test`) from the recorded locators and the failing check or universal signature. Base URL and secrets come from env vars (`WITNESS_BASE_URL`, `WITNESS_TEST_USER`, `WITNESS_TEST_PASSWORD`).
- The test asserts the **correct** behaviour, so it fails while the bug exists and passes after the fix.
- AC (bench, eval): every exported test fails with its bug flag on and passes with it off.

### FR-12 Suppression feedback
- *Not a bug* stores `{ origin, fingerprint, reason, createdAt }`. Fingerprint = hash of category + normalised route + source ID + normalised target locator (+ request method/path for network findings).
- AC: a suppressed finding appears under Discarded ("suppressed by you on <date>") in later runs.

### FR-13 Live progress
- Server-sent events stream phases, pages discovered, plan, journey steps (with a thumbnail), candidates and their verification outcomes, cost so far.
- AC: the live view makes it obvious what Witness is doing at any moment, in plain language ("Typing Siobhan O'Neill into Full name").

### FR-14 Budgets and cost
- Presets (caps, not estimates):

| Preset | Pages | Journeys | Steps/journey | Wall-clock | LLM spend cap |
| --- | --- | --- | --- | --- | --- |
| quick | 15 | 2 | 15 | 3 min | US$0.50 |
| standard | 40 | 5 | 25 | 8 min | US$2.00 |
| deep | 100 | 8 | 35 | 15 min | US$5.00 |

- When a cap is hit, Witness stops starting new work, verifies what it has, and reports the cap in "What wasn't tested".
- AC: token usage and estimated cost are recorded per LLM call and totalled in the report.

### FR-15 CLI
- `witness scan <url> [--mode] [--budget] [--user --password-env] [--hint] [--out dir] [--format html,md,json] [--llm-cache off|rw|replay]`.
- Exit codes: `0` Ready, `1` Ready with caveats, `2` Not ready, `3` scan error.
- AC: the CLI and dashboard produce identical findings for the same run config and cache.

### FR-16 Evaluation mode
- Ablation switches: `--pipeline deterministic|ai-no-verify|full|full-no-skeptic`.
- `pnpm eval` runs the matrix in `EVALUATION.md` and writes results JSON + a Markdown summary; the dashboard's **Evaluation** page renders the charts.

## 5. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | A Standard scan of the bench completes in < 8 min on the presentation laptop (hard cap); target ≤ 5 min for the live demo |
| NFR-2 | Runs on Windows 11 and macOS/Linux (path handling via `node:path`; no shell-specific scripts in the critical path) |
| NFR-3 | If the LLM provider fails, the run still completes with deterministic findings and states that AI stages were skipped |
| NFR-4 | Secrets never appear in logs, prompts, reports, screenshots or disk |
| NFR-5 | Offline demo: with `--llm-cache replay` and a local target, a previously cached run re-executes with no internet |
| NFR-6 | Every LLM call is logged (role, model, prompt hash, tokens, cost, latency, validation result) |
| NFR-7 | TypeScript strict mode; engine modules unit-tested with Vitest; no `any` in public types |

## 6. Out of scope (and why)

| Excluded | Why |
| --- | --- |
| Cloning/executing repositories | Arbitrary code execution needs hardened isolation; off-brief for a 2-week build |
| Unit-test generation, mutation testing of the target | Different product; established tools exist |
| Load/stress testing; active security scanning | Harms targets; needs permission; k6 / OWASP ZAP exist |
| OAuth/SSO/2FA/CAPTCHA login | Rabbit hole; use a test account |
| Native mobile apps | Future: Appium/Maestro |
| Self-healing test maintenance | Playwright's healer exists |
| Multi-user accounts, hosted SaaS, job queue, Postgres | Single-user prototype; storage interface keeps the path open |
| Visual-regression diffing | Future; needs baselines |

## 7. Stretch (only after the Phase 5 gate)

Re-run diff (fixed / new / still present); Istanbul coverage of the bench frontend; GitHub issue creation via API; mobile-viewport journey pass; read-only repo context for likely source files.

## 8. Definition of done (for the presentation)

All MVP FRs (1–16) meet their AC; `EVALUATION.md` experiments run with results saved; `DEMO_RUNBOOK.md` fallbacks tested; the presenter can explain every module.

## 9. Requirements traceability

| Requirement | Where |
| --- | --- |
| R1 Connect (explain choice) | FR-1, FR-2; rationale in `README.md` |
| R2 AI analysis, not fixed tests | FR-5, FR-6, FR-7 |
| R3 Bugs and improvements | FR-4, FR-10 |
| R4 Clear actionable output | FR-9, FR-10, FR-11 |
| R5 Live against a real app | `DEMO_RUNBOOK.md`; bench + SauceDemo |
| "How do you handle false positives?" | FR-8, FR-12, `EVALUATION.md` |
| "What's out of scope?" | §6 |
