# Witness evaluation summary

bugs-v2.yaml sha256 `8e942da5ced6…` · bench commit `0551023`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-130217_vg4y | full | buggy | 60% | 80% | 80% | 100% | – | none | 16 | 8.2 |
| run_20260927-130217_vg4y | ai-no-verify (derived) | buggy | 80% | 80% | 80% | 78% | – | none | 16 | 8.2 |
| run_20260927-130217_vg4y | full-no-skeptic (derived) | buggy | 60% | 80% | 80% | 100% | – | none | 16 | 8.2 |
| run_20260927-131110_waqv | full | buggy | 60% | 60% | 60% | 100% | – | none | 12 | 7.0 |
| run_20260927-131110_waqv | ai-no-verify (derived) | buggy | 60% | 60% | 60% | 80% | – | none | 12 | 7.0 |
| run_20260927-131110_waqv | full-no-skeptic (derived) | buggy | 60% | 60% | 60% | 100% | – | none | 12 | 7.0 |
| run_20260927-131858_a21a | full | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.7 |
| run_20260927-131858_a21a | ai-no-verify (derived) | clean | 0% | 0% | 0% | 0% | 3 | none | 0 | 5.7 |
| run_20260927-131858_a21a | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.7 |
| run_20260927-133005_qn8k | full | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.3 |
| run_20260927-133005_qn8k | ai-no-verify (derived) | clean | 0% | 0% | 0% | 0% | 3 | none | 0 | 5.3 |
| run_20260927-133005_qn8k | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 0 | 5.3 |
| run_20260927-125512_jhx0 | deterministic | buggy | 60% | 60% | 60% | 100% | – | none | 9 | 1.3 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B19 | ✓ ✓ ✓ | confirmed | Confirmed |
| B20 | · · · | not found | Confirmed |
| B21 | ✓ ✓ ✓ | confirmed | Confirmed |
| B22 | ✓ ✓ ✓ | confirmed | Confirmed |
| B23 | ✓ · · | likely | Likely |

## Needs a label (18)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_c35559a5aa03b124 (run_20260927-130217_vg4y) [bug/confirmed] Booking form accepts dates that have already passed — matches no rule; needs a label
- fp_987039207f2338d9 (run_20260927-130217_vg4y) [bug/confirmed] Booking form crashes when a name contains an apostrophe — matches no rule; needs a label
- fp_ce124386e82c3363 (run_20260927-130217_vg4y) [bug/confirmed] Cancelled booking still shows up in the bookings list — matches no rule; needs a label
- fp_ae14784f6329e477 (run_20260927-130217_vg4y) [bug/likely] Clicking the booking button twice quickly creates two bookings — matches no rule; needs a label
- fp_859845f0ad6cf94d (run_20260927-130217_vg4y) [bug/confirmed] Updated phone number on profile does not save correctly — matches no rule; needs a label
- fp_402826ae5f6a4b43 (run_20260927-130217_vg4y) [bug/needs_review] Booking form accepts a date that has already passed — matches no rule; needs a label
- fp_b3f5826353bd1a23 (run_20260927-130217_vg4y) [bug/confirmed] Search box lets typed text be inserted as page code (security risk) — matches no rule; needs a label
- fp_67b897a090f8b356 (run_20260927-130217_vg4y) [bug/confirmed] The page's JavaScript crashed: TypeError: Cannot read properties of undefined (reading 'links') — matches no rule; needs a label
- fp_7b76efbe19cde62c (run_20260927-130217_vg4y) [bug/confirmed] Image doesn't load: "Carpet shampoo" — matches no rule; needs a label
- fp_66408ac5789781e6 (run_20260927-130217_vg4y) [bug/likely] Login errors reveal whether an account exists — matches no rule; needs a label
- fp_0fa71620b9c525c3 (run_20260927-130217_vg4y) [bug/confirmed] Page scrolls sideways on a phone (605 px content in a 375 px screen) — matches no rule; needs a label
- fp_d2cffea3ad040b42 (run_20260927-130217_vg4y) [bug/confirmed] Link "Terms" goes to a missing page (/terms-and-conditions → 404) — matches no rule; needs a label
- fp_47bcc5a3238b3d5f (run_20260927-130217_vg4y) [improvement/evidence_based] Accessibility: Buttons must have discernible text — matches no rule; needs a label
- fp_4b42d1f0cab26db3 (run_20260927-130217_vg4y) [improvement/evidence_based] Accessibility: Elements must meet minimum color contrast ratio thresholds — matches no rule; needs a label
- fp_88181b5b01b2e3b0 (run_20260927-130217_vg4y) [improvement/evidence_based] Accessibility: Form elements must have labels — matches no rule; needs a label
- fp_fcb2c9f64fd53c70 (run_20260927-130217_vg4y) [improvement/evidence_based] Slow API call: GET /api/bookings took 3.5 s — matches no rule; needs a label
- fp_6a8aae906f8d1072 (run_20260927-131110_waqv) [bug/needs_review] Hidden text on services page tries to trick automated testers — matches no rule; needs a label
- fp_0b5018fbe735f602 (run_20260927-131110_waqv) [bug/confirmed] Saved name change on profile page is lost after reloading — matches no rule; needs a label
