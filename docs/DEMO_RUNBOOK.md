# Witness — demo runbook

The live demo must work first time on the presentation laptop, with honest fallbacks if the network or the LLM provider misbehaves. Rule: **never present a cached or recorded run as live** — say which it is.

## 1. Scripts the repo must provide (Windows-safe, no bash-only syntax)

| Script | Does |
| --- | --- |
| `pnpm demo:up` | Builds and starts the bench (`BENCH_BUGS=all`, port 5180) and the Witness server + dashboard (port 4317), then prints both URLs |
| `pnpm bench:reset` | `POST /__bench/reset` (restores seed data) |
| `pnpm bench:fix B01` / `pnpm bench:break B01` | Toggle one bug flag at runtime (Node script, not curl — PowerShell aliases `curl`) |
| `pnpm demo:test <path-to-spec>` | Runs one exported Playwright test against the bench with `WITNESS_BASE_URL` set |
| `pnpm demo:replay <runId>` | Resets the bench's data, then re-runs a recorded scan with `--llm-cache replay` (works offline). Starts in the dashboard if Witness is running (labelled "AI answers replayed from cache"), else in the terminal. Needs a run recorded with the cache on (`rw`) after D86 |
| `pnpm demo:check [runId]` | Pre-flight: Node version, Playwright Chromium installed, API key present, provider reachable, **credit balance** (warns under $2), bench reachable, Witness server up and dashboard built, **"Not a bug" marks on the bench** (a rehearsal click would hide that bug in the demo), disk space, and how many of the rehearsal run's AI answers are in the cache |
| `pnpm dev` | Development: server (restarts on change) + dashboard with hot reload on :5317 |

## 2. The day before

- [ ] Full rehearsal on the presentation laptop, on battery, from a cold start: `pnpm demo:check`, `pnpm demo:up`, Standard scan of the bench, walk the report, run one exported test red → fix → green. Time it.
- [ ] Keep that rehearsal run's LLM cache (`.witness-cache/`) and note its run ID — this is the offline fallback.
- [ ] Screen-record one complete run (OBS or the OS recorder), about 6 minutes. Save the HTML report and the recording to the laptop **and** your phone.
- [ ] Run SauceDemo (`problem_user`) and save the report — shown in the evidence section, timestamped.
- [ ] Check LLM API credit; set the per-run cap.
- [ ] Test phone hotspot with the laptop.
- [ ] Turn Wi-Fi off and run `pnpm demo:replay <runId>` to prove the offline path works.

## 3. Morning of

- [ ] `git status` clean; on the tagged demo commit (`demo-v1`).
- [ ] Re-run SauceDemo once (sites change) and note the time.
- [ ] Notifications off; close other apps; display at 100–125% zoom; dashboard font readable from 3 m.
- [ ] Charge laptop and phone; pack the display adapter (HDMI/USB-C).

## 4. Ten minutes before

1. `pnpm demo:check <rehearsal run id>` → all green, and no "Not a bug" marks on the bench.
2. `pnpm demo:up`; `pnpm bench:reset`; confirm B01 is on (`GET /__bench/bugs`).
3. Open tabs: Witness *New scan* with the bench URL pre-filled (`http://localhost:5180`), mode Staging, test account filled, budget Standard; the SauceDemo report; the Evaluation page.
4. Terminal open in the repo root, command typed but not run: `pnpm demo:test <path printed by the last rehearsal>` (the new run's path will be similar; copy from the card's *Download test* button during the demo).

## 5. Script (fits the 10-minute talk)

| When | Action | Say |
| --- | --- | --- |
| 0:00 | Before the first slide, click **Scan** | "Before I start, I'm pointing Witness at this booking app. It'll test while I talk." |
| ~3:30 | Switch to the live view | Point to the plan (journeys and grounded expectations), the action log, a candidate being verified, one Discarded item with its reason |
| ~5:00 | Report | Read the verdict line aloud |
| ~5:15 | Open the GST card | "Customers are charged GST twice." Show screenshot, steps, expected vs actual, and the on-screen label it's grounded in |
| ~5:45 | *Download test* → terminal → `pnpm demo:test …` (red) → `pnpm bench:fix B01` → run again (green) | "Every confirmed bug becomes a test that stays red until it's fixed." |
| ~6:15 | Improvements tab | Accessibility, a slow API, one labelled UX suggestion |
| after talk | `pnpm bench:break B01`; `pnpm bench:reset` | — |

**Measured (P4 gate, 28 Sep):** a Standard scan with `SCOPE.md` from the UI took **7:56**. The 8-minute cap is hard: the scan always ends with a report, which lists what the cap cut. The demo preset is decided in P5.

**Target:** the demo scan finishes within 5 minutes on the presentation laptop. If rehearsals run longer, add a `demo` budget preset limited to core journeys rather than rushing the talk. If it's still running at ~5:00, talk through the architecture slide and come back; it's hard-capped at 8 minutes.

## 6. Fallback decision tree

| Symptom | Do this | Say |
| --- | --- | --- |
| LLM calls slow or failing, internet fine | Let it finish: Witness degrades to deterministic findings and says so. Or cancel and `pnpm demo:replay <runId>` | "The model provider is slow, so I'll replay this morning's run from cache — same code path, cached AI responses." |
| No internet | Phone hotspot; if that fails, `pnpm demo:replay <runId>` (fully offline) | "No network here, so this is a replay of a real run using cached AI responses." |
| Dashboard or server crash | Restart with `pnpm demo:up`; open the saved HTML report meanwhile | — |
| Laptop fails | Play the screen recording from your phone or a borrowed machine; hand the HTML report around | "Here's a recording of the same run." |
| Someone asks for a live run on a URL they give you | Only on a site you have permission to test; use **Production (read-only)** mode and the Quick budget | "Read-only mode blocks every write at the network layer, so this is safe on a live site." |

## 7. Q&A live options

- **Quick scan of SauceDemo** (~2 min) for "was the bench built to flatter the tool?"
- Open `runs/<id>/llm-calls.ndjson` in the debug panel for "how much did that cost?"
- Toggle the C01 canary and show the Confirmed set doesn't change, if asked about prompt injection (only if time allows; otherwise quote the E4 result).
