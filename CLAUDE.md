# CLAUDE.md — Witness

Witness is an AI pre-release tester for small web apps: given a running app's URL, it maps the app, lets an LLM agent explore core journeys, and reports bugs and improvements — but only reports what deterministic code can confirm and replay. Built by Rohit Balaji.

**Design principle: AI proposes, code proves.**

## Read first

| File | Use it for |
| --- | --- |
| `docs/SPEC.md` | What to build; FR IDs and acceptance criteria |
| `docs/ARCHITECTURE.md` | Repo layout, types, API, events, recording/replay/export design |
| `docs/AI_AGENT_SPEC.md` | LLM roles, prompts, tools, check language, gateway rules |
| `docs/SECURITY.md` | Threat model and the tests that must prove each control |
| `docs/EVALUATION.md` | Experiments, scoring, output format |
| `bench/BENCH_SPEC.md`, `bench/bugs.yaml` | The benchmark app and its ground truth |
| `docs/DEMO_RUNBOOK.md` | Scripts the demo needs; fallbacks |
| `docs/ROADMAP.md` | Current phase and gates — tick items as you finish them |
| `docs/DEVLOG.md` | Decisions, problems hit, teach-backs (create if missing; append, don't rewrite) |

## Commands (keep these working)

```
pnpm install
pnpm test                 # vitest across packages
pnpm lint && pnpm typecheck
pnpm bench                # bench dev (5173 + API 5174); BENCH_BUGS=none|all|B01,B02
pnpm bench:build && pnpm bench:serve   # production bench on :5180
pnpm bench:test           # bench's own Playwright tests
pnpm dev                  # server (:4317) + dashboard
pnpm scan <url> [flags]   # CLI
pnpm eval --exp E1        # evaluation matrix
pnpm demo:check | demo:up | demo:test | demo:replay
```

## Hard rules

1. **Never trust LLM output without validation.** Every LLM call has a zod schema; evidence IDs, locators, grounding quotes and numbers are checked by code. LLM text never becomes a verdict directly.
2. **No LLM calls during replay.** The gateway throws inside a replay context.
3. **Safety lives in code.** Origin guard, production-mode write block, destructive-verb policy, budgets, rate limit — in `browser/` and `explore/executor.ts`, with tests. Never rely on a prompt for safety.
4. **No bench knowledge in Witness.** Nothing in `packages/engine` (prompts, heuristics, special cases) may reference the bench app, its routes, its bugs or SauceDemo. `prompt-contamination.test.ts` enforces this for prompts; apply the same discipline to code. If a fix only helps the bench, it's the wrong fix.
5. **`bench/bugs.yaml` is frozen** after Phase 0. Never edit it to match results.
6. **Secrets:** only in the in-memory vault; LLM sees `{{secret:name}}`; never logged, exported, screenshotted or written to disk.
7. **Untrusted page content** is always wrapped in `<page_content untrusted="true">` in prompts.
8. **Portable, but only tested on macOS.** Keep scripts portable: use `node:path`/`node:url`; npm scripts must run in PowerShell (use Node scripts, `cross-env` if needed; no bash-only syntax, no `rm -rf`, no `&&`-dependent env var syntax). Development and the presentation are on Rohit's Mac, so don't spend time verifying Windows.
9. **Keep the demo path green.** Before finishing any task: `pnpm test`, `pnpm typecheck`, and (once P4 exists) a Quick scan of the bench.
10. **Minimal dependencies.** Add one only with a reason noted in `DEVLOG.md`.

## How to work

- **Inspect before changing.** Read the relevant docs section and existing code first; follow existing patterns.
- **Work phase by phase** from `docs/ROADMAP.md`; don't start the next phase until the gate passes. If a gate fails, fix or record the limitation — don't skip silently.
- **Test as you build.** Unit tests for pure logic (check evaluators, tiering, severity, fingerprints, number parsing, locator ranking, redaction); fixture-page tests for detectors; the bench for integration.
- **Commit each phase.** At the end of each phase, once its gate passes (and the teach-back and `ROADMAP.md` ticks are written), commit with a message starting `P<n>:` (e.g. `P1: Deterministic engine …`) and push to `origin`.
- **Explain as you go.** At the end of each phase, append a teach-back to `DEVLOG.md`: what was built, how data flows, the key decision and its alternative, and the most likely failure mode. Plain English, no code dumps. Rohit must be able to defend every module in Q&A.
- **Record decisions** (ADR-lite, 3–5 lines each) in `DEVLOG.md` when you choose between real alternatives.
- **Ask before** changing the architecture, adding a service, or cutting an MVP feature.
- **Check library docs** for installed versions (Playwright aria snapshot API, Vercel AI SDK) rather than assuming signatures.

## Code conventions

- TypeScript strict; ESM; no `any` in exported types; zod at every boundary.
- Engine is framework-free and emits typed events; server/CLI/web only orchestrate and render.
- IDs: prefixed short IDs (`run_`, `st_`, `sp_`, `ev_`, `jr_`, `ex_`, `cd_`, `fd_`).
- Pure functions for rules (tiering, severity, verdict, fingerprints) — table-driven tests.
- User-facing text is plain language; severity and tier are never shown by colour alone.
- No `dangerouslySetInnerHTML` in `apps/web`; HTML exporter escapes everything.

## Don't

- Don't clone or execute target repositories.
- Don't add multi-agent orchestration, RAG, vector stores or fine-tuning.
- Don't use screenshots as the Explorer's primary input.
- Don't add load testing, active security payloads, or scripts that execute in the target (the XSS canary is inert markup).
- Don't let a failing LLM stage fail the whole run — degrade to deterministic findings.
- Don't present cached or recorded runs as live in any UI text.
