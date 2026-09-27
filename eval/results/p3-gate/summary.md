# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `05397c1`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-053847_3ih8 | full | buggy | 61% | 72% | 78% | 92% | – | D03 | 0 | 7.4 |
| run_20260927-053847_3ih8 | ai-no-verify (derived) | buggy | 78% | 78% | 78% | 81% | – | D03 | 0 | 7.4 |
| run_20260927-053847_3ih8 | full-no-skeptic (derived) | buggy | 61% | 72% | 78% | 86% | – | D03 | 0 | 7.4 |
| run_20260927-075935_ps4l | full | clean | 0% | 0% | 6% | – | 0 | none | 0 | 4.6 |
| run_20260927-075935_ps4l | ai-no-verify (derived) | clean | 0% | 0% | 6% | 0% | 1 | none | 0 | 4.6 |
| run_20260927-075935_ps4l | full-no-skeptic (derived) | clean | 0% | 0% | 6% | – | 0 | none | 0 | 4.6 |
| run_20260927-080410_mmbp | full | clean | 0% | 0% | 6% | – | 0 | none | 0 | 3.6 |
| run_20260927-080410_mmbp | ai-no-verify (derived) | clean | 0% | 0% | 6% | 0% | 2 | none | 0 | 3.6 |
| run_20260927-080410_mmbp | full-no-skeptic (derived) | clean | 0% | 0% | 6% | – | 0 | none | 0 | 3.6 |
| run_20260927-033558_22us | deterministic | buggy | 50% | 50% | 50% | 100% | – | none | 0 | 1.2 |
| run_20260927-033800_yxo0 | deterministic | clean | 0% | 0% | 0% | – | 0 | none | 0 | 0.9 |
| run_20260927-085623_kd8k | full | buggy | 61% | 72% | 78% | 92% | – | D03 | 0 | 7.8 |
| run_20260927-085623_kd8k | ai-no-verify (derived) | buggy | 78% | 78% | 78% | 81% | – | D03 | 0 | 7.8 |
| run_20260927-085623_kd8k | full-no-skeptic (derived) | buggy | 61% | 72% | 78% | 92% | – | D03 | 0 | 7.8 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | ✓ · ✓ | confirmed | Confirmed |
| B02 | ✓ ✓ ✓ | confirmed | Confirmed |
| B03 | · · · | not found | Likely |
| B04 | ✓ · ✓ | needs_review | Likely |
| B05 | ✓ · ✓ | confirmed | Confirmed |
| B06 | · · · | not found | Confirmed |
| B07 | · · · | not found | Likely |
| B08 | · · · | not found | Confirmed |
| B09 | ✓ ✓ ✓ | confirmed | Confirmed |
| B10 | ✓ ✓ ✓ | confirmed | Confirmed |
| B11 | ✓ ✓ ✓ | confirmed | Confirmed |
| B12 | ✓ ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ ✓ | confirmed | Confirmed |
| B15 | ✓ ✓ ✓ | confirmed | Confirmed |
| B16 | ✓ ✓ ✓ | confirmed | Confirmed |
| B17 | ✓ · ✓ | likely | Likely |
| B18 | ✓ · ✓ | likely | Needs review |

## Needs a label (0)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

