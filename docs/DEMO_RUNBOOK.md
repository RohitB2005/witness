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

- [ ] Full rehearsal on the presentation laptop, on battery, from a cold start: `pnpm demo:check`, `pnpm demo:up`, Demo-budget scan of the bench, walk the report, run one exported test red → fix → green. Time it.
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
3. Open tabs:
   - **Witness New scan from the link `demo:up` prints:** `http://localhost:4317/?demo=1`. It fills everything: app address `http://localhost:5180`, Staging, budget Demo, the test account from .env (`WITNESS_TEST_USER`; the password field reads "Demo account (from .env)"), and the requirements from `bench/SCOPE.md` ("Loaded SCOPE.md"). Nothing to type; on stage, click **Start scan**.
     - On the plain New scan page, click **Fill in demo settings** at the top; it does the same.
     - The server holds the password (DEVLOG D93). It's never in the link, the browser or the run's files. Only `demo:up` offers this; `pnpm dev` doesn't.
     - If the password field asks for a password, .env lacks `WITNESS_TEST_USER` or `WITNESS_TEST_PASSWORD` (`demo:up` prints a warning saying so).
   - The SauceDemo report; the Evaluation page.
4. Terminal open in the repo root (`pnpm demo:test` paths are relative to it). During the demo, the B02 card's *Copy test command* button puts `pnpm demo:test runs/<run id>/tests/<file>.spec.ts` on the clipboard; rehearse the paste once with the last rehearsal's card.

## 5. Script (fits the 10-minute talk)

| When | Action | Say |
| --- | --- | --- |
| 0:00 | Before the first slide, click **Scan** | "Before I start, I'm pointing Witness at this booking app. It'll test while I talk." |
| ~3:30 | Switch to the live view | Point to the plan (journeys and grounded expectations), the action log, a candidate being verified, one Discarded item with its reason |
| ~4:00 | Report | Read the verdict line aloud |
| ~4:15 | Open the "Price: low to high" card (B02) | "Sorting by lowest price puts the $8 service last, after $75." Show screenshot, steps, expected vs actual, and that the promise is the sort option's own label |
| ~4:45 | *Copy test command* → terminal → paste and run (red) → `pnpm bench:fix B02` → run again (green) | "Every confirmed bug becomes a test that stays red until it's fixed." |
| ~5:15 | Improvements tab | Accessibility, a slow API, one labelled UX suggestion |
| after talk | `pnpm bench:break B02`; `pnpm bench:reset` | — |

**Preset: Demo** (Rohit, 30 Sep; DEVLOG D88): 2 journeys, a hard 5-minute cap. Measured with `SCOPE.md` (CLI): **3:57**, recall C+L 65% (the same as the Standard median). Standard took 4:58–7:56 over the P5 runs. **Demo bug: B02** (price sort), Confirmed in every buggy run in P5 and in the P4 gate. B01 (GST) is a good second card when it's there, but it was found in only 2 of 3 Standard runs and missed by the Demo run.

**Target:** the demo scan finishes within 5 minutes. The cap is hard: the scan always ends with a report, which lists what the cap cut. The UI's 10-second plan review counts against it. If it's still running at ~4:30, talk through the architecture slide and come back.

## 6. Fallback decision tree

| Symptom | Do this | Say |
| --- | --- | --- |
| LLM calls slow or failing, internet fine | Let it finish: Witness degrades to deterministic findings and says so. Or cancel and `pnpm demo:replay <runId>` | "The model provider is slow, so I'll replay this morning's run from cache — same code path, cached AI responses." |
| No internet | Phone hotspot; if that fails, `pnpm demo:replay <runId>` (fully offline) | "No network here, so this is a replay of a real run using cached AI responses." |
| Dashboard or server crash | Restart with `pnpm demo:up`; open the saved HTML report meanwhile | — |
| Laptop fails | Play the screen recording from your phone or a borrowed machine; hand the HTML report around | "Here's a recording of the same run." |
| Someone asks for a live run on a URL they give you | Only on a site you have permission to test; use **Production (read-only)** mode and the Quick budget | "Read-only mode blocks every request that sends data, to this site or any other service, at the network layer, except logging in. The report lists what it blocked." |

## 7. Q&A live options

- **Quick scan of SauceDemo** (~2 min) for "was the bench built to flatter the tool?"
- Open `runs/<id>/llm-calls.ndjson` in the debug panel for "how much did that cost?"
- Toggle the C01 canary and show the Confirmed set doesn't change, if asked about prompt injection (only if time allows; otherwise quote the E4 result).
