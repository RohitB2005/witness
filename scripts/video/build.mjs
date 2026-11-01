// pnpm video:build [--music <audio file> | --no-music]: edits the segments recorded by
// `pnpm video:record` (video-out/raw/) into video-out/witness-demo.mp4 (1920×1080, 30 fps, H.264,
// AAC). Needs ffmpeg on the PATH.
//
// Each recorded segment is a folder of screencast JPEGs with timestamps and named marks. A clip is
// a time window of one segment, optionally sped up; app and terminal clips are composited into a
// window on a backdrop; captions (transparent PNGs rendered by Chromium) slide in under it. Clips
// are joined with crossfades. The music is the original ambient bed from music.mjs unless --music
// names a track; either way it is faded and kept quiet.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { H, OUT_DIR, RAW_DIR, W, WIN, launch } from "./lib.mjs";
import { writeAmbient, writeImpulse } from "./music.mjs";
import { captionOverlay, titleBarChip, windowFrame, windowMask } from "./templates.mjs";

const { values: opt } = parseArgs({
  options: { music: { type: "string" }, "no-music": { type: "boolean", default: false } },
});

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
 * `overlays`: [{ png, start, end, slide }] in clip seconds (end may be negative: from the clip's
 * end; captions slide up as they fade in unless `slide: false`); `frame`: { bg, mask } composites the
 * (window-sized) recording into the window on the backdrop.
 */
