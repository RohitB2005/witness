# Witness evaluation summary

bugs-v2.yaml sha256 `8e942da5ced6…` · bench commit `63dd118`

Precision is reported only when both lists are scored together (--bugs bench/bugs.yaml,bench/bugs-v2.yaml); here it shows –.

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260930-031814_2nd8 | full | buggy | 60% | 60% | 60% | – | – | none | 14 | 5.0 |
| run_20260930-031814_2nd8 | ai-no-verify (derived) | buggy | 60% | 60% | 60% | – | – | none | 14 | 5.0 |
| run_20260930-031814_2nd8 | full-no-skeptic (derived) | buggy | 60% | 60% | 60% | – | – | none | 14 | 5.0 |
| run_20260930-032314_pap6 | full | buggy | 60% | 80% | 80% | – | – | none | 16 | 7.8 |
| run_20260930-032314_pap6 | ai-no-verify (derived) | buggy | 80% | 80% | 80% | – | – | none | 16 | 7.8 |
| run_20260930-032314_pap6 | full-no-skeptic (derived) | buggy | 60% | 80% | 80% | – | – | none | 16 | 7.8 |
| run_20260930-033105_yshv | full | buggy | 60% | 80% | 80% | – | – | none | 12 | 6.2 |
| run_20260930-033105_yshv | ai-no-verify (derived) | buggy | 80% | 80% | 80% | – | – | none | 12 | 6.2 |
| run_20260930-033105_yshv | full-no-skeptic (derived) | buggy | 60% | 80% | 80% | – | – | none | 12 | 6.2 |
| run_20260930-033743_g3sx | full | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-033743_g3sx | ai-no-verify (derived) | clean | – | – | – | – | 1 | none | 0 | 5.7 |
| run_20260930-033743_g3sx | full-no-skeptic (derived) | clean | – | – | – | – | 1 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | full | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | ai-no-verify (derived) | clean | – | – | – | – | 2 | none | 0 | 5.7 |
| run_20260930-034328_4em1 | full-no-skeptic (derived) | clean | – | – | – | – | 0 | none | 0 | 5.7 |
| run_20260930-041939_0xz5 | deterministic | buggy | 60% | 60% | 60% | – | – | none | 9 | 1.3 |
| run_20260930-042101_0py6 | deterministic | clean | – | – | – | – | 0 | none | 0 | 1.0 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B19 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B20 | · · · · | not found | Confirmed |
| B21 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B22 | ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B23 | · ✓ ✓ · | likely | Likely |

## Needs a label (21)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_bac8de2d79a6c4af (run_20260930-031814_2nd8) [bug/confirmed] Cancelling a booking doesn't remove it from the list — matches no rule; needs a label
- fp_ea4f76801c22fdcd (run_20260930-031814_2nd8) [bug/likely] GST calculation doesn't match the displayed total (duplicate of total mismatch) — matches no rule; needs a label
- fp_baf5a7b51f8115e5 (run_20260930-031814_2nd8) [bug/confirmed] Quote total doesn't match subtotal plus tax — matches no rule; needs a label
- fp_67b897a090f8b356 (run_20260930-031814_2nd8) [bug/confirmed] Clicking an FAQ question causes a page error — matches no rule; needs a label
- fp_b3f5826353bd1a23 (run_20260930-031814_2nd8) [bug/confirmed] Search box lets attackers insert hidden code into the page — matches no rule; needs a label
- fp_7b76efbe19cde62c (run_20260930-031814_2nd8) [bug/confirmed] Image doesn't load: "Carpet shampoo" — matches no rule; needs a label
- fp_66408ac5789781e6 (run_20260930-031814_2nd8) [bug/likely] Login errors reveal whether an account exists — matches no rule; needs a label
- fp_d2cffea3ad040b42 (run_20260930-031814_2nd8) [bug/confirmed] Link "Terms" goes to a missing page (/terms-and-conditions → 404) — matches no rule; needs a label
- fp_0fa71620b9c525c3 (run_20260930-031814_2nd8) [bug/confirmed] Page scrolls sideways on a phone (605 px content in a 375 px screen) — matches no rule; needs a label
- fp_47bcc5a3238b3d5f (run_20260930-031814_2nd8) [improvement/evidence_based] Accessibility: Buttons must have discernible text — matches no rule; needs a label
- fp_7f6878c00f5748a9 (run_20260930-031814_2nd8) [improvement/evidence_based] Accessibility: Buttons must have discernible text — matches no rule; needs a label
- fp_4b42d1f0cab26db3 (run_20260930-031814_2nd8) [improvement/evidence_based] Accessibility: Elements must meet minimum color contrast ratio thresholds — matches no rule; needs a label
- fp_88181b5b01b2e3b0 (run_20260930-031814_2nd8) [improvement/evidence_based] Accessibility: Form elements must have labels — matches no rule; needs a label
- fp_fcb2c9f64fd53c70 (run_20260930-031814_2nd8) [improvement/evidence_based] Slow API call: GET /api/bookings took 3.5 s — matches no rule; needs a label
- fp_c35559a5aa03b124 (run_20260930-032314_pap6) [bug/confirmed] Booking form accepts dates that have already passed — matches no rule; needs a label
- fp_ae14784f6329e477 (run_20260930-032314_pap6) [bug/likely] Clicking the booking confirm button twice quickly creates two bookings — matches no rule; needs a label
- fp_bf04bf492e1e0d73 (run_20260930-032314_pap6) [bug/confirmed] Quote calculator total doesn't match the subtotal plus tax — matches no rule; needs a label
- fp_987039207f2338d9 (run_20260930-032314_pap6) [bug/confirmed] Submitting a booking with an apostrophe in the name crashes the server — matches no rule; needs a label
- fp_3ca9c9eed4f37644 (run_20260930-032314_pap6) [bug/needs_review] Booking form allows booking a cleaning for a date already passed — matches no rule; needs a label
- fp_2919d8bf741c1bd7 (run_20260930-032314_pap6) [bug/confirmed] Failed check: The updated phone number persists after reloading the page — matches no rule; needs a label
- fp_217a8503f8aa80f5 (run_20260930-033105_yshv) [bug/confirmed] Cancel button for a booking stays after cancelling it — matches no rule; needs a label
