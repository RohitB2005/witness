// pnpm video:record <segment> [flags]: drives the Witness dashboard (from `pnpm demo:up`) with
// Playwright and records each segment of the demo video as screencast frames in video-out/raw/.
// pnpm video:build turns them into the MP4.
//
//   scan [--offline] [--no-start]   New scan → Start scan → live view until the verdict (one real scan;
//                                   --offline replays cached AI answers, for rehearsals; the live view
//                                   says so, so never use it for the final take)
//   report   --run <id> [--finding <fd_id>]   the report, the bug's card, "Copy test command"
//   terminal --run <id> [--finding <fd_id>]   runs the exported test (fails), pnpm bench:fix, runs it again
//   cards    [--replay]                       title, results and end cards
//   shot     --run <id> [--finding <fd_id>]   a 2× still of the report with the bug open (portfolio)
//
// The bench is the demo target; nothing here is used by Witness itself.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  OUT_DIR,
  RAW_DIR,
  REPO_ROOT,
  click,
  launch,
  moveTo,
  newPage,
  scrollToElement,
  setZoom,
  showCursor,
  sleep,
  startRecording,
} from "./lib.mjs";
import { endCard, resultsCard, terminalPage, titleCard } from "./templates.mjs";

if (existsSync(path.join(REPO_ROOT, ".env"))) process.loadEnvFile(path.join(REPO_ROOT, ".env"));
const WITNESS = `http://localhost:${process.env.WITNESS_PORT ?? 4317}`;
const BENCH = `http://localhost:${process.env.BENCH_PORT ?? 5180}`;
const BUG = "B02";

const { positionals, values: opt } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: "string" },
    finding: { type: "string" },
    offline: { type: "boolean", default: false },
    "no-start": { type: "boolean", default: false },
    replay: { type: "boolean", default: false },
  },
});
const segment = positionals[0];

/** The demo bug's finding in a run: the Confirmed "price sort" bug, unless --finding names one. */
function findingOf(runId) {
  const file = path.join(REPO_ROOT, "runs", runId, "report.json");
  if (!existsSync(file)) throw new Error(`No report for ${runId} in runs/.`);
  const report = JSON.parse(readFileSync(file, "utf8"));
  const f = opt.finding
    ? report.findings.find((x) => x.id === opt.finding)
    : report.findings.find(
        (x) =>
          x.kind === "bug" &&
          x.tier === "confirmed" &&
          /sort/i.test(x.title) &&
          /price/i.test(x.title),
      );
  if (!f) throw new Error(`No Confirmed price-sort bug in ${runId}; pass --finding <fd_id>.`);
  if (!f.testFile) throw new Error(`${f.id} has no exported test.`);
  return f;
}

function needRun() {
  if (!opt.run) throw new Error("Pass --run <run id>.");
  return opt.run;
}

/** Runs a command; streams its output to `onData`. Resolves with the exit code. */
function runStreaming(cmd, args, onData, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: "1", ...env },
      shell: process.platform === "win32",
    });
    child.stdout.on("data", (d) => onData(d.toString()));
    child.stderr.on("data", (d) => onData(d.toString()));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function bench(command, id) {
  const code = await runStreaming("node", ["scripts/bench-control.mjs", command, id], () => {});
  if (code !== 0)
    throw new Error(`bench ${command} ${id} failed. Is the bench running (pnpm demo:up)?`);
}

// ---------------------------------------------------------------------------------------------------

