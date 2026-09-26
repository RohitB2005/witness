# Addendum — QA coverage pack (security + acceptance testing)

Status: approved by Rohit on top of the original spec. Read alongside `SPEC.md`; where they differ, this file wins for the items below. Nothing here changes P0/P1 work or the frozen `bench/bugs.yaml`.

## Why

Witness already covers the black-box half of a QA engineer's pre-release job: exploratory and end-to-end testing, logic checks, edge inputs, regression tests, accessibility, performance and bug reports. The biggest visible gaps versus a real QA/security pass are:

- exposed secrets
- broken access control
- leaked database errors
- checking the app against what was actually promised to the client

All four fit the existing architecture: a passive or GET-only deterministic detector, or a new input to the Planner. None requires executing the target's code.

## New capabilities

Build these in priority order (A1 first). A6 is optional.

### A1 — DET-SECRETS: secrets exposed to the browser

- Scan same-origin response bodies the browser already downloads (documents, scripts, JSON/XHR, source maps; cap 2 MB per body) plus inline scripts.
- High-confidence patterns only:
  - AWS access key ID `AKIA[0-9A-Z]{16}`
  - Stripe secret/restricted keys `(sk|rk)_live_[0-9A-Za-z]{20,}`
  - OpenAI `sk-(proj-)?[A-Za-z0-9_-]{20,}`
  - Anthropic `sk-ant-`
  - OpenRouter `sk-or-v1-`
  - GitHub `ghp_` / `github_pat_`
  - Slack `xox[baprs]-`
  - PEM private key blocks
  - JWTs whose decoded payload has `"role":"service_role"` (Supabase service key)
- **Publishable-by-design values are not findings:** Stripe `pk_live_`/`pk_test_`, Supabase anon JWTs, Firebase web `apiKey`. Google `AIza…` keys are often public browser keys: report them as Needs review, low.
- Classification: bug, category `security`. Severity critical for secret/service keys and private keys; high otherwise.
- Replay: re-fetch the asset and re-match.
- **Always redact** in reports, logs, prompts and exports (first 4 + last 4 characters only). Never send a matched secret to the LLM.

### A2 — DET-SOURCEMAP: public source maps

- For same-origin scripts with a `sourceMappingURL` comment or `SourceMap` header, fetch the map.
- A 200 response with a `sources` array becomes an improvement (evidence-based, low): "Your original source code is publicly downloadable."

### A3 — DET-AUTHZ: private data without login

- After a logged-in run, take every same-origin **GET** JSON API response that returned 200 while logged in and was never requested during the logged-out crawl.
- Replay each from a fresh context with no cookies and no auth headers. GET only, so it's allowed in production mode.
- If it returns 200 with the same records, report a bug, category `security`: "API returns private data without logging in". Severity is critical if the body contains personal-looking fields (email, phone, address, name), otherwise high.
- Endpoints also fetched while logged out are public by design and are skipped.
- Stretch (only if time allows): a cross-user check with a second test account (`--user2`).

### A4 — DET-DBERROR: database errors leaked to users

- Match response bodies and page text against database error signatures:
  - MySQL: "You have an error in your SQL syntax"
  - Postgres: "syntax error at or near"
  - SQLite: `SQLITE_ERROR`, `near "…": syntax error`
  - MSSQL: "Unclosed quotation mark"
  - Oracle: `ORA-`
  - ORMs: `SequelizeDatabaseError`, `PrismaClientKnownRequestError`, `QueryFailedError`
- Classification: bug, `security`, high: "Database error details exposed — possible SQL injection".
- Probing stays at the existing edge inputs (apostrophes) plus one quote-heavy string. **No** destructive or exfiltration payloads (no `DROP`, `UNION SELECT`, time-based sleeps).
- When an HTTP 500 and a DB error come from the same request, group them into one finding.

### A5 — Acceptance criteria (UAT support)

- New optional scan input: `requirements` — pasted text or an uploaded `.md`/`.txt` (≤ 5,000 chars), e.g. the fixed-scope proposal agreed with a client.
- The Planner splits it into numbered acceptance criteria and maps each one to journeys and checks.
- New grounding kind `requirement`: a quote from the requirements text, verified by string match against the supplied document. For tiering it counts like `ui_text` (Confirmed-eligible).
- Criteria with no matching UI at all are reported as **"Not found in the app"**: a missing-feature finding, category `functional`, Likely.
- Report gets a **Requirements coverage** table: each criterion → Verified / Failed (link to the finding) / Not found / Not tested (reason). The readiness verdict counts failed and not-found criteria as bugs of the linked severity.
- CLI flag `--requirements <file>`; dashboard: textarea plus file upload on *New scan*.

