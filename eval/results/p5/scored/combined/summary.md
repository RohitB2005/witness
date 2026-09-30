# Witness evaluation summary

bugs.yaml + bugs-v2.yaml sha256 `eb16281ebdd8…` · bench commit `63dd118`

Combined: 23 seeded bugs; each finding counts for at most one of them (the more specific rule wins).

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260930-031814_2nd8 | full | buggy | 61% | 65% | 70% | 100% | – | none | 0 | 5.0 |
| run_20260930-031814_2nd8 | ai-no-verify (derived) | buggy | 70% | 70% | 70% | 86% | – | none | 0 | 5.0 |
| run_20260930-031814_2nd8 | full-no-skeptic (derived) | buggy | 61% | 65% | 70% | 94% | – | none | 0 | 5.0 |
| run_20260930-032314_pap6 | full | buggy | 70% | 83% | 83% | 100% | – | none | 0 | 7.8 |
| run_20260930-032314_pap6 | ai-no-verify (derived) | buggy | 83% | 83% | 83% | 79% | – | none | 0 | 7.8 |
| run_20260930-032314_pap6 | full-no-skeptic (derived) | buggy | 70% | 83% | 83% | 100% | – | none | 0 | 7.8 |
| run_20260930-033105_yshv | full | buggy | 61% | 70% | 70% | 100% | – | none | 0 | 6.2 |
| run_20260930-033105_yshv | ai-no-verify (derived) | buggy | 70% | 70% | 70% | 79% | – | none | 0 | 6.2 |
| run_20260930-033105_yshv | full-no-skeptic (derived) | buggy | 61% | 70% | 70% | 93% | – | none | 0 | 6.2 |
| run_20260930-033743_g3sx | full | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-033743_g3sx | ai-no-verify (derived) | clean | – | – | – | – | 1 | none | 0 | 5.7 |
| run_20260930-033743_g3sx | full-no-skeptic (derived) | clean | – | – | – | – | 1 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | full | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | ai-no-verify (derived) | clean | – | – | – | – | 2 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | full-no-skeptic (derived) | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-041939_0xz5 | deterministic | buggy | 52% | 52% | 52% | 100% | – | none | 0 | 1.3 |
| run_20260930-042101_0py6 | deterministic | clean | – | – | – | – | 0 | none | 0 | 1.0 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | ✓ ✓ · · | confirmed | Confirmed |
| B02 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B03 | · · ✓ · | confirmed | Likely |
| B04 | · ✓ · · | confirmed | Likely |
| B05 | · ✓ · · | confirmed | Confirmed |
| B06 | ✓ · ✓ · | confirmed | Confirmed |
| B07 | ✓ · · · | needs_review | Likely |
| B08 | · ✓ · · | confirmed | Confirmed |
| B09 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B10 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B11 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B12 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B15 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B16 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B17 | · ✓ · · | likely | Likely |
| B18 | ✓ ✓ ✓ · | likely | Needs review |
| B19 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B20 | · · · · | not found | Confirmed |
| B21 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B22 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B23 | · ✓ ✓ · | likely | Likely |

## Needs a label (0)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

