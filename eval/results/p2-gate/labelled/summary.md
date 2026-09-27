# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `bf46ccb`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260926-040918_ykwq | full | buggy | 17% | 56% | 67% | 58% | – | D03 | 0 | 7.4 |
| run_20260926-042245_y1z1 | full | buggy | 17% | 67% | 67% | 60% | – | D03 | 0 | 7.7 |
| run_20260926-043405_1k8m | full | buggy | 17% | 61% | 61% | 53% | – | none | 0 | 7.5 |
| run_20260926-044517_0m6x | full | buggy | 17% | 50% | 50% | 86% | – | none | 0 | 7.9 |
| run_20260926-051200_38ne | full | buggy | 17% | 72% | 72% | 56% | – | none | 0 | 7.0 |
| run_20260926-051940_8f4c | deterministic | buggy | 17% | 33% | 33% | 100% | – | none | 0 | 0.6 |
| run_20260926-052025_dbtu | deterministic | clean | 0% | 0% | 0% | – | 0 | none | 0 | 0.5 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · · · · · · | not found | Confirmed |
| B02 | · · · · · · | not found | Confirmed |
| B03 | ✓ ✓ · ✓ ✓ · | likely | Likely |
| B04 | ✓ ✓ ✓ · ✓ · | likely | Likely |
| B05 | ✓ ✓ ✓ · ✓ · | likely | Confirmed |
| B06 | ✓ ✓ ✓ ✓ ✓ · | likely | Confirmed |
| B07 | · · · · · · | not found | Likely |
| B08 | ✓ ✓ ✓ ✓ ✓ · | likely | Confirmed |
| B09 | ✓ ✓ ✓ ✓ ✓ ✓ | likely | Confirmed |
| B10 | ✓ ✓ ✓ ✓ ✓ ✓ | likely | Confirmed |
| B11 | · · · · · · | not found | Confirmed |
| B12 | ✓ ✓ ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B15 | · · · · · · | not found | Confirmed |
| B16 | ✓ ✓ ✓ ✓ ✓ ✓ | likely | Confirmed |
| B17 | ✓ ✓ ✓ · ✓ · | likely | Likely |
| B18 | · · · · ✓ · | likely | Needs review |

## Needs a label (0)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