function clip(name, parts, overlays = [], frame) {
  const inputs = [];
  const filters = [];
  const [w, h] = frame ? [WIN.w, WIN.h] : [W, H];
  parts.forEach((p, i) => {
    const list = path.join(BUILD, `${name}-${i}.ffconcat`);
    concatList(p.seg, at(p.seg, p.from), at(p.seg, p.to), list);
    inputs.push("-f", "concat", "-safe", "0", "-i", list);
    filters.push(
      `[${i}:v]setpts=(PTS-STARTPTS)/${p.speed ?? 1},fps=${FPS},scale=${w}:${h}:flags=lanczos:in_range=pc:out_range=tv:out_color_matrix=bt709,setsar=1,format=yuv420p[p${i}]`,
    );
  });
  let next = parts.length;
  const partLen = parts.map((p) => (at(p.seg, p.to) - at(p.seg, p.from)) / 1000 / (p.speed ?? 1));
  const total = partLen.reduce((s, x) => s + x, 0);
  filters.push(
    parts.length > 1
      ? `${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=1[base]`
      : `[p0]copy[base]`,
  );
  let cur = "base";
  if (frame) {
    const [bg, mask] = [next++, next++];
    inputs.push("-loop", "1", "-framerate", String(FPS), "-i", frame.bg);
    inputs.push("-loop", "1", "-framerate", String(FPS), "-i", frame.mask);
    filters.push(
      `[base]pad=${W}:${H}:${WIN.x}:${WIN.y}:color=black[padded]`,
      `[${mask}:v]format=gray[mask]`,
      `[padded][mask]alphamerge[win]`,
      `[${bg}:v]format=yuv420p[bg]`,
      `[bg][win]overlay=0:0:shortest=1:format=auto[framed]`,
    );
    cur = "framed";
  }
  overlays.forEach((o, j) => {
    const idx = next++;
    inputs.push("-loop", "1", "-framerate", String(FPS), "-i", o.png);
    const start = o.start ?? 0;
    const end = o.end === undefined ? total : o.end < 0 ? total + o.end : o.end;
    const fin = start === 0 ? "" : `fade=t=in:st=${start.toFixed(2)}:d=0.4:alpha=1,`;
    const fout =
      end >= total - 0.01 ? "" : `fade=t=out:st=${(end - 0.35).toFixed(2)}:d=0.35:alpha=1,`;
    filters.push(`[${idx}:v]format=rgba,${fin}${fout}setpts=PTS-STARTPTS[o${j}]`);
    // Slide up 18 px with an ease-out as it fades in.
    const st = start.toFixed(2);
    const y =
      o.slide === false || start === 0
        ? "0"
        : `'if(lt(t,${st}),18,if(lt(t,${st}+0.55),18*pow(1-(t-${st})/0.55,3),0))'`;
    filters.push(`[${cur}][o${j}]overlay=x=0:y=${y}:eval=frame:shortest=1:format=auto[v${j}]`);
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

/** Joins clips: `join[i]` is how clip i+1 follows clip i ("fade" or "cut"). Adds `music` if given. */
function join(clips, joins, out, music) {
  const inputs = clips.flatMap((c) => ["-i", c.file]);
  if (music) inputs.push("-i", music);
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
    ...(music ? ["-map", `${clips.length}:a`, "-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
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

/** Renders full-frame PNGs from HTML (`transparent` keeps the background see-through). */
async function renderPngs(specs) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const files = {};
  for (const [key, [html, transparent]] of Object.entries(specs)) {
    await page.setContent(html);
    files[key] = path.join(BUILD, `${key}.png`);
    await page.screenshot({ path: files[key], omitBackground: transparent });
  }
  await browser.close();
  return files;
}

/** The music track, `seconds` long, faded and quiet: --music's file, else the generated ambient bed. */
function makeMusic(seconds) {
  if (opt["no-music"]) return undefined;
  const out = path.join(BUILD, "music.wav");
  const tail = `highpass=f=40,loudnorm=I=-21:TP=-3:LRA=9,aresample=48000,atrim=0:${seconds.toFixed(2)},afade=t=in:d=2,afade=t=out:st=${(seconds - 3.5).toFixed(2)}:d=3.5`;
  if (opt.music) {
    if (!existsSync(opt.music)) throw new Error(`No such music file: ${opt.music}`);
    ffmpeg(["-i", opt.music, "-af", tail, "-ac", "2", out]);
    return out;
  }
  const dry = path.join(BUILD, "music-dry.wav");
  const ir = path.join(BUILD, "music-ir.wav");
  writeAmbient(dry, seconds + 2);
  writeImpulse(ir);
  ffmpeg([
    "-i",
    dry,
    "-i",
    ir,
    "-filter_complex",
    `[0:a][1:a]afir=dry=1:wet=0.9,lowpass=f=7500,${tail}[a]`,
    "-map",
    "[a]",
    out,
  ]);
  return out;
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

const png = await renderPngs({
  "frame-app": [windowFrame({ title: "localhost:4317", url: true }), false],
  "frame-term": [windowFrame({ title: "witness — zsh" }), false],
  mask: [windowMask(), false],
  c1: [
    captionOverlay({
      step: "1",
      kicker: "Start a scan",
      text: "Witness tests a live web app like a QA tester would.",
    }),
    true,
  ],
  c2: [
    captionOverlay({
      step: "2",
      kicker: "Explore",
      text: "It maps the pages, plans user journeys, and an AI agent explores them.",
    }),
    true,
  ],
  chip: [titleBarChip({ text: `${mmss(scanMs)} scan · shown ${Math.round(speed)}× faster` }), true],
  c3: [
    captionOverlay({
      step: "3",
      kicker: "A confirmed bug",
      text: "Each confirmed bug comes with steps, expected vs actual and a screenshot.",
    }),
    true,
  ],
  c4a: [
    captionOverlay({
      step: "4",
      kicker: "The proof",
      text: "Every confirmed bug becomes a test. With the bug in place, it fails…",
    }),
    true,
  ],
  c4b: [
    captionOverlay({
      step: "4",
      kicker: "The proof",
      text: "…and once the bug is fixed, it passes.",
    }),
    true,
  ],
  c5: [captionOverlay({ step: "5", kicker: "Results", text: "AI proposes, code proves." }), true],
});
const app = { bg: png["frame-app"], mask: png.mask };
const term = { bg: png["frame-term"], mask: png.mask };
const fixedAt = (at(terminal, "fixed") - terminal.marks.start) / 1000;

console.log("Encoding clips…");
const clips = [
  clip("title", [{ seg: title, from: "start", to: "end" }]),
  clip("form", [{ seg: scan, from: "start", to: "live-200" }], [{ png: png.c1, start: 0.6 }], app),
  clip(
    "scan",
    [
      { seg: scan, from: "live", to: "verdict", speed },
      { seg: scan, from: "verdict", to: "verdict+2500" },
    ],
    [
      { png: png.c2, start: 0.5 },
      { png: png.chip, start: 0.5, end: SCAN_SECONDS, slide: false },
    ],
    app,
  ),
  clip("report", [{ seg: report, from: "start", to: "end" }], [{ png: png.c3, start: 0.8 }], app),
  clip(
    "terminal",
    [{ seg: terminal, from: "start", to: "end" }],
    [
      { png: png.c4a, start: 0.6, end: fixedAt - 0.4 },
      { png: png.c4b, start: fixedAt },
    ],
    term,
  ),
  clip("results", [{ seg: results, from: "start", to: "end" }], [{ png: png.c5, start: 2.2 }]),
  clip("end", [{ seg: end, from: "start", to: "end" }]),
];
const joins = ["fade", "fade", "fade", "fade", "fade", "fade"];
const length = clips.reduce((s, c) => s + c.d, 0) - FADE * joins.filter((j) => j === "fade").length;
const music = makeMusic(length);

const out = path.join(OUT_DIR, "witness-demo.mp4");
const total = join(clips, joins, out, music);
console.log(
  `\n${out}\n${total.toFixed(1)} s, scan sped up ${speed.toFixed(1)}×, music: ${opt["no-music"] ? "none" : (opt.music ?? "generated ambient bed")}`,
);
