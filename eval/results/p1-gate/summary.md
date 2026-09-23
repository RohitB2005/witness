# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `dd08cd3`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260923-040149_s2y0 | deterministic | buggy | 17% | 33% | 33% | 100% | – | none | 0 | 0.6 |
| run_20260923-040259_m9hr | deterministic | clean | 0% | 0% | 0% | – | 0 | none | 0 | 0.5 |
| run_20260923-040338_0bwa | deterministic | clean | 0% | 0% | 0% | – | 0 | none | 0 | 0.5 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · | not found | Confirmed |
| B02 | · | not found | Confirmed |
| B03 | · | not found | Likely |
| B04 | · | not found | Likely |
| B05 | · | not found | Confirmed |
| B06 | · | not found | Confirmed |
| B07 | · | not found | Likely |
| B08 | · | not found | Confirmed |
| B09 | ✓ | likely | Confirmed |
| B10 | ✓ | likely | Confirmed |
| B11 | · | not found | Confirmed |
| B12 | ✓ | confirmed | Confirmed |
| B13 | ✓ | confirmed | Confirmed |
| B14 | ✓ | confirmed | Confirmed |
| B15 | · | not found | Confirmed |
| B16 | ✓ | likely | Confirmed |
| B17 | · | not found | Likely |
| B18 | · | not found | Needs review |

## Needs a label (0)

Add `"<fingerprint>": "tp:Bxx" | "tp_unseeded" | "fp"` to eval/labels.json.

