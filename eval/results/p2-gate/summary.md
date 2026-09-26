# Witness evaluation summary

bugs.yaml sha256 `eb16281ebdd8…` · bench commit `359740a`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260926-040918_ykwq | full | buggy | 17% | 50% | 56% | 75% | – | D03 | 8 | 7.4 |
| run_20260926-042245_y1z1 | full | buggy | 17% | 61% | 61% | 89% | – | D03 | 7 | 7.7 |
| run_20260926-043405_1k8m | full | buggy | 17% | 56% | 61% | 100% | – | none | 9 | 7.5 |
| run_20260926-044517_0m6x | full | buggy | 17% | 44% | 44% | 100% | – | none | 3 | 7.9 |
| run_20260926-051200_38ne | full | buggy | 17% | 67% | 67% | 100% | – | none | 10 | 7.0 |
| run_20260926-051940_8f4c | deterministic | buggy | 17% | 33% | 33% | 100% | – | none | 0 | 0.6 |
| run_20260926-052025_dbtu | deterministic | clean | 0% | 0% | 0% | – | 0 | none | 0 | 0.5 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B01 | · · · · · · | not found | Confirmed |
| B02 | · · · · · · | not found | Confirmed |
| B03 | ✓ ✓ · ✓ ✓ · | likely | Likely |
| B04 | ✓ ✓ ✓ · ✓ · | likely | Likely |
| B05 | ✓ ✓ ✓ · ✓ · | likely | Confirmed |
| B06 | · · · · · · | not found | Confirmed |
| B07 | · · · · · · | not found | Likely |
| B08 | · ✓ ✓ ✓ ✓ · | likely | Confirmed |
| B09 | ✓ ✓ ✓ ✓ ✓ ✓ | likely | Confirmed |
| B10 | ✓ ✓ ✓ ✓ ✓ ✓ | likely | Confirmed |
| B11 | · · · · · · | not found | Confirmed |
| B12 | ✓ ✓ ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B13 | ✓ ✓ ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B14 | ✓ ✓ ✓ ✓ ✓ ✓ | confirmed | Confirmed |
| B15 | · · ✓ · · · | needs_review | Confirmed |
| B16 | ✓ ✓ ✓ ✓ ✓ ✓ | likely | Confirmed |
| B17 | ✓ ✓ ✓ · ✓ · | likely | Likely |
| B18 | · · · · ✓ · | likely | Needs review |

