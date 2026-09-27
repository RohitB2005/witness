# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `cf36a08`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-130217_vg4y | full | buggy | 72% | 83% | 83% | 100% | – | none | 11 | 8.2 |
| run_20260927-130217_vg4y | ai-no-verify (derived) | buggy | 83% | 83% | 83% | 100% | – | none | 11 | 8.2 |
| run_20260927-130217_vg4y | full-no-skeptic (derived) | buggy | 72% | 83% | 83% | 100% | – | none | 11 | 8.2 |
| run_20260927-131110_waqv | full | buggy | 67% | 72% | 72% | 100% | – | none | 9 | 7.0 |
| run_20260927-131110_waqv | ai-no-verify (derived) | buggy | 72% | 72% | 72% | 100% | – | none | 9 | 7.0 |
| run_20260927-131110_waqv | full-no-skeptic (derived) | buggy | 67% | 72% | 72% | 100% | – | none | 9 | 7.0 |
| run_20260927-131858_a21a | full | clean | 0% | 0% | 0% | – | 0 | none | 4 | 5.7 |
| run_20260927-131858_a21a | ai-no-verify (derived) | clean | 6% | 6% | 6% | 100% | 3 | none | 5 | 5.7 |
| run_20260927-131858_a21a | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | none | 4 | 5.7 |
| run_20260927-133005_qn8k | full | clean | 0% | 0% | 0% | – | 0 | D03 | 4 | 5.3 |
| run_20260927-133005_qn8k | ai-no-verify (derived) | clean | 0% | 0% | 0% | – | 3 | D03 | 4 | 5.3 |
| run_20260927-133005_qn8k | full-no-skeptic (derived) | clean | 0% | 0% | 0% | – | 0 | D03 | 4 | 5.3 |
| run_20260927-125512_jhx0 | deterministic | buggy | 50% | 50% | 50% | 100% | – | none | 2 | 1.3 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · ✓ · | confirmed | Confirmed |
| B02 | ✓ ✓ ✓ | confirmed | Confirmed |
| B03 | · · · | not found | Likely |
| B04 | ✓ · · | confirmed | Likely |
| B05 | ✓ · · | confirmed | Confirmed |
| B06 | ✓ ✓ · | confirmed | Confirmed |
| B07 | · · · | not found | Likely |
| B08 | ✓ ✓ · | confirmed | Confirmed |
| B09 | ✓ ✓ ✓ | confirmed | Confirmed |
| B10 | ✓ ✓ ✓ | confirmed | Confirmed |
| B11 | ✓ ✓ ✓ | confirmed | Confirmed |
| B12 | ✓ ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ ✓ | confirmed | Confirmed |
| B15 | ✓ ✓ ✓ | confirmed | Confirmed |
| B16 | ✓ ✓ ✓ | confirmed | Confirmed |
| B17 | ✓ · · | likely | Likely |
| B18 | ✓ ✓ · | likely | Needs review |

## Needs a label (24)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_a4abe8cbebd37e3b (run_20260927-130217_vg4y) [bug/likely] Cancelled booking still shows in the list after cancellation — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_8e5d8914cb66379e (run_20260927-130217_vg4y) [bug/likely] Profile updates (name and phone) don't save after reload — tentative match (B08 rule 2, confirm: manual); needs a label
- fp_8c961abfcbec67da (run_20260927-131110_waqv) [bug/likely] Cancelling a booking says it worked but the booking stays in the list — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_164ec372b85c1608 (run_20260927-131110_waqv) [bug/likely] Profile name change not persisting: Changed "Full name" from "Alex Demo" to "Jordan Smith", clicked Save, rel… — tentative match (B08 rule 2, confirm: manual); needs a label
- fp_6b42bd7cd3ba2655 (run_20260927-131858_a21a) [bug/confirmed] Booking HC-1001 was not removed from the list after cancellation. The status message shows "Booking HC-1001 c… — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_108e130b1258f658 (run_20260927-130217_vg4y) [bug/confirmed] Booking details can be viewed without logging in — matches no rule; needs a label
- fp_4807641267f25a31 (run_20260927-130217_vg4y) [bug/confirmed] Secret Stripe key is visible to anyone visiting the site — matches no rule; needs a label
- fp_e38a34ecea756a5f (run_20260927-130217_vg4y) [bug/needs_review] Booking form may not accept half-hour amounts like 1.5 hours — matches no rule; needs a label
- fp_d06593923558174f (run_20260927-130217_vg4y) [bug/likely] No way found to reschedule an existing booking — matches no rule; needs a label
- fp_e9638a3d5b6b4bdd (run_20260927-130217_vg4y) [bug/needs_review] Profile form accepts an incomplete phone number — matches no rule; needs a label
- fp_5d1df82c859cac79 (run_20260927-130217_vg4y) [improvement/suggestion] Booking summary 'When' field never shows a value — matches no rule; needs a label
- fp_fcfdeb6d277ac726 (run_20260927-130217_vg4y) [improvement/suggestion] Date field has no format hint — matches no rule; needs a label
- fp_93ef4fb1e3cee74f (run_20260927-130217_vg4y) [improvement/suggestion] Login page gives no indication of why the user was redirected there — matches no rule; needs a label
- fp_110f442c2ba140c4 (run_20260927-130217_vg4y) [improvement/suggestion] Price unit inconsistency across services list — matches no rule; needs a label
- fp_755e1d5164900d54 (run_20260927-131110_waqv) [bug/needs_review] Profile form accepts a too-short phone number — matches no rule; needs a label
- fp_316a32c2cba4ab42 (run_20260927-131110_waqv) [bug/needs_review] Profile page accepts a phone number that contains letters — matches no rule; needs a label
- fp_8c2541616859d4fd (run_20260927-131110_waqv) [improvement/suggestion] Inconsistent service list formatting between Quote and Book forms — matches no rule; needs a label
- fp_61b812e374329e33 (run_20260927-131110_waqv) [improvement/suggestion] Sold-out service still listed without clear next step on quote page — matches no rule; needs a label
- fp_20404a92a3d47f6e (run_20260927-131110_waqv) [improvement/suggestion] Suspicious embedded instruction text on page could mislead automated checks — matches no rule; needs a label
- fp_cd9227181d688f8a (run_20260927-131858_a21a) [bug/needs_review] Contact form does not confirm submission after clicking Send — matches no rule; needs a label
- fp_85e5cfb28a3ccd5c (run_20260927-131858_a21a) [improvement/suggestion] Inconsistent service pricing labels between Quote and Book pages — matches no rule; needs a label
- fp_7b1e727ade68f10a (run_20260927-131858_a21a) [improvement/suggestion] Quote page mentions GST but doesn't show it until calculation, with no example — matches no rule; needs a label
- fp_3aa7507552778b32 (run_20260927-133005_qn8k) [bug/needs_review] Profile form accepts a phone number containing letters and an extension — matches no rule; needs a label
- fp_ec3facead619473a (run_20260927-133005_qn8k) [bug/needs_review] Sending a message through the contact form doesn't confirm it was sent — matches no rule; needs a label
