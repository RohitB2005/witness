// pnpm video:build: edits the segments recorded by `pnpm video:record` (video-out/raw/) into
// video-out/witness-demo.mp4 (1920×1080, 30 fps, H.264, no audio). Needs ffmpeg on the PATH.
//
// Each recorded segment is a folder of screencast JPEGs with timestamps and named marks. A clip is
// a time window of one segment, optionally sped up, with caption overlays (transparent PNGs rendered
// by Chromium) faded in and out. Clips are joined with crossfades or hard cuts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { H, OUT_DIR, RAW_DIR, W, launch } from "./lib.mjs";
import { captionOverlay } from "./templates.mjs";

const BUILD = path.join(OUT_DIR, "build");
const FPS = 30;
const FADE = 0.5; // crossfade between clips, seconds

function load(name) {
  const file = path.join(RAW_DIR, name, "frames.json");
  if (!existsSync(file)) throw new Error(`Missing ${name}: run pnpm video:record first (${file}).`);
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.frames.length === 0) throw new Error(`${name} recorded no frames.`);
  return { ...data, dir: path.join(RAW_DIR, name) };
}

/** Resolves "mark", "mark+1500" or "mark-800" (ms) against a segment's marks. */
function at(seg, spec) {
  const m = /^([a-z]+)([+-]\d+)?$/i.exec(spec);
  if (!m || seg.marks[m[1]] === undefined) throw new Error(`Unknown mark "${spec}" in ${seg.dir}`);
  return seg.marks[m[1]] + Number(m[2] ?? 0);
}

/** An ffconcat list showing the segment's frames from `a` to `b` (epoch ms), each for as long as it was on screen. */
function concatList(seg, a, b, file) {
  const fr = seg.frames;
  let i = fr.findLastIndex((f) => f.t <= a);
  if (i < 0) i = 0;
  const lines = ["ffconcat version 1.0"];
  let last;
  for (; i < fr.length && fr[i].t < b; i++) {
    const from = Math.max(fr[i].t, a);
    const to = Math.min(i + 1 < fr.length ? fr[i + 1].t : b, b);
    if (to <= from) continue;
    last = path.join(seg.dir, "frames", fr[i].file);
    lines.push(`file '${last}'`, `duration ${((to - from) / 1000).toFixed(4)}`);
  }
  if (!last) throw new Error(`No frames between the marks in ${seg.dir}`);
  lines.push(`file '${last}'`);
  writeFileSync(file, lines.join("\n") + "\n");
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });
}

function duration(file) {
  return Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ])
      .toString()
      .trim(),
  );
}

/**
 * Encodes one clip. `parts`: [{ seg, from, to, speed }] played back to back (hard cuts);
 * `overlays`: [{ png, start, end }] in clip seconds (end may be negative: from the clip's end).
 */