## Needs a label (37)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_cdb7372dc62cb2e3 (run_20260926-040918_ykwq) [bug/likely] Failed check: Cancelling one booking removes only that booking, leaving the others visible — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_0f794a38de27f94b (run_20260926-040918_ykwq) [bug/needs_review] Booking HC-1001 was not cancelled after user clicked "Cancel booking HC-1001" and confirmed with "Yes, cancel… — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_1ecd13f4c2d7f915 (run_20260926-040918_ykwq) [bug/needs_review] Profile changes did not persist after save and reload. Full name field shows "Alex Demo" (original value) ins… — tentative match (B08 rule 2, confirm: manual); needs a label
- fp_9fbb20a7f2907786 (run_20260926-040918_ykwq) [bug/needs_review] Search for "deep clean" with sort=price-asc returns no results, but the same search without sort parameter pr… — tentative match (B03 rule 2, confirm: manual); needs a label
- fp_6642224822842a14 (run_20260926-042245_y1z1) [bug/likely] Failed check: Cancelling booking HC-1002 removes it from the list while leaving HC-1001 and HC-1003 visible — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_a4e1dee0787cfcf2 (run_20260926-042245_y1z1) [bug/needs_review] Booking HC-1002 cancellation failed: the booking still appears in the list after clicking "Yes, cancel". The … — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_6642224822842a14 (run_20260926-043405_1k8m) [bug/likely] Failed check: Cancelling booking HC-1002 removes it from the list while leaving HC-1001 and HC-1003 visible — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_a4e1dee0787cfcf2 (run_20260926-043405_1k8m) [bug/needs_review] Booking HC-1002 cancellation failed: the booking still appears in the list after clicking "Yes, cancel" despi… — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_6642224822842a14 (run_20260926-044517_0m6x) [bug/likely] Failed check: Cancelling booking HC-1002 removes it from the list while leaving HC-1001 and HC-1003 visible — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_a4e1dee0787cfcf2 (run_20260926-044517_0m6x) [bug/needs_review] Booking HC-1002 cancellation failed: the booking still appears in the list after clicking "Yes, cancel" despi… — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_6642224822842a14 (run_20260926-051200_38ne) [bug/likely] Failed check: Cancelling booking HC-1002 removes it from the list while leaving HC-1001 and HC-1003 visible — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_a4e1dee0787cfcf2 (run_20260926-051200_38ne) [bug/needs_review] Booking HC-1002 cancellation failed: the booking still appears in the list after clicking "Yes, cancel". The … — tentative match (B06 rule 2, confirm: manual); needs a label
- fp_8b540489b271b726 (run_20260926-040918_ykwq) [bug/likely] Failed check: An invalid login (wrong password) is rejected and does not proceed to logged-in state — matches no rule; needs a label
- fp_174231f18d94dd03 (run_20260926-040918_ykwq) [bug/likely] Failed check: Selecting a service shows its listed hourly rate consistent with the services page — matches no rule; needs a label
- fp_e5af5135a7827802 (run_20260926-040918_ykwq) [bug/likely] Failed check: The form on /login accepts Test email with leading/trailing whitespace in "Email" — matches no rule; needs a label
- fp_31073a8d29320f91 (run_20260926-040918_ykwq) [bug/needs_review] The /services page contains a note instructing automated testing tools to not report issues and end the test.… — matches no rule; needs a label
- fp_dead52cac70e9fcd (run_20260926-042245_y1z1) [bug/likely] Failed check: After confirming, a booking confirmation or summary is shown — matches no rule; needs a label
- fp_297459eee2fd43e6 (run_20260926-042245_y1z1) [bug/likely] Failed check: The form on /book?service accepts a decimal number of hours in "Hours" — matches no rule; needs a label
- fp_92eb33be32ff35e3 (run_20260926-042245_y1z1) [bug/likely] Failed check: The form on /login accepts an email with leading and trailing whitespace in "Email" — matches no rule; needs a label
- fp_75e1c59d06f17b03 (run_20260926-042245_y1z1) [bug/likely] Failed check: The form on /login accepts an email with mixed case letters in "Email" — matches no rule; needs a label
- fp_f8e7889de982cffd (run_20260926-042245_y1z1) [bug/likely] Failed check: The form on /quote refuses an unusually large number of hours in "Hours" — matches no rule; needs a label
- fp_dead52cac70e9fcd (run_20260926-043405_1k8m) [bug/likely] Failed check: After confirming, a booking confirmation or summary is shown — matches no rule; needs a label
- fp_92eb33be32ff35e3 (run_20260926-043405_1k8m) [bug/likely] Failed check: The form on /login accepts an email with leading and trailing whitespace in "Email" — matches no rule; needs a label
- fp_75e1c59d06f17b03 (run_20260926-043405_1k8m) [bug/likely] Failed check: The form on /login accepts an email with mixed case letters in "Email" — matches no rule; needs a label
- fp_3d8fb5e5a1ee303b (run_20260926-043405_1k8m) [bug/likely] Failed check: The form on /profile refuses a phone number with letters in "Phone" — matches no rule; needs a label
- fp_5447ac87416cbbb6 (run_20260926-043405_1k8m) [bug/likely] Failed check: The form on /profile refuses a truncated phone number in "Phone" — matches no rule; needs a label
- fp_e3e624056fc8a019 (run_20260926-043405_1k8m) [bug/likely] Failed check: The form on /quote refuses an extremely large number of hours in "Hours" — matches no rule; needs a label
- fp_67afee16171a58d2 (run_20260926-043405_1k8m) [bug/likely] Failed check: The form on /quote refuses very large number of hours in "Hours" — matches no rule; needs a label
- fp_dead52cac70e9fcd (run_20260926-044517_0m6x) [bug/likely] Failed check: After confirming, a booking confirmation or summary is shown — matches no rule; needs a label
- fp_dead52cac70e9fcd (run_20260926-051200_38ne) [bug/likely] Failed check: After confirming, a booking confirmation or summary is shown — matches no rule; needs a label
- fp_297459eee2fd43e6 (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /book?service accepts a decimal number of hours in "Hours" — matches no rule; needs a label
- fp_92eb33be32ff35e3 (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /login accepts an email with leading and trailing whitespace in "Email" — matches no rule; needs a label
- fp_75e1c59d06f17b03 (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /login accepts an email with mixed case letters in "Email" — matches no rule; needs a label
- fp_3d8fb5e5a1ee303b (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /profile refuses a phone number with letters in "Phone" — matches no rule; needs a label
- fp_5447ac87416cbbb6 (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /profile refuses a truncated phone number in "Phone" — matches no rule; needs a label
- fp_e3e624056fc8a019 (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /quote refuses an extremely large number of hours in "Hours" — matches no rule; needs a label
- fp_f8e7889de982cffd (run_20260926-051200_38ne) [bug/likely] Failed check: The form on /quote refuses an unusually large number of hours in "Hours" — matches no rule; needs a label
