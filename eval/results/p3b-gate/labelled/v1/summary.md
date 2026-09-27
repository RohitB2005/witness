# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `0551023`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-130217_vg4y | full | buggy | 72% | 83% | 83% | 100% | – | none | 3 | 8.2 |
| run_20260927-130217_vg4y | ai-no-verify (derived) | buggy | 83% | 83% | 83% | 89% | – | none | 3 | 8.2 |
| run_20260927-130217_vg4y | full-no-skeptic (derived) | buggy | 72% | 83% | 83% | 100% | – | none | 3 | 8.2 |
| run_20260927-131110_waqv | full | buggy | 67% | 72% | 72% | 100% | – | none | 2 | 7.0 |
| run_20260927-131110_waqv | ai-no-verify (derived) | buggy | 72% | 72% | 72% | 88% | – | none | 2 | 7.0 |
| run_20260927-131110_waqv | full-no-skeptic (derived) | buggy | 67% | 72% | 72% | 100% | – | none | 2 | 7.0 |
| run_20260927-131858_a21a | full | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.7 |
| run_20260927-131858_a21a | ai-no-verify (derived) | clean | 0% | 0% | 0% | 0% | 3 | none | 0 | 5.7 |
| run_20260927-131858_a21a | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.7 |
| run_20260927-133005_qn8k | full | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.3 |
| run_20260927-133005_qn8k | ai-no-verify (derived) | clean | 0% | 0% | 0% | 0% | 3 | none | 0 | 5.3 |
| run_20260927-133005_qn8k | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.3 |
| run_20260927-125512_jhx0 | deterministic | buggy | 50% | 50% | 50% | 100% | – | none | 2 | 1.3 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · ✓ · | confirmed | Confirmed |
| B02 | ✓ ✓ ✓ | confirmed | Confirmed |
| B03 | · · · | not found | Likely |
| B04 | ✓ · · | confirmed | Likely |
| B05 | ✓ · · | confirmed | Confirmed |
| B06 | ✓ ✓ · | confirmed | Confirmed |
| B07 | · · · | not found | Likely |
| B08 | ✓ ✓ · | confirmed | Confirmed |
| B09 | ✓ ✓ ✓ | confirmed | Confirmed |
| B10 | ✓ ✓ ✓ | confirmed | Confirmed |
| B11 | ✓ ✓ ✓ | confirmed | Confirmed |
| B12 | ✓ ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ ✓ | confirmed | Confirmed |
| B15 | ✓ ✓ ✓ | confirmed | Confirmed |
| B16 | ✓ ✓ ✓ | confirmed | Confirmed |
| B17 | ✓ · · | likely | Likely |
| B18 | ✓ ✓ · | likely | Needs review |

## Needs a label (3)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_108e130b1258f658 (run_20260927-130217_vg4y) [bug/confirmed] Booking details can be viewed without logging in — matches no rule; needs a label
- fp_4807641267f25a31 (run_20260927-130217_vg4y) [bug/confirmed] Secret Stripe key is visible to anyone visiting the site — matches no rule; needs a label
- fp_d06593923558174f (run_20260927-130217_vg4y) [bug/likely] No way found to reschedule an existing booking — matches no rule; needs a label
