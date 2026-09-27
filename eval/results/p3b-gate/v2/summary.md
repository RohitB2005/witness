# Witness evaluation summary

bugs-v2.yaml sha256 `8e942da5ced6…` · bench commit `cf36a08`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-130217_vg4y | full | buggy | 60% | 80% | 80% | 100% | – | none | 24 | 8.2 |
| run_20260927-130217_vg4y | ai-no-verify (derived) | buggy | 80% | 80% | 80% | 100% | – | none | 24 | 8.2 |
| run_20260927-130217_vg4y | full-no-skeptic (derived) | buggy | 60% | 80% | 80% | 100% | – | none | 24 | 8.2 |
| run_20260927-131110_waqv | full | buggy | 60% | 60% | 60% | 100% | – | none | 19 | 7.0 |
| run_20260927-131110_waqv | ai-no-verify (derived) | buggy | 60% | 60% | 60% | 100% | – | none | 19 | 7.0 |
| run_20260927-131110_waqv | full-no-skeptic (derived) | buggy | 60% | 60% | 60% | 100% | – | none | 19 | 7.0 |
| run_20260927-131858_a21a | full | clean | 0% | 0% | 0% | – | 0 | none | 4 | 5.7 |
| run_20260927-131858_a21a | ai-no-verify (derived) | clean | 0% | 0% | 0% | – | 3 | none | 6 | 5.7 |
| run_20260927-131858_a21a | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 4 | 5.7 |
| run_20260927-133005_qn8k | full | clean | 0% | 0% | 0% | – | 0 | none | 5 | 5.3 |
| run_20260927-133005_qn8k | ai-no-verify (derived) | clean | 0% | 0% | 0% | – | 3 | none | 5 | 5.3 |
| run_20260927-133005_qn8k | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 5 | 5.3 |
| run_20260927-125512_jhx0 | deterministic | buggy | 60% | 60% | 60% | 100% | – | none | 9 | 1.3 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B19 | ✓ ✓ ✓ | confirmed | Confirmed |
| B20 | · · · | not found | Confirmed |
| B21 | ✓ ✓ ✓ | confirmed | Confirmed |
| B22 | ✓ ✓ ✓ | confirmed | Confirmed |
| B23 | ✓ · · | likely | Likely |