function clip(name, parts, overlays = []) {
  const inputs = [];
  const filters = [];
  parts.forEach((p, i) => {
    const list = path.join(BUILD, `${name}-${i}.ffconcat`);
    concatList(p.seg, at(p.seg, p.from), at(p.seg, p.to), list);
    inputs.push("-f", "concat", "-safe", "0", "-i", list);
    filters.push(
      `[${i}:v]setpts=(PTS-STARTPTS)/${p.speed ?? 1},fps=${FPS},scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv:out_color_matrix=bt709,setsar=1,format=yuv420p[p${i}]`,
    );
  });
  const partLen = parts.map((p) => (at(p.seg, p.to) - at(p.seg, p.from)) / 1000 / (p.speed ?? 1));
  const total = partLen.reduce((s, x) => s + x, 0);
  filters.push(
    parts.length > 1
      ? `${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=1[base]`
      : `[p0]copy[base]`,
  );
  let cur = "base";
  overlays.forEach((o, j) => {
    const idx = parts.length + j;
    inputs.push("-loop", "1", "-framerate", String(FPS), "-i", o.png);
    const start = o.start ?? 0;
    const end = o.end === undefined ? total : o.end < 0 ? total + o.end : o.end;
    const fin = start === 0 ? "" : `fade=t=in:st=${start.toFixed(2)}:d=0.35:alpha=1,`;
    const fout =
      end >= total - 0.01 ? "" : `fade=t=out:st=${(end - 0.35).toFixed(2)}:d=0.35:alpha=1,`;
    filters.push(`[${idx}:v]format=rgba,${fin}${fout}setpts=PTS-STARTPTS[o${j}]`);
    filters.push(`[${cur}][o${j}]overlay=0:0:shortest=1:format=auto[v${j}]`);
    cur = `v${j}`;
  });
  const out = path.join(BUILD, `${name}.mp4`);
  ffmpeg([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${cur}]`,
    "-t",
    total.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    out,
  ]);
  const d = duration(out);
  console.log(`  ${name}: ${d.toFixed(1)} s`);
  return { file: out, d };
}

/** Joins clips: `join[i]` is how clip i+1 follows clip i ("fade" or "cut"). */
function join(clips, joins, out) {
  const inputs = clips.flatMap((c) => ["-i", c.file]);
  const filters = [];
  let cur = "0:v";
  let total = clips[0].d;
  for (let i = 1; i < clips.length; i++) {
    const next = `${i}:v`;
    const label = `j${i}`;
    if (joins[i - 1] === "fade") {
      filters.push(
        `[${cur}][${next}]xfade=transition=fade:duration=${FADE}:offset=${(total - FADE).toFixed(3)}[${label}]`,
      );
      total += clips[i].d - FADE;
    } else {
      filters.push(`[${cur}][${next}]concat=n=2:v=1[${label}]`);
      total += clips[i].d;
    }
    cur = label;
  }
  filters.push(
    `[${cur}]fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.6).toFixed(3)}:d=0.6,format=yuv420p[out]`,
  );
  ffmpeg([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-movflags",
    "+faststart",
    out,
  ]);
  return total;
}

async function renderCaptions(specs) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const files = {};
  for (const [key, spec] of Object.entries(specs)) {
    await page.setContent(captionOverlay(spec));
    files[key] = path.join(BUILD, `cap-${key}.png`);
    await page.screenshot({ path: files[key], omitBackground: true });
  }
  await browser.close();
  return files;
}

function mmss(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

// ---------------------------------------------------------------------------------------------------

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });

const title = load("card-title");
const scan = load("scan");
const report = load("report");
const terminal = load("terminal");
const results = load("card-results");
const end = load("card-end");

if (scan.offline && !title.replay)
  throw new Error(
    "The scan was a replay (--offline) but the title card says live. Record the cards with --replay, or record a live scan.",
  );
if (report.runId !== scan.runId || terminal.runId !== scan.runId)
  console.warn(
    `Note: scan ${scan.runId}, report ${report.runId}, terminal ${terminal.runId}: segments come from different runs.`,
  );

const SCAN_SECONDS = 14; // the sped-up part of the scan
const scanMs = at(scan, "verdict") - at(scan, "live");
const speed = Math.max(1, scanMs / 1000 / SCAN_SECONDS);

const cap = await renderCaptions({
  c1: { text: "Witness tests a live web app like a QA tester would." },
  c2: { text: "It maps the pages, plans user journeys, and an AI agent explores them." },
  badge: { badge: `${mmss(scanMs)} scan · shown ${Math.round(speed)}× faster` },
  c3: { text: "Each confirmed bug comes with steps, expected vs actual and a screenshot." },
  c4a: { text: "Every confirmed bug becomes a test. With the bug in place, it fails…" },
  c4b: { text: "…and once the bug is fixed, it passes." },
  c5: { text: "AI proposes, code proves." },
});

console.log("Encoding clips…");
const clips = [
  clip("title", [{ seg: title, from: "start", to: "end" }]),
  clip("form", [{ seg: scan, from: "start", to: "live-200" }], [{ png: cap.c1, start: 0.6 }]),
  clip(
    "scan",
    [
      { seg: scan, from: "live", to: "verdict", speed },
      { seg: scan, from: "verdict", to: "verdict+2500" },
    ],
    [
      { png: cap.c2, start: 0.3 },
      { png: cap.badge, start: 0.3, end: SCAN_SECONDS },
    ],
  ),
  clip("report", [{ seg: report, from: "start", to: "end" }], [{ png: cap.c3, start: 0.8 }]),
  clip(
    "terminal",
    [{ seg: terminal, from: "start", to: "end" }],
    [
      {
        png: cap.c4a,
        start: 0.6,
        end: (at(terminal, "fixed") - terminal.marks.start) / 1000 - 0.6,
      },
      { png: cap.c4b, start: (at(terminal, "fixed") - terminal.marks.start) / 1000 },
    ],
  ),
  clip("results", [{ seg: results, from: "start", to: "end" }], [{ png: cap.c5, start: 2.2 }]),
  clip("end", [{ seg: end, from: "start", to: "end" }]),
];

const out = path.join(OUT_DIR, "witness-demo.mp4");
const total = join(clips, ["fade", "fade", "fade", "fade", "fade", "fade"], out);
console.log(`\n${out}\n${total.toFixed(1)} s, scan sped up ${speed.toFixed(1)}×`);
