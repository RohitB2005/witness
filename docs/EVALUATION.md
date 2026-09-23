# Witness — evaluation plan

A tester is evaluated the way test suites are: inject known faults (mutation analysis at app level), count how many are caught (recall), and count what is flagged that isn't real (precision, false positives on a clean build). Then show what each part of the pipeline contributes (ablation), and check the result on apps nobody tuned for.

## 1. Questions the evaluation answers

1. Does Witness find real bugs, across categories? → recall per category and tier
2. Does it avoid crying wolf? → precision per tier; Confirmed findings on the clean build; decoys flagged
3. Does the AI add value over deterministic tooling? → A0 vs A2 recall
4. Does verification remove the AI's noise? → A1 vs A2 precision; discard funnel
5. Is it stable and affordable? → run-to-run overlap; minutes, tokens and US$ per run
6. Are its outputs actionable? → exported tests fail on buggy / pass on clean; non-engineer read test
7. Does it generalise and resist manipulation? → SauceDemo, Friction, injection canary

## 2. Experiments

All runs use the bench **production build** (`pnpm bench:build && pnpm bench:serve`, port 5180), the Standard budget, the test account, and `--llm-cache rw` (first run) — then record the cache so reruns are reproducible.

| ID | Experiment | Configurations | Runs |
| --- | --- | --- | --- |
| E1 | Ablation on the buggy build (`BENCH_BUGS=all`) | A0 `deterministic`, A1 `ai-no-verify`, A2 `full`, A3 `full-no-skeptic` | 3 each |
| E2 | Clean build (`BENCH_BUGS=none`; decoys always present) | A1, A2 | 3 each |
| E3 | Exported-test validity | Every test exported in E1/A2: run with its matched bug's flag on (must fail) and off (must pass) via `POST /__bench/bugs` | once per test |
| E4 | Injection robustness | A2 with `BENCH_BUGS=all` vs `all,C01` | 2 each |
| E5 | External validity: SauceDemo | A2, `problem_user` and `error_user` accounts, staging mode (it's a public site built for test practice) | 1–2 each |
| E6 | Real-world run: your Friction app | A2, production (read-only) mode; manual triage of every finding | 1 |
| E7 | Human baseline (optional) | A classmate tests the bench for 20 minutes without seeing `bugs.yaml`; record bugs found and time | 1 |

**Commands** (implemented in `eval/`):

```
pnpm eval --exp E1                  # runs the matrix, writes eval/results/<ts>/runs.jsonl
pnpm eval:score eval/results/<ts>   # matches findings to bugs.yaml, writes summary.json + summary.md
pnpm eval:label eval/results/<ts>   # interactive CLI to label unmatched/tentative findings -> eval/labels.json
pnpm eval:tests eval/results/<ts>   # E3: runs exported specs with flags on/off
```

## 3. Scoring

The scorer (`eval/score.ts`) implements the matching semantics documented at the top of `bench/bugs.yaml`.

- **Match.** Each finding (excluding Discarded) is matched against bug rules, then decoy rules. Keyword-only rules marked `confirm: manual` produce *tentative* matches listed for labelling.
- **Labels.** `eval/labels.json` maps `fingerprint → "tp_unseeded" | "fp" | "tp:<bugId>"`. Unmatched findings stay *unlabelled* until labelled; the summary reports how many.
- **Recall@T** = seeded bugs with at least one matching finding whose tier ∈ T, ÷ 18. Report T = {Confirmed}, {Confirmed, Likely}, {Confirmed, Likely, Needs review}.
- **Precision@T** = TP ÷ (TP + FP) over findings with tier ∈ T, where TP = matched to a seeded bug, labelled `tp:*` or `tp_unseeded`; FP = matched to a decoy or labelled `fp`. Compute separately for bugs and improvements. Unlabelled findings are excluded and counted.
- **Clean-build false positives** = bug findings with tier Confirmed or Likely in E2 (the clean bench is required to be genuinely clean — see `BENCH_SPEC.md` §1).
- **Tier accuracy** = found bugs whose best tier equals `expected_tier` ÷ found bugs.
- **Stability** = mean pairwise Jaccard overlap of found bug-ID sets across the three A2 runs.
- **Discard funnel** = candidates → discarded at evidence validation / replay / skeptic / suppression → findings by tier.
- **Cost/time** = median and range of minutes, LLM calls, tokens and US$ per run.

Report medians and min–max over runs. Never drop a run.

## 4. SauceDemo reference list (E5)

Community-documented behaviour of the practice site's problem accounts (password is the site's public `secret_sauce`). **Re-verify each item by hand before scoring** — the site can change.

| ID | Account | Documented problem |
| --- | --- | --- |
| S1 | problem_user | Product images show the wrong (same) image |
| S2 | problem_user | Sort dropdown doesn't reorder products |
| S3 | problem_user | Checkout "Last Name" can't be filled (typing alters First Name) |
| S4 | problem_user | Some items can't be added to or removed from the cart |
| S5 | error_user | "Finish" doesn't complete the order |
| S6 | error_user | Sorting fails with an error dialog |
| S7 | error_user | Some add/remove-from-cart actions fail (console errors) |

Score recall against the items you verified. Findings outside the list are triaged by hand into real-but-undocumented or false positive.

## 5. Output format (`summary.json`, consumed by the dashboard's Evaluation page)

```json
{
  "generatedAt": "...", "benchCommit": "...", "bugsYamlHash": "...",
  "models": { "smart": "...", "fast": "..." },
  "pipelines": {
    "deterministic": { "recall": { "confirmed": [..runs], "confirmedLikely": [...], "all": [...] },
                       "precision": { "bugs": [...], "improvements": [...] },
                       "cleanFalsePositives": [...], "minutes": [...], "costUsd": [...], "llmCalls": [...] },
    "ai-no-verify": { ... }, "full": { ... }, "full-no-skeptic": { ... }
  },
  "recallByCategory": { "functional": 0.0, "crash": 0.0, "...": 0.0 },
  "perBug": [{ "id": "B01", "found": [true, true, false], "bestTier": "confirmed", "expectedTier": "Confirmed" }],
  "decoysFlagged": { "D01": 0, "D02": 0, "D03": 0, "D04": 0 },
  "funnel": { "candidates": 0, "discardedEvidence": 0, "discardedReplay": 0, "downgradedSkeptic": 0, "suppressed": 0 },
  "exportedTests": { "total": 0, "failOnBuggy": 0, "passOnClean": 0 },
  "injection": { "recallWithout": 0.0, "recallWith": 0.0, "confirmedSetEqual": true },
  "stabilityJaccard": 0.0,
  "unlabelled": 0
}
```

## 6. Presentation artefacts to produce

1. Grouped bars: recall@{Confirmed, Likely} and precision for A0, A1, A2 (+A3). The one chart that tells the story.
2. Recall by category for A2.
3. Discard funnel for one representative A2 run.
4. SauceDemo table (S1–S7: found / tier).
5. One line each: clean-build Confirmed false positives, exported-test validity, injection result, cost and minutes per Standard run.

## 7. Honesty rules

- `bugs.yaml` is committed before the AI layer exists and never edited to fit results (record the commit hash).
- Prompts contain nothing bench-specific (contamination test in CI).
- State the bias plainly: "I wrote the bench, so I also tested on SauceDemo and my own live app."
- Report what didn't work (bugs missed, and why) — it's a stronger Q&A position than a perfect-looking chart.
