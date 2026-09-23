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

- `bench/bugs.yaml` frozen at commit: `<fill in at end of P0>`

## Phase log

<!-- ### P0 — <date>
Built: …
How it works: …
Key decision + alternative: …
Most likely failure mode: …
Problems hit: … -->
