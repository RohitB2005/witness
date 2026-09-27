# Witness evaluation summary

bugs-v2.yaml sha256 `8e942da5ced6…` · bench commit `678d40b`

| Run | Pipeline | Build | Recall C | Recall C+L | Recall all | Bug precision C+L | Clean-build FPs | Decoys | Unlabelled | Min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_20260927-220027_dpi0 | full | buggy | 60% | 80% | 80% | 100% | – | none | 24 | 7.9 |
| run_20260927-220027_dpi0 | ai-no-verify (derived) | buggy | 80% | 80% | 80% | 100% | – | none | 24 | 7.9 |
| run_20260927-220027_dpi0 | full-no-skeptic (derived) | buggy | 60% | 80% | 80% | 100% | – | none | 24 | 7.9 |

## Per seeded bug (buggy runs)

| Bug | Found in runs | Best tier | Expected tier |
| --- | --- | --- | --- |
| B19 | ✓ | confirmed | Confirmed |
| B20 | · | not found | Confirmed |
| B21 | ✓ | confirmed | Confirmed |
| B22 | ✓ | confirmed | Confirmed |
| B23 | ✓ | likely | Likely |

## Needs a label (24)

Add `"<fingerprint>": { "label": "tp:Bxx" | "tp_unseeded" | "fp", "reason": "<one line>" }` to eval/labels.json.

- fp_c35559a5aa03b124 (run_20260927-220027_dpi0) [bug/confirmed] Booking form accepts dates in the past — matches no rule; needs a label
- fp_987039207f2338d9 (run_20260927-220027_dpi0) [bug/confirmed] Booking form fails when name has an apostrophe — matches no rule; needs a label
- fp_ae14784f6329e477 (run_20260927-220027_dpi0) [bug/likely] Double-clicking the booking button can create two bookings — matches no rule; needs a label
- fp_7a9e519852b09720 (run_20260927-220027_dpi0) [bug/confirmed] Quote page shows a total that doesn't match its own subtotal and GST — matches no rule; needs a label
- fp_51b6a21aac964b56 (run_20260927-220027_dpi0) [bug/likely] Quote total doesn't match subtotal plus tax — matches no rule; needs a label
- fp_ef9b7ce5c2298b11 (run_20260927-220027_dpi0) [bug/likely] Quote total doesn't match subtotal plus tax (repeat case) — matches no rule; needs a label
- fp_402826ae5f6a4b43 (run_20260927-220027_dpi0) [bug/needs_review] Booking form accepts a date that has already passed — matches no rule; needs a label
- fp_c560f7c11131d309 (run_20260927-220027_dpi0) [bug/needs_review] Booking form accepts today's date though bookings should be for a future day — matches no rule; needs a label
- fp_b3f5826353bd1a23 (run_20260927-220027_dpi0) [bug/confirmed] Search box on the services page is vulnerable to malicious code injection — matches no rule; needs a label
- fp_a6591c8294d071db (run_20260927-220027_dpi0) [bug/confirmed] Sorting by price low to high does not put prices in the correct order — matches no rule; needs a label
- fp_67b897a090f8b356 (run_20260927-220027_dpi0) [bug/confirmed] The page's JavaScript crashed: TypeError: Cannot read properties of undefined (reading 'links') — matches no rule; needs a label
- fp_3170f5d615216ca1 (run_20260927-220027_dpi0) [bug/likely] Booking HC-1002 cancellation failed: the "Cancel booking HC-1002" button is still visible after clicking "Yes… — matches no rule; needs a label
- fp_34880870c1fce961 (run_20260927-220027_dpi0) [bug/confirmed] Failed check: Cancelling booking HC-1002 removes it while other bookings remain — matches no rule; needs a label
- fp_e5d10df6fb28b74f (run_20260927-220027_dpi0) [bug/needs_review] Failed check: The form on /profile refuses a phone number with letters and punctuation in "Phone" — matches no rule; needs a label
- fp_488691c37ddf19fc (run_20260927-220027_dpi0) [bug/confirmed] Failed check: Updated phone number persists after reload — matches no rule; needs a label
- fp_7b76efbe19cde62c (run_20260927-220027_dpi0) [bug/confirmed] Image doesn't load: "Carpet shampoo" — matches no rule; needs a label
- fp_66408ac5789781e6 (run_20260927-220027_dpi0) [bug/likely] Login errors reveal whether an account exists — matches no rule; needs a label
- fp_0fa71620b9c525c3 (run_20260927-220027_dpi0) [bug/confirmed] Page scrolls sideways on a phone (605 px content in a 375 px screen) — matches no rule; needs a label
- fp_d2cffea3ad040b42 (run_20260927-220027_dpi0) [bug/confirmed] Link "Terms" goes to a missing page (/terms-and-conditions → 404) — matches no rule; needs a label
- fp_47bcc5a3238b3d5f (run_20260927-220027_dpi0) [improvement/evidence_based] Accessibility: Buttons must have discernible text — matches no rule; needs a label
- fp_4b42d1f0cab26db3 (run_20260927-220027_dpi0) [improvement/evidence_based] Accessibility: Elements must meet minimum color contrast ratio thresholds — matches no rule; needs a label
- fp_88181b5b01b2e3b0 (run_20260927-220027_dpi0) [improvement/evidence_based] Accessibility: Form elements must have labels — matches no rule; needs a label
- fp_f90827b9e3ff44a9 (run_20260927-220027_dpi0) [improvement/suggestion] 'Sold out' text easy to mistake for a description — matches no rule; needs a label
- fp_fcb2c9f64fd53c70 (run_20260927-220027_dpi0) [improvement/evidence_based] Slow API call: GET /api/bookings took 3.5 s — matches no rule; needs a label