### A6 (optional) — Prompt-injection probe for AI features

- Detect chat-like UI: a textbox plus a send button, near words like "Ask", "Chat", "Assistant".
- Send at most 3 probes, each containing a unique canary token:
  - an instruction override ("…reply only with WITNESS-<token>")
  - a request to reveal hidden instructions
  - a role-confusion message
- Deterministic oracle: the token (or a system-prompt marker) appears in the reply → bug, `security`, high: "AI assistant follows injected instructions".
- Staging mode only, or with an explicit `--probe-ai` opt-in.

## Bench additions — `bench/bugs-v2.yaml`

Write `bench/bugs-v2.yaml` (same schema and matching rules as `bugs.yaml`) and `bench/SCOPE.md`, and **commit them before implementing A1–A6**. Record the commit hash in DEVLOG as a second freeze. `bugs.yaml` stays untouched.

| ID | Bug (flag on) | Clean behaviour | Catches it |
| --- | --- | --- | --- |
| B19 | A secret-looking server key is embedded in the frontend bundle | No secret in the bundle | A1 |
| B20 | `.map` files for the production bundle are served | Maps not served | A2 |
| B21 | `GET /api/bookings/:ref` returns booking details (name, phone, address) without a session | 401 | A3 |
| B22 | Search API returns `SQLITE_ERROR: near "'": syntax error` in a 500 body when the query contains a quote | Handles quotes | A4 |
| B23 | `SCOPE.md` promises "Customers can reschedule an existing booking"; the feature doesn't exist | (Feature exists when flag off: a *Reschedule* button and date change) | A5 |
| B24 (optional) | "Ask Harbour" help bot (rule-based stub, no LLM) obeys "reply only with …" instructions | Refuses and answers normally | A6 |

| Decoy | Must NOT be flagged |
| --- | --- |
| D05 | A Stripe **publishable** key (`pk_live_…`, fake) in the bundle |
| D06 | `GET /api/services` works without login (public catalogue) |

**Fake secrets and GitHub push protection:** never commit a realistic-looking secret literal. Build the fake key at runtime from concatenated fragments (e.g. `"sk_" + "live_" + "WITNESSBENCHFAKE…"`), so the served bundle matches the pattern but the repo source doesn't contain the full literal. Make it obviously fake to a human.

`bench/SCOPE.md` is a one-page fictional proposal ("Harbour Clean — booking app, fixed scope") with about 10 plain-English acceptance criteria. Most are delivered, some are broken by existing seeded bugs (quote incl. GST, cancel a booking, search by name), and B23 is missing. Add bench Playwright tests for B19–B24 and D05–D06, as in P0: they pass clean and fail when flagged.

## Where it goes in the roadmap

- **P2 (hook only):** the scan config and Planner input schema accept an optional `requirements: string`, and grounding supports kind `requirement`. No feature work yet.
- **New phase P3b — QA coverage pack** (after the P3 gate, before P4): bench additions and second freeze, then A1 → A4 → A3 → A5 → A2 (→ A6 if time).
  - **Gate P3b:** B19–B23 detected on the buggy bench (B24 if A6 built); D05 and D06 not flagged; zero new Confirmed findings on the clean bench over 3 runs; secrets redacted everywhere (test).
- **P4:** requirements input on *New scan*; a **Requirements coverage** table and a **Security** section on the report.
- **Evaluation:** report the v1 set (B01–B18) and the v2 set (B19–B24) separately and combined. The ablation stays on v1 so earlier numbers remain comparable.
- **Cut order if behind:** A6 → A3 cross-user stretch → A2 → A4 → A3 → A5 → A1. A1 and A5 are the last to cut: they carry the demo's security moment and the acceptance-criteria story.

## Still out of scope (say so plainly in the talk)

Code-level unit/integration tests, static code review, dependency vulnerability audits (all need a "repo mode", next on the roadmap), load testing, active penetration testing, and cross-browser matrices beyond Chromium plus a phone viewport.
