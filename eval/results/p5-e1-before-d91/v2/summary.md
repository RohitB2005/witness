# Witness evaluation summary

bugs-v2.yaml sha256 `8e942da5ced6…` · bench commit `63dd118`

Precision is reported only when both lists are scored together (--bugs bench/bugs.yaml,bench/bugs-v2.yaml); here it shows –.

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260930-025209_3e4e | full | buggy | 60% | 60% | 60% | – | – | none | 13 | 6.0 |
| run_20260930-025209_3e4e | ai-no-verify (derived) | buggy | 60% | 60% | 60% | – | – | none | 13 | 6.0 |
| run_20260930-025209_3e4e | full-no-skeptic (derived) | buggy | 60% | 60% | 60% | – | – | none | 13 | 6.0 |
| run_20260930-025811_419u | full | buggy | 60% | 80% | 80% | – | – | none | 15 | 5.6 |
| run_20260930-025811_419u | ai-no-verify (derived) | buggy | 80% | 80% | 80% | – | – | none | 15 | 5.6 |
| run_20260930-025811_419u | full-no-skeptic (derived) | buggy | 60% | 80% | 80% | – | – | none | 15 | 5.6 |
| run_20260930-030351_adys | full | buggy | 60% | 60% | 60% | – | – | none | 21 | 7.4 |
| run_20260930-030351_adys | ai-no-verify (derived) | buggy | 60% | 60% | 60% | – | – | none | 21 | 7.4 |
| run_20260930-030351_adys | full-no-skeptic (derived) | buggy | 60% | 60% | 60% | – | – | none | 21 | 7.4 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B19 | ✓ ✓ ✓ | confirmed | Confirmed |
| B20 | · · · | not found | Confirmed |
| B21 | ✓ ✓ ✓ | confirmed | Confirmed |
| B22 | ✓ ✓ ✓ | confirmed | Confirmed |
| B23 | · ✓ · | likely | Likely |

## Needs a label (27)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_cb89fc91874d17d3 (run_20260930-030351_adys) [bug/needs_review] Rescheduled booking HC-1002 disappears from the bookings list — tentative match (B23 rule 2, confirm: manual); needs a label
- fp_bac8de2d79a6c4af (run_20260930-025209_3e4e) [bug/confirmed] Cancelling a booking doesn't remove it from the list — matches no rule; needs a label
- fp_67b897a090f8b356 (run_20260930-025209_3e4e) [bug/confirmed] Clicking an FAQ question crashes the page's script — matches no rule; needs a label
- fp_b3f5826353bd1a23 (run_20260930-025209_3e4e) [bug/confirmed] Search box lets attackers insert hidden code into the page — matches no rule; needs a label
- fp_7b76efbe19cde62c (run_20260930-025209_3e4e) [bug/confirmed] Carpet shampoo service image is missing — matches no rule; needs a label
- fp_66408ac5789781e6 (run_20260930-025209_3e4e) [bug/likely] Login errors reveal whether an account exists — matches no rule; needs a label
- fp_0fa71620b9c525c3 (run_20260930-025209_3e4e) [bug/confirmed] Booking page content is too wide for phone screens — matches no rule; needs a label
- fp_d2cffea3ad040b42 (run_20260930-025209_3e4e) [bug/confirmed] The "Terms" link leads to a missing page — matches no rule; needs a label
- fp_47bcc5a3238b3d5f (run_20260930-025209_3e4e) [improvement/evidence_based] Accessibility: Buttons must have discernible text — matches no rule; needs a label
- fp_7f6878c00f5748a9 (run_20260930-025209_3e4e) [improvement/evidence_based] Accessibility: Buttons must have discernible text — matches no rule; needs a label
- fp_4b42d1f0cab26db3 (run_20260930-025209_3e4e) [improvement/evidence_based] Accessibility: Elements must meet minimum color contrast ratio thresholds — matches no rule; needs a label
- fp_88181b5b01b2e3b0 (run_20260930-025209_3e4e) [improvement/evidence_based] Accessibility: Form elements must have labels — matches no rule; needs a label
- fp_fcb2c9f64fd53c70 (run_20260930-025209_3e4e) [improvement/evidence_based] Slow API call: GET /api/bookings took 3.5 s — matches no rule; needs a label
- fp_742018340b773984 (run_20260930-025209_3e4e) [improvement/suggestion] No visible cancel option on the booking detail page — matches no rule; needs a label
- fp_eab8a02ab878920a (run_20260930-025811_419u) [bug/likely] Cancelled booking still shows a working Cancel button on the bookings page — matches no rule; needs a label
- fp_72aecf223e94cc40 (run_20260930-025811_419u) [bug/needs_review] Contact form doesn't confirm the message was sent — matches no rule; needs a label
- fp_e188249e427f4cc4 (run_20260930-025811_419u) [improvement/suggestion] Reduce label ambiguity between 'Book' and 'My bookings' nav items — matches no rule; needs a label
- fp_fdaa51b23b02bf99 (run_20260930-030351_adys) [bug/confirmed] Booking form accepts dates that have already passed — matches no rule; needs a label
- fp_987039207f2338d9 (run_20260930-030351_adys) [bug/confirmed] Booking form crashes when a name contains an apostrophe — matches no rule; needs a label
- fp_5f2f7c8145a8641e (run_20260930-030351_adys) [bug/needs_review] Cancel button still shows after cancelling a different booking — matches no rule; needs a label
- fp_ae14784f6329e477 (run_20260930-030351_adys) [bug/likely] Clicking the booking button twice quickly creates two bookings — matches no rule; needs a label
- fp_627efda74a608fc2 (run_20260930-030351_adys) [bug/likely] Booking confirmed with a past date instead of being rejected — matches no rule; needs a label
- fp_91a1d40c58b08c62 (run_20260930-030351_adys) [bug/needs_review] Booking form accepts a date that has already passed — matches no rule; needs a label
- fp_5cbe6dffe778460d (run_20260930-030351_adys) [bug/needs_review] Cancel button and booking details remain after cancelling booking HC-1001 — matches no rule; needs a label
- fp_ef7aea8f169bdecf (run_20260930-030351_adys) [bug/needs_review] Cancelling booking HC-1001 says it worked but the booking stays on the list — matches no rule; needs a label
- fp_087c355d171291c0 (run_20260930-030351_adys) [improvement/suggestion] 'Choose a service' placeholder text differs from actual selected value in URL-driven flow — matches no rule; needs a label
- fp_49d0cf34b1febfe9 (run_20260930-030351_adys) [improvement/suggestion] Sold out service still appears in the main booking dropdown — matches no rule; needs a label
