# Witness evaluation summary

bugs.yaml + bugs-v2.yaml sha256 `eb16281ebdd8…` · bench commit `63dd118`

Combined: 23 seeded bugs; each finding counts for at most one of them (the more specific rule wins).

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260930-025209_3e4e | full | buggy | 57% | 61% | 61% | 100% | – | none | 1 | 6.0 |
| run_20260930-025209_3e4e | ai-no-verify (derived) | buggy | 61% | 61% | 61% | 81% | – | none | 1 | 6.0 |
| run_20260930-025209_3e4e | full-no-skeptic (derived) | buggy | 57% | 61% | 61% | 92% | – | none | 1 | 6.0 |
| run_20260930-025811_419u | full | buggy | 57% | 65% | 65% | 100% | – | none | 3 | 5.6 |
| run_20260930-025811_419u | ai-no-verify (derived) | buggy | 65% | 65% | 65% | 100% | – | none | 3 | 5.6 |
| run_20260930-025811_419u | full-no-skeptic (derived) | buggy | 57% | 65% | 65% | 100% | – | none | 3 | 5.6 |
| run_20260930-030351_adys | full | buggy | 61% | 70% | 70% | 100% | – | none | 6 | 7.4 |
| run_20260930-030351_adys | ai-no-verify (derived) | buggy | 70% | 70% | 70% | 94% | – | none | 6 | 7.4 |
| run_20260930-030351_adys | full-no-skeptic (derived) | buggy | 61% | 70% | 70% | 100% | – | none | 6 | 7.4 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · · · | not found | Confirmed |
| B02 | ✓ ✓ ✓ | confirmed | Confirmed |
| B03 | · · · | not found | Likely |
| B04 | · · ✓ | confirmed | Likely |
| B05 | · · ✓ | confirmed | Confirmed |
| B06 | ✓ ✓ · | confirmed | Confirmed |
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
| B17 | · · ✓ | likely | Likely |
| B18 | ✓ ✓ ✓ | likely | Needs review |
| B19 | ✓ ✓ ✓ | confirmed | Confirmed |
| B20 | · · · | not found | Confirmed |
| B21 | ✓ ✓ ✓ | confirmed | Confirmed |
| B22 | ✓ ✓ ✓ | confirmed | Confirmed |
| B23 | · ✓ · | likely | Likely |

## Needs a label (10)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_742018340b773984 (run_20260930-025209_3e4e) [improvement/suggestion] No visible cancel option on the booking detail page — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_eab8a02ab878920a (run_20260930-025811_419u) [bug/likely] Cancelled booking still shows a working Cancel button on the bookings page — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_5f2f7c8145a8641e (run_20260930-030351_adys) [bug/needs_review] Cancel button still shows after cancelling a different booking — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_5cbe6dffe778460d (run_20260930-030351_adys) [bug/needs_review] Cancel button and booking details remain after cancelling booking HC-1001 — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_ef7aea8f169bdecf (run_20260930-030351_adys) [bug/needs_review] Cancelling booking HC-1001 says it worked but the booking stays on the list — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_cb89fc91874d17d3 (run_20260930-030351_adys) [bug/needs_review] Rescheduled booking HC-1002 disappears from the bookings list — tentative match (B23 rule 2, confirm: manual); needs a label
- fp_72aecf223e94cc40 (run_20260930-025811_419u) [bug/needs_review] Contact form doesn't confirm the message was sent — matches no rule; needs a label
- fp_e188249e427f4cc4 (run_20260930-025811_419u) [improvement/suggestion] Reduce label ambiguity between 'Book' and 'My bookings' nav items — matches no rule; needs a label
- fp_087c355d171291c0 (run_20260930-030351_adys) [improvement/suggestion] 'Choose a service' placeholder text differs from actual selected value in URL-driven flow — matches no rule; needs a label
- fp_49d0cf34b1febfe9 (run_20260930-030351_adys) [improvement/suggestion] Sold out service still appears in the main booking dropdown — matches no rule; needs a label
