# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `63dd118`

Precision is reported only when both lists are scored together (--bugs bench/bugs.yaml,bench/bugs-v2.yaml); here it shows –.

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260930-031814_2nd8 | full | buggy | 61% | 67% | 72% | – | – | none | 2 | 5.0 |
| run_20260930-031814_2nd8 | ai-no-verify (derived) | buggy | 72% | 72% | 72% | – | – | none | 2 | 5.0 |
| run_20260930-031814_2nd8 | full-no-skeptic (derived) | buggy | 61% | 67% | 72% | – | – | none | 2 | 5.0 |
| run_20260930-032314_pap6 | full | buggy | 72% | 83% | 83% | – | – | none | 3 | 7.8 |
| run_20260930-032314_pap6 | ai-no-verify (derived) | buggy | 83% | 83% | 83% | – | – | none | 3 | 7.8 |
| run_20260930-032314_pap6 | full-no-skeptic (derived) | buggy | 72% | 83% | 83% | – | – | none | 3 | 7.8 |
| run_20260930-033105_yshv | full | buggy | 61% | 67% | 67% | – | – | none | 3 | 6.2 |
| run_20260930-033105_yshv | ai-no-verify (derived) | buggy | 67% | 67% | 67% | – | – | none | 3 | 6.2 |
| run_20260930-033105_yshv | full-no-skeptic (derived) | buggy | 61% | 67% | 67% | – | – | none | 3 | 6.2 |
| run_20260930-033743_g3sx | full | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-033743_g3sx | ai-no-verify (derived) | clean | – | – | – | – | 1 | none | 0 | 5.7 |
| run_20260930-033743_g3sx | full-no-skeptic (derived) | clean | – | – | – | – | 1 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | full | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | ai-no-verify (derived) | clean | – | – | – | – | 2 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | full-no-skeptic (derived) | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-041939_0xz5 | deterministic | buggy | 50% | 50% | 50% | – | – | none | 2 | 1.3 |
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

## Needs a label (3)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_4807641267f25a31 (run_20260930-031814_2nd8) [bug/confirmed] A secret payment key is exposed to anyone visiting the site — matches no rule; needs a label
- fp_108e130b1258f658 (run_20260930-031814_2nd8) [bug/confirmed] Booking data can be viewed by anyone without logging in — matches no rule; needs a label
- fp_d06593923558174f (run_20260930-032314_pap6) [bug/likely] No way found to reschedule an existing booking to a new date or time — matches no rule; needs a label
