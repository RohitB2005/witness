# Witness evaluation summary

bugs.yaml + bugs-v2.yaml sha256 `eb16281ebdd8…` · bench commit `63dd118`

Combined: 23 seeded bugs; each finding counts for at most one of them (the more specific rule wins).

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260930-035345_qt6c | full | buggy | 57% | 65% | 65% | 100% | – | none | 0 | 4.0 |
| run_20260930-035345_qt6c | ai-no-verify (derived) | buggy | 65% | 65% | 65% | 100% | – | none | 0 | 4.0 |
| run_20260930-035345_qt6c | full-no-skeptic (derived) | buggy | 57% | 65% | 65% | 100% | – | none | 0 | 4.0 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · | not found | Confirmed |
| B02 | ✓ | confirmed | Confirmed |
| B03 | · | not found | Likely |
| B04 | · | not found | Likely |
| B05 | · | not found | Confirmed |
| B06 | ✓ | confirmed | Confirmed |
| B07 | · | not found | Likely |
| B08 | · | not found | Confirmed |
| B09 | ✓ | confirmed | Confirmed |
| B10 | ✓ | confirmed | Confirmed |
| B11 | ✓ | confirmed | Confirmed |
| B12 | ✓ | confirmed | Confirmed |
| B13 | ✓ | confirmed | Confirmed |
| B14 | ✓ | confirmed | Confirmed |
| B15 | ✓ | confirmed | Confirmed |
| B16 | ✓ | confirmed | Confirmed |
| B17 | · | not found | Likely |
| B18 | ✓ | likely | Needs review |
| B19 | ✓ | confirmed | Confirmed |
| B20 | · | not found | Confirmed |
| B21 | ✓ | confirmed | Confirmed |
| B22 | ✓ | confirmed | Confirmed |
| B23 | ✓ | likely | Likely |

## Needs a label (0)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

