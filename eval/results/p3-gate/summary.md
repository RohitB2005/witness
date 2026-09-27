# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `e97ae33`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-053847_3ih8 | full | buggy | 50% | 67% | 72% | 100% | – | D03 | 8 | 7.4 |
| run_20260927-053847_3ih8 | ai-no-verify (derived) | buggy | 50% | 67% | 72% | 100% | – | D03 | 8 | 7.4 |
| run_20260927-053847_3ih8 | full-no-skeptic (derived) | buggy | 50% | 67% | 72% | 100% | – | D03 | 8 | 7.4 |
| run_20260927-075935_ps4l | full | clean | 0% | 0% | 6% | – | 0 | none | 4 | 4.6 |
| run_20260927-075935_ps4l | ai-no-verify (derived) | clean | 0% | 0% | 6% | – | 0 | none | 4 | 4.6 |
| run_20260927-075935_ps4l | full-no-skeptic (derived) | clean | 0% | 0% | 6% | – | 0 | none | 4 | 4.6 |
| run_20260927-080410_mmbp | full | clean | 0% | 0% | 6% | – | 0 | none | 5 | 3.6 |
| run_20260927-080410_mmbp | ai-no-verify (derived) | clean | 0% | 0% | 6% | – | 0 | none | 5 | 3.6 |
| run_20260927-080410_mmbp | full-no-skeptic (derived) | clean | 0% | 0% | 6% | – | 0 | none | 5 | 3.6 |
| run_20260927-033558_22us | deterministic | buggy | 44% | 44% | 44% | 100% | – | none | 1 | 1.2 |
| run_20260927-033800_yxo0 | deterministic | clean | 0% | 0% | 0% | – | 0 | none | 0 | 0.9 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | ✓ · | likely | Confirmed |
| B02 | · · | not found | Confirmed |
| B03 | · · | not found | Likely |
| B04 | ✓ · | needs_review | Likely |
| B05 | ✓ · | confirmed | Confirmed |
| B06 | · · | not found | Confirmed |
| B07 | · · | not found | Likely |
| B08 | · · | not found | Confirmed |
| B09 | ✓ ✓ | confirmed | Confirmed |
| B10 | ✓ ✓ | confirmed | Confirmed |
| B11 | ✓ ✓ | confirmed | Confirmed |
| B12 | ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ | confirmed | Confirmed |
| B15 | ✓ ✓ | confirmed | Confirmed |
| B16 | ✓ ✓ | confirmed | Confirmed |
| B17 | ✓ · | likely | Likely |
| B18 | ✓ · | likely | Needs review |

## Needs a label (10)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_6bb97fda8af2347e (run_20260927-053847_3ih8) [bug/confirmed] Quote total on the /quote page doesn't match subtotal plus GST — tentative match (B01 rule 2, confirm: manual); needs a label
- fp_c6688d3c457c8c97 (run_20260927-053847_3ih8) [bug/confirmed] "Price: low to high" sorting on /services doesn't actually sort by price — tentative match (B02 rule 2, confirm: manual); needs a label
- fp_6d0eaec68b7f7a56 (run_20260927-053847_3ih8) [bug/likely] Booking confirmation page doesn't show the booking summary — matches no rule; needs a label
- fp_a6f5295f03639dd0 (run_20260927-053847_3ih8) [bug/needs_review] Quote page doesn't show the $45 per hour rate for Regular home clean — matches no rule; needs a label
- fp_bde51281a6cf251e (run_20260927-053847_3ih8) [improvement/suggestion] 'Estimate' label doesn't clarify GST status inconsistency with Quote page — matches no rule; needs a label
- fp_ca537fb10dfed8b6 (run_20260927-053847_3ih8) [improvement/suggestion] Booking summary shows no feedback until fields are filled — matches no rule; needs a label
- fp_8f54cc35896bd9bf (run_20260927-053847_3ih8) [improvement/suggestion] Sold-out service still selectable on Quote page — matches no rule; needs a label
- fp_fa20149c865c2a16 (run_20260927-053847_3ih8) [improvement/suggestion] Sort dropdown default label doesn't indicate current sort logic — matches no rule; needs a label
- fp_8a1b5addf9b47851 (run_20260927-075935_ps4l) [improvement/suggestion] Sold-out service still shown as bookable on its detail page — matches no rule; needs a label
- fp_22654de7f32abf0e (run_20260927-080410_mmbp) [bug/needs_review] Booking summary does not update with hours or service chosen — matches no rule; needs a label