async function recordScan(browser) {
  const page = await newPage(browser, { zoom: 1.7 });
  await page.goto(WITNESS + "/");
  await page.getByRole("heading", { name: "Test a web app" }).waitFor();
  await sleep(500);
  const rec = await startRecording(page, "scan");
  await sleep(700);

  await click(page, page.getByRole("button", { name: "Fill in demo settings" }));
  await sleep(500);
  const url = page.getByLabel("App address");
  await click(page, url, { ms: 500 });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(BENCH, { delay: 55 });
  await sleep(400);

  // "Paste" the scope: the demo settings already loaded SCOPE.md; clear it and paste it back in view.
  const req = page.locator("#req");
  const scope = await req.inputValue();
  await scrollToElement(page, page.getByText("Test account (optional)"), { offset: 20, ms: 800 });
  await click(page, req, { ms: 500 });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await sleep(350);
  await req.fill(scope);
  await sleep(700);

  if (opt.offline) {
    await page.getByText("Offline fallback").click();
    await page.getByRole("checkbox", { name: /Replay cached AI answers/ }).check();
  }
  const start = page.getByRole("button", { name: "Start scan" });
  await scrollToElement(page, page.getByText("How thorough"), { offset: 20, ms: 900 });
  await sleep(500);
  if (opt["no-start"]) {
    await moveTo(page, ...(await center(start)));
    await sleep(800);
    console.log(await rec.stop());
    return;
  }
  await click(page, start, { after: 0 });
  rec.mark("started");
  await page.waitForURL(/\/runs\/run_[^/]+\/live/, { timeout: 15_000 });
  const runId = page.url().match(/(run_[^/]+)\/live/)[1];
  console.log(`Scan started: ${runId} — recording until the verdict (up to 9 minutes).`);
  await sleep(1500); // the edit cuts here, then plays the scan sped up
  await showCursor(page, false);
  await setZoom(page, 1.3); // smaller, so the plan and the activity panels fit
  rec.throttle(8);
  rec.mark("live");
  const report = page.getByRole("button", { name: "Open the full report" });
  // Once the plan is approved, scroll down to the "Now" line so the plan and the agent's actions show.
  const plan = page.getByRole("heading", { name: /^The plan:/ });
  await Promise.race([
    report.waitFor({ timeout: 9 * 60_000 }),
    plan.waitFor({ timeout: 9 * 60_000 }),
  ]);
  if (!(await report.isVisible())) {
    await page
      .getByText(/Starting automatically/)
      .waitFor({ state: "hidden", timeout: 30_000 })
      .catch(() => {});
    await scrollToElement(page, page.locator("p[aria-live=polite]"), { offset: 14, ms: 1400 });
  }
  await report.waitFor({ timeout: 9 * 60_000 });
  rec.throttle(0);
  rec.mark("verdict");
  await sleep(3000);
  console.log(await rec.stop({ runId, offline: opt.offline }));
  console.log(`Run: ${runId}`);
}

async function center(locator) {
  const b = await locator.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}

async function recordReport(browser) {
  const runId = needRun();
  const f = findingOf(runId);
  const page = await newPage(browser, { zoom: 1.5, clipboardOrigin: WITNESS });
  await page.goto(`${WITNESS}/runs/${runId}`);
  await page.getByRole("heading", { name: /^Report:/ }).waitFor();
  await sleep(800);
  const rec = await startRecording(page, "report");
  await sleep(2400); // verdict banner

  await scrollToElement(page, page.getByRole("tablist", { name: "Findings" }), {
    offset: 120,
    ms: 1000,
  });
  const card = page.locator(`article#${f.id}`);
  await sleep(300);
  await scrollToElement(page, card, { offset: 240, ms: 900 });
  await sleep(400);
  await click(page, card.locator("button[aria-expanded]"), { ms: 700 });
  rec.mark("open");
  await sleep(500);
  await scrollToElement(page, card, { offset: 30, ms: 900 });
  await sleep(3800); // severity, tier, where, why, expected vs actual

  await scrollToElement(page, card.getByRole("heading", { name: "Steps to reproduce" }), {
    offset: 30,
    ms: 1000,
  });
  await sleep(2600);
  const shot = card.locator("img");
  if (await shot.count()) {
    await scrollToElement(page, shot, { offset: 60, ms: 900 });
    await sleep(2200);
  }
  const copy = card.getByRole("button", { name: "Copy test command" });
  await scrollToElement(page, copy, { offset: 700, ms: 800 });
  await click(page, copy, { ms: 700 });
  rec.mark("copied");
  await sleep(1500);
  console.log(await rec.stop({ runId, finding: f.id }));
}

async function recordTerminal(browser) {
  const runId = needRun();
  const f = findingOf(runId);
  const spec = `runs/${runId}/tests/${f.testFile}`;
  await bench("break", BUG); // start from the bug being present
  const page = await newPage(browser, { cursor: false });
  await page.setContent(terminalPage());
  const write = (() => {
    let q = Promise.resolve();
    // demo-test.mjs's own verdict line, in bold red or green (the output is otherwise as printed).
    const verdict = (c) =>
      c
        .replace(/^FAILED:/m, "\x1b[1;31mFAILED:\x1b[0m")
        .replace(/^PASSED:/m, "\x1b[1;32mPASSED:\x1b[0m");
    return (s) => (q = q.then(() => page.evaluate((c) => window.term.write(c), verdict(s))));
  })();
  const prompt = () => page.evaluate(() => window.term.prompt());
  const type = (s, ms = 22) => page.evaluate(([s, ms]) => window.term.type(s, ms), [s, ms]);
  const enter = () => page.evaluate(() => window.term.newline());
  const command = async (cmdline, args, how = "type") => {
    if (how === "paste") await page.evaluate((s) => window.term.paste(s), cmdline);
    else await type(cmdline);
    await sleep(350);
    await enter();
    const code = await runStreaming("pnpm", args, write);
    await write("");
    return code;
  };

  const rec = await startRecording(page, "terminal");
  await prompt();
  await sleep(700);
  const failCode = await command(`pnpm demo:test ${spec}`, ["demo:test", spec], "paste");
  rec.mark("failed");
  await sleep(1200);
  // Scroll back to the assertion's message (the prices in the order shown), then down again.
  await page.evaluate(() => window.term.reveal("order: \\d", 900));
  await sleep(3200);
  await page.evaluate(() => window.term.reveal(null, 700));
  await sleep(500);
  await prompt();
  await sleep(400);
  await command(`pnpm bench:fix ${BUG}`, ["bench:fix", BUG]);
  rec.mark("fixed");
  await sleep(900);
  await prompt();
  await sleep(300);
  const passCode = await command(`pnpm demo:test ${spec}`, ["demo:test", spec], "paste");
  rec.mark("passed");
  await sleep(2600);
  console.log(await rec.stop({ runId, finding: f.id, failCode, passCode }));
  await bench("break", BUG); // leave the bench as demo:up started it
  if (failCode === 0 || passCode !== 0)
    console.warn(
      `Unexpected: first run exited ${failCode} (want ≠0), second ${passCode} (want 0).`,
    );
}