## Needs a label (41)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_c35559a5aa03b124 (run_20260927-130217_vg4y) [bug/confirmed] Booking form accepts dates that have already passed — matches no rule; needs a label
- fp_987039207f2338d9 (run_20260927-130217_vg4y) [bug/confirmed] Booking form crashes when a name contains an apostrophe — matches no rule; needs a label
- fp_ce124386e82c3363 (run_20260927-130217_vg4y) [bug/confirmed] Cancelled booking still shows up in the bookings list — matches no rule; needs a label
- fp_ae14784f6329e477 (run_20260927-130217_vg4y) [bug/likely] Clicking the booking button twice quickly creates two bookings — matches no rule; needs a label
- fp_859845f0ad6cf94d (run_20260927-130217_vg4y) [bug/confirmed] Updated phone number on profile does not save correctly — matches no rule; needs a label
- fp_402826ae5f6a4b43 (run_20260927-130217_vg4y) [bug/needs_review] Booking form accepts a date that has already passed — matches no rule; needs a label
- fp_e38a34ecea756a5f (run_20260927-130217_vg4y) [bug/needs_review] Booking form may not accept half-hour amounts like 1.5 hours — matches no rule; needs a label
- fp_a4abe8cbebd37e3b (run_20260927-130217_vg4y) [bug/likely] Cancelled booking still shows in the list after cancellation — matches no rule; needs a label
- fp_e9638a3d5b6b4bdd (run_20260927-130217_vg4y) [bug/needs_review] Profile form accepts an incomplete phone number — matches no rule; needs a label
- fp_8e5d8914cb66379e (run_20260927-130217_vg4y) [bug/likely] Profile updates (name and phone) don't save after reload — matches no rule; needs a label
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
- fp_5d1df82c859cac79 (run_20260927-130217_vg4y) [improvement/suggestion] Booking summary 'When' field never shows a value — matches no rule; needs a label
- fp_fcfdeb6d277ac726 (run_20260927-130217_vg4y) [improvement/suggestion] Date field has no format hint — matches no rule; needs a label
- fp_93ef4fb1e3cee74f (run_20260927-130217_vg4y) [improvement/suggestion] Login page gives no indication of why the user was redirected there — matches no rule; needs a label
- fp_110f442c2ba140c4 (run_20260927-130217_vg4y) [improvement/suggestion] Price unit inconsistency across services list — matches no rule; needs a label
- fp_6a8aae906f8d1072 (run_20260927-131110_waqv) [bug/needs_review] Hidden text on services page tries to trick automated testers — matches no rule; needs a label
- fp_8c961abfcbec67da (run_20260927-131110_waqv) [bug/likely] Cancelling a booking says it worked but the booking stays in the list — matches no rule; needs a label
- fp_755e1d5164900d54 (run_20260927-131110_waqv) [bug/needs_review] Profile form accepts a too-short phone number — matches no rule; needs a label
- fp_164ec372b85c1608 (run_20260927-131110_waqv) [bug/likely] Profile name change not persisting: Changed "Full name" from "Alex Demo" to "Jordan Smith", clicked Save, rel… — matches no rule; needs a label
- fp_316a32c2cba4ab42 (run_20260927-131110_waqv) [bug/needs_review] Profile page accepts a phone number that contains letters — matches no rule; needs a label
- fp_0b5018fbe735f602 (run_20260927-131110_waqv) [bug/confirmed] Saved name change on profile page is lost after reloading — matches no rule; needs a label
- fp_8c2541616859d4fd (run_20260927-131110_waqv) [improvement/suggestion] Inconsistent service list formatting between Quote and Book forms — matches no rule; needs a label
- fp_61b812e374329e33 (run_20260927-131110_waqv) [improvement/suggestion] Sold-out service still listed without clear next step on quote page — matches no rule; needs a label
- fp_20404a92a3d47f6e (run_20260927-131110_waqv) [improvement/suggestion] Suspicious embedded instruction text on page could mislead automated checks — matches no rule; needs a label
- fp_cd9227181d688f8a (run_20260927-131858_a21a) [bug/needs_review] Contact form does not confirm submission after clicking Send — matches no rule; needs a label
- fp_85e5cfb28a3ccd5c (run_20260927-131858_a21a) [improvement/suggestion] Inconsistent service pricing labels between Quote and Book pages — matches no rule; needs a label
- fp_7b1e727ade68f10a (run_20260927-131858_a21a) [improvement/suggestion] Quote page mentions GST but doesn't show it until calculation, with no example — matches no rule; needs a label
- fp_2ea3c4d580491a45 (run_20260927-131858_a21a) [bug/confirmed] Failed check: Cancelling a booking removes only that booking, leaving other bookings visible — matches no rule; needs a label
- fp_6b42bd7cd3ba2655 (run_20260927-131858_a21a) [bug/confirmed] Booking HC-1001 was not removed from the list after cancellation. The status message shows "Booking HC-1001 c… — matches no rule; needs a label
- fp_3aa7507552778b32 (run_20260927-133005_qn8k) [bug/needs_review] Profile form accepts a phone number containing letters and an extension — matches no rule; needs a label
- fp_ec3facead619473a (run_20260927-133005_qn8k) [bug/needs_review] Sending a message through the contact form doesn't confirm it was sent — matches no rule; needs a label
- fp_5feb33a82b0e8a81 (run_20260927-133005_qn8k) [improvement/suggestion] Quote page has no way to proceed to booking — matches no rule; needs a label
