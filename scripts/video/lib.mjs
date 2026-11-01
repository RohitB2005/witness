// Shared helpers for the demo-video recorder (scripts/video/record.mjs): a 1080p browser, a frame
// recorder on Playwright's page.screencast, a drawn cursor and smooth pointer/scroll moves.
//
// Why a drawn cursor: headless Chromium shows none, and screencast.showActions() also prints the
// action's selector as a title, which can't be turned off. Why CSS zoom: screencast frames are
// captured at CSS-pixel size (deviceScaleFactor is ignored), so the page is laid out at the size it
// will appear in the video and zoomed to make the dashboard readable.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = path.join(REPO_ROOT, "video-out");
export const RAW_DIR = path.join(OUT_DIR, "raw");
export const W = 1920;
export const H = 1080;
/** Where app and terminal recordings sit in the frame: a window with a 40 px title bar, captions below. */
export const WIN = { x: 120, y: 70, w: 1680, h: 870, bar: 40 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function launch() {
  return chromium.launch();
}

/**
 * A dark-theme page, window-sized by default (`full` for 1920×1080 cards). `zoom` enlarges the app;
 * `cursor` draws a pointer that follows the mouse.
 */
export async function newPage(
  browser,
  { zoom = 1, cursor = true, clipboardOrigin, full = false } = {},
) {
  const viewport = full ? { width: W, height: H } : { width: WIN.w, height: WIN.h };
  const ctx = await browser.newContext({ viewport, colorScheme: "dark" });
  if (clipboardOrigin)
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: clipboardOrigin });
  await ctx.addInitScript(pageSetup, { zoom, cursor });
  const page = await ctx.newPage();
  page.mouseAt = { x: viewport.width * 0.62, y: viewport.height * 0.55 };
  return page;
}

