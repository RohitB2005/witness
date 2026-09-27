# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `678d40b`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-220027_dpi0 | full | buggy | 78% | 89% | 89% | 100% | – | none | 8 | 7.9 |
| run_20260927-220027_dpi0 | ai-no-verify (derived) | buggy | 89% | 89% | 89% | 100% | – | none | 8 | 7.9 |
| run_20260927-220027_dpi0 | full-no-skeptic (derived) | buggy | 78% | 89% | 89% | 100% | – | none | 8 | 7.9 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | ✓ | confirmed | Confirmed |
| B02 | ✓ | confirmed | Confirmed |
| B03 | · | not found | Likely |
| B04 | ✓ | confirmed | Likely |
| B05 | ✓ | confirmed | Confirmed |
| B06 | ✓ | confirmed | Confirmed |
| B07 | · | not found | Likely |
| B08 | ✓ | confirmed | Confirmed |
| B09 | ✓ | confirmed | Confirmed |
| B10 | ✓ | confirmed | Confirmed |
| B11 | ✓ | confirmed | Confirmed |
| B12 | ✓ | confirmed | Confirmed |
| B13 | ✓ | confirmed | Confirmed |
| B14 | ✓ | confirmed | Confirmed |
| B15 | ✓ | confirmed | Confirmed |
| B16 | ✓ | confirmed | Confirmed |
| B17 | ✓ | likely | Likely |
| B18 | ✓ | likely | Needs review |

## Needs a label (8)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_3170f5d615216ca1 (run_20260927-220027_dpi0) [bug/likely] Booking HC-1002 cancellation failed: the "Cancel booking HC-1002" button is still visible after clicking "Yes… — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_108e130b1258f658 (run_20260927-220027_dpi0) [bug/confirmed] Booking details can be viewed by anyone, without logging in — matches no rule; needs a label
- fp_4807641267f25a31 (run_20260927-220027_dpi0) [bug/confirmed] Secret payment key is exposed to anyone visiting the site — matches no rule; needs a label
- fp_c560f7c11131d309 (run_20260927-220027_dpi0) [bug/needs_review] Booking form accepts today's date though bookings should be for a future day — matches no rule; needs a label
- fp_d06593923558174f (run_20260927-220027_dpi0) [bug/likely] No way found to reschedule an existing booking to a new date or time — matches no rule; needs a label
- fp_a6591c8294d071db (run_20260927-220027_dpi0) [bug/confirmed] Sorting by price low to high does not put prices in the correct order — matches no rule; needs a label
- fp_e5d10df6fb28b74f (run_20260927-220027_dpi0) [bug/needs_review] Failed check: The form on /profile refuses a phone number with letters and punctuation in "Phone" — matches no rule; needs a label
- fp_f90827b9e3ff44a9 (run_20260927-220027_dpi0) [improvement/suggestion] 'Sold out' text easy to mistake for a description — matches no rule; needs a label