function evalRows() {
  const file = path.join(REPO_ROOT, "eval", "results", "p5", "scored", "combined", "summary.json");
  const { pipelines } = JSON.parse(readFileSync(file, "utf8"));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const row = (key, name, sub, highlight = false) => {
    const p = pipelines[key];
    return {
      name,
      sub,
      highlight,
      recall: mean(p.recall.confirmedLikely),
      falseAlarms: sum(p.cleanFalsePositives),
      runs: p.recall.confirmedLikely.length,
      cleanRuns: p.cleanFalsePositives.length,
    };
  };
  return [
    row("deterministic", "Plain code", "Fixed checks, no AI"),
    row("ai-no-verify (derived)", "Unchecked AI", "Every AI claim taken at face value"),
    row("full", "Witness", "AI proposes, code verifies", true),
  ];
}

async function recordCards(browser) {
  const page = await newPage(browser, { cursor: false });
  const rows = evalRows();
  const [plain, ai, witness] = rows;
  const footnote =
    `Harbour Clean benchmark app, ${23} seeded bugs. Seeded bugs found = reported as Confirmed or Likely, ` +
    `mean of ${witness.runs} runs with bugs on (plain code: ${plain.runs} run). False alarms = bugs reported ` +
    `on the bug-free build, total over ${witness.cleanRuns} runs (plain code: ${plain.cleanRuns} run).`;
  const cards = {
    title: [
      titleCard({
        subtitle: opt.replay
          ? "A replay of a recorded scan (AI answers from cache) · Harbour Clean, a test app with seeded bugs"
          : "Recorded from a live scan · Harbour Clean, a test app with seeded bugs",
      }),
      3200,
    ],
    results: [
      resultsCard({
        headline:
          ai.recall > witness.recall
            ? "Nearly as many bugs found as unchecked AI,"
            : "As many bugs found as unchecked AI,",
        accent:
          witness.falseAlarms === 0
            ? "and no false alarms."
            : `and ${witness.falseAlarms} false alarms.`,
        rows,
        footnote,
      }),
      10_500,
    ],
    end: [
      endCard({
        name: "Rohit Balaji",
        links: ["rohit-balaji-portfolio.vercel.app", "github.com/RohitB2005"],
      }),
      4800,
    ],
  };
  for (const [name, [html, ms]] of Object.entries(cards)) {
    await page.setContent("<html style='background:#121211'></html>");
    const rec = await startRecording(page, `card-${name}`);
    await page.setContent(html);
    await sleep(ms);
    console.log(name, await rec.stop({ replay: opt.replay }));
  }
  console.log(
    rows
      .map((r) => `${r.name}: ${Math.round(r.recall * 100)}%, ${r.falseAlarms} false alarms`)
      .join("; "),
  );
}

async function shot(browser) {
  const runId = needRun();
  const f = findingOf(runId);
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  await page.goto(`${WITNESS}/runs/${runId}`);
  const card = page.locator(`article#${f.id}`);
  await card.locator("button[aria-expanded]").click();
  await card
    .locator("img")
    .waitFor()
    .catch(() => {});
  await page.waitForLoadState("networkidle");
  await card.evaluate((el) =>
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24),
  );
  await sleep(400);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "report-bug.png");
  await page.screenshot({ path: file });
  console.log(`Saved ${file} (3200×2000) — ${f.title}`);
}

const segments = {
  scan: recordScan,
  report: recordReport,
  terminal: recordTerminal,
  cards: recordCards,
  shot,
};
if (!segments[segment]) {
  console.error(
    `Usage: pnpm video:record <${Object.keys(segments).join("|")}> [flags]  (see the header of this file)`,
  );
  process.exit(1);
}
mkdirSync(RAW_DIR, { recursive: true });
const browser = await launch();
try {
  await segments[segment](browser);
} finally {
  await browser.close();
}