// Runs in the page before its own scripts.
function pageSetup({ zoom, cursor }) {
  const apply = () => {
    if (zoom !== 1) document.documentElement.style.zoom = String(zoom);
    if (!cursor || document.getElementById("__vcursor")) return;
    const c = document.createElement("div");
    c.id = "__vcursor";
    c.innerHTML =
      '<svg width="26" height="32" viewBox="0 0 26 32"><path d="M2 2 L2 26 L8.5 20 L13 30 L17 28 L12.5 18.5 L21 18.5 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>' +
      '<span id="__vripple"></span>';
    const s = document.createElement("style");
    s.textContent = `#__vcursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
      transform:translate(-200px,-200px);will-change:transform;zoom:${1 / zoom}}
      #__vcursor svg{position:absolute;left:-2px;top:-2px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      #__vripple{position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;
      background:rgba(13,148,136,.35);transform:scale(0);opacity:0}
      #__vripple.on{animation:__vr .45s ease-out}
      @keyframes __vr{0%{transform:scale(.2);opacity:1}100%{transform:scale(1.4);opacity:0}}`;
    document.documentElement.append(s, c);
    const r = c.querySelector("#__vripple");
    addEventListener(
      "mousemove",
      (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`),
      true,
    );
    addEventListener(
      "mousedown",
      () => {
        r.classList.remove("on");
        void r.offsetWidth;
        r.classList.add("on");
      },
      true,
    );
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
}

/** Records the page's screencast frames (JPEG) with their timestamps; `mark()` notes moments for the edit. */
export async function startRecording(page, name) {
  const dir = path.join(RAW_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "frames"), { recursive: true });
  const frames = [];
  const marks = {};
  const writes = [];
  let i = 0;
  let minGap = 0;
  let lastT = -Infinity;
  await page.screencast.start({
    size: page.viewportSize(),
    quality: 92,
    onFrame: ({ data, timestamp }) => {
      if (timestamp - lastT < minGap) return;
      lastT = timestamp;
      const file = `f${String(i++).padStart(6, "0")}.jpg`;
      frames.push({ file, t: timestamp });
      writes.push(writeFile(path.join(dir, "frames", file), data));
    },
  });
  marks.start = Date.now();
  // Paint one frame now, so a static page still has a first frame.
  await page.evaluate(() => document.body && (document.body.style.outline = "0 solid transparent"));
  return {
    dir,
    mark(key) {
      marks[key] = Date.now();
    },
    /** Keeps at most `fps` frames a second from now on (for parts that will be sped up). */
    throttle(fps) {
      minGap = fps ? 1000 / fps : 0;
    },
    async stop(extra = {}) {
      marks.end = Date.now();
      await page.screencast.stop();
      await Promise.all(writes);
      writeFileSync(
        path.join(dir, "frames.json"),
        JSON.stringify({ frames, marks, ...extra }, null, 1),
      );
      return { frames: frames.length, seconds: (marks.end - marks.start) / 1000 };
    },
  };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Shows or hides the drawn cursor. */
export async function showCursor(page, visible) {
  await page.evaluate((v) => {
    const c = document.getElementById("__vcursor");
    if (c) c.style.display = v ? "" : "none";
  }, visible);
}

/** Changes the page zoom (see newPage). */
export async function setZoom(page, zoom) {
  await page.evaluate((z) => {
    document.documentElement.style.zoom = String(z);
    const c = document.getElementById("__vcursor");
    if (c) c.style.zoom = String(1 / z);
  }, zoom);
}

/**
 * A camera move: scales the page by `scale` so the element's centre drifts towards the middle of
 * the view (`anchorLeft` keeps the left edge in place, for left-aligned text), or back with scale 1.
 * Done in the browser, so text stays sharp.
 */
export async function camera(page, locator, { scale = 1, ms = 900, anchorLeft = false } = {}) {
  const handle = locator ? await locator.elementHandle() : null;
  await page.evaluate(
    async ({ el, s, ms, anchorLeft }) => {
      const b = document.body;
      b.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
      if (s !== 1 && el) {
        const z = Number(document.documentElement.style.zoom || 1);
        const r = el.getBoundingClientRect();
        const W = window.innerWidth;
        const H = window.innerHeight;
        const clamp = (v, max) => Math.min(Math.max(v, 0), max);
        const fx = anchorLeft ? 0 : clamp((s * (r.left + r.width / 2) - W / 2) / (s - 1), W);
        const fy = clamp((s * (r.top + r.height / 2) - H / 2) / (s - 1), H);
        b.style.transformOrigin = `${fx / z}px ${(fy + window.scrollY) / z}px`;
      }
      b.style.transform = s === 1 ? "none" : `scale(${s})`;
      await new Promise((r) => setTimeout(r, ms));
    },
    { el: handle, s: scale, ms, anchorLeft },
  );
}

/** Glides the mouse (and the drawn cursor) to a point. */
export async function moveTo(page, x, y, ms = 650) {
  const from = page.mouseAt;
  const steps = Math.max(10, Math.round(ms / 16));
  for (let s = 1; s <= steps; s++) {
    const k = ease(s / steps);
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
    await sleep(ms / steps);
  }
  page.mouseAt = { x, y };
}

/** Glides to the element's centre and clicks it. */
export async function click(page, locator, { ms = 650, pause = 180, after = 250 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error(`Not visible: ${locator}`);
  await moveTo(page, b.x + b.width / 2, b.y + b.height / 2, ms);
  await sleep(pause);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(after);
}

/** Smoothly scrolls the window so the element's top sits `offset` px below the top of the view.
 * (Under CSS zoom, getBoundingClientRect and scrollY are both in viewport pixels.) */
export async function scrollToElement(page, locator, { offset = 24, ms = 900 } = {}) {
  const handle = await locator.elementHandle();
  await page.evaluate(
    async ({ el, offset, ms }) => {
      const from = window.scrollY;
      const to = Math.max(0, from + el.getBoundingClientRect().top - offset);
      const t0 = performance.now();
      const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      await new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, from + (to - from) * e(k));
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    { el: handle, offset, ms },
  );
}

/** Smoothly scrolls the window by `dy` viewport pixels. */
export async function scrollBy(page, dy, ms = 900) {
  await page.evaluate(
    async ({ dy, ms }) => {
      const from = window.scrollY;
      const to = Math.max(0, from + dy);
      const t0 = performance.now();
      const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      await new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, from + (to - from) * e(k));
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    { dy, ms },
  );
}
