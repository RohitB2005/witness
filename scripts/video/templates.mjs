// HTML for the demo video's cards, caption overlays and terminal page. Everything is rendered by
// Chromium (scripts/video/record.mjs and build.mjs), so the type is the system UI font and no
// image editor or ffmpeg text filter is needed.
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif`;
const MONO = `"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace`;

// Dark surface and text inks, and the dashboard's teal as the one accent.
const C = {
  bg: "#121211",
  surface: "#1a1a19",
  text: "#f0efec",
  text2: "#c3c2b7",
  muted: "#8f8e86",
  accent: "#2dd4bf",
  neutral: "#5f5d57",
};

const page = (
  body,
  css = "",
  bg = C.bg,
) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:${bg};color:${C.text};font-family:${FONT};-webkit-font-smoothing:antialiased}
.rise{opacity:0;transform:translateY(18px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes rise{to{opacity:1;transform:none}}
${css}</style></head><body>${body}</body></html>`;

export function titleCard({ subtitle }) {
  return page(
    `<main>
      <h1 class="rise"><span class="w">Witness</span><span class="dash"> — </span><span class="t">AI App Tester</span></h1>
      <p class="rise" style="animation-delay:.35s">${esc(subtitle)}</p>
    </main>`,
    `main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;
      background:radial-gradient(1200px 600px at 50% 45%,#1f2b2a 0%,${C.bg} 70%)}
     h1{font-size:112px;font-weight:750;letter-spacing:-2.5px}
     .dash,.t{color:${C.text2};font-weight:500}
     p{font-size:34px;color:${C.muted};letter-spacing:.2px}`,
  );
}

export function endCard({ name, links }) {
  return page(
    `<main>
      <h1 class="rise">${esc(name)}</h1>
      <ul>${links.map((l, i) => `<li class="rise" style="animation-delay:${0.3 + i * 0.15}s">${esc(l)}</li>`).join("")}</ul>
      <p class="rise" style="animation-delay:.8s">Witness · AI proposes, code proves.</p>
    </main>`,
    `main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;
      background:radial-gradient(1200px 600px at 50% 45%,#1f2b2a 0%,${C.bg} 70%)}
     h1{font-size:104px;font-weight:750;letter-spacing:-2px}
     ul{list-style:none;display:flex;flex-direction:column;align-items:center;gap:14px}
     li{font-size:40px;color:${C.text2};letter-spacing:.2px}
     p{margin-top:28px;font-size:28px;color:${C.muted}}`,
  );
}

/**
 * The evaluation result: one measure (recall) as bars, one hue, Witness highlighted; false alarms as a
 * separate text column, never a second axis. `rows`: { name, sub, recall (0–1), falseAlarms, highlight }.
 */
export function resultsCard({ headline, accent, rows, footnote }) {
  const barMax = 900;
  const body = rows
    .map((r, i) => {
      const w = Math.round(r.recall * barMax);
      const d = 0.5 + i * 0.25;
      return `<div class="row${r.highlight ? " hl" : ""} rise" style="animation-delay:${d - 0.3}s">
        <div class="name"><b>${esc(r.name)}</b><span>${esc(r.sub)}</span></div>
        <div class="track"><div class="bar" style="--w:${w}px;animation-delay:${d}s"></div>
          <div class="val" style="--w:${w}px;animation-delay:${d + 0.5}s">${Math.round(r.recall * 100)}%</div></div>
        <div class="fa" style="animation-delay:${d + 0.6}s">${r.falseAlarms}</div>
      </div>`;
    })
    .join("");
  return page(
    `<main>
      <h2 class="rise">${esc(headline)}<br><em>${esc(accent)}</em></h2>
      <div class="head rise" style="animation-delay:.2s"><span></span><span>Seeded bugs found</span><span>False alarms</span></div>
      ${body}
      <p class="foot rise" style="animation-delay:1.6s">${esc(footnote)}</p>
    </main>`,
    `main{height:100%;padding:96px 150px 0;display:flex;flex-direction:column;gap:22px;
      background:radial-gradient(1400px 700px at 50% 40%,#1c2423 0%,${C.bg} 70%)}
     h2{font-size:60px;font-weight:700;letter-spacing:-1px;margin-bottom:40px;line-height:1.18}
     h2 em{font-style:normal;color:${C.accent}}
     .head,.row{display:grid;grid-template-columns:430px 1fr 190px;align-items:center;column-gap:36px}
     .head{font-size:24px;color:${C.muted};text-transform:uppercase;letter-spacing:1.5px}
     .head span:last-child,.fa{text-align:right}
     .row{padding:26px 0;border-top:1px solid #2a2a28}
     .name b{display:block;font-size:38px;font-weight:650}
     .name span{display:block;font-size:24px;color:${C.muted};margin-top:6px}
     .hl .name span{color:${C.text2}}
     .track{position:relative;height:56px}
     .bar{position:absolute;left:0;top:10px;height:36px;width:0;border-radius:0 6px 6px 0;background:${C.neutral};
       animation:grow .9s cubic-bezier(.2,.7,.2,1) forwards}
     .hl .bar{background:${C.accent}}
     @keyframes grow{to{width:var(--w)}}
     .val{position:absolute;left:calc(var(--w) + 20px);top:4px;font-size:40px;font-weight:700;opacity:0;animation:fade .4s forwards}
     .fa{font-size:52px;font-weight:700;opacity:0;animation:fade .4s forwards;font-variant-numeric:tabular-nums}
     .hl .fa{color:${C.accent}}
     @keyframes fade{to{opacity:1}}
     .foot{margin-top:30px;font-size:23px;line-height:1.5;color:${C.muted};max-width:1500px}`,
  );
}

/** A full-frame transparent overlay: one caption pill near the bottom, optionally a badge top-right. */
export function captionOverlay({ text, badge }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:1920px;height:1080px;background:transparent;font-family:${FONT};-webkit-font-smoothing:antialiased}
.cap{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);max-width:1560px;width:max-content;
  padding:18px 34px;border-radius:16px;background:rgba(12,12,12,.74);color:#fff;font-size:42px;font-weight:600;
  line-height:1.25;text-align:center;letter-spacing:-.2px;box-shadow:0 6px 28px rgba(0,0,0,.25)}
.badge{position:absolute;right:44px;top:30px;padding:10px 20px;border-radius:999px;background:rgba(12,12,12,.74);
  color:#fff;font-size:28px;font-weight:600}
</style></head><body>
${text ? `<div class="cap">${esc(text)}</div>` : ""}
${badge ? `<div class="badge">${esc(badge)}</div>` : ""}
</body></html>`;
}

/** A terminal window. The recorder drives it through window.term (type, write, prompt). */
export function terminalPage({ title = "witness — zsh", cwd = "~/witness" } = {}) {
  return page(
    `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${esc(title)}</span></div>
      <pre id="out"></pre></div>
    <script>
    const out = document.getElementById("out");
    const PROMPT = ${JSON.stringify(cwd)};
    let span = null, style = {};
    const COLORS = {30:"#6b6b6b",31:"#ff6b6b",32:"#5be08a",33:"#f5c451",34:"#6aa8ff",35:"#e48af5",36:"#4fd6e0",37:"#e6e6e6",
      90:"#8a8a8a",91:"#ff8585",92:"#7cf0a2",93:"#ffd772",94:"#8fbfff",95:"#efa6ff",96:"#7de8ef",97:"#ffffff"};
    function css() { return (style.fg ? "color:" + style.fg + ";" : "") + (style.bold ? "font-weight:700;" : "") + (style.dim ? "opacity:.6;" : ""); }
    function newSpan() { span = document.createElement("span"); span.style.cssText = css(); out.appendChild(span); }
    function text(t) { if (!span) newSpan(); span.textContent += t; if (follow) out.scrollTop = 1e9; }
    let follow = true;
    function sgr(codes) {
      for (const c of codes.length ? codes : [0]) {
        if (c === 0) style = {}; else if (c === 1) style.bold = true; else if (c === 2) style.dim = true;
        else if (c === 22) { style.bold = false; style.dim = false; } else if (c === 39) style.fg = null;
        else if (COLORS[c]) style.fg = COLORS[c];
      }
      newSpan();
    }
    window.term = {
      write(chunk) {
        const re = /\\x1b\\[([0-9;?]*)([A-Za-z])/g; let last = 0, m;
        while ((m = re.exec(chunk))) {
          text(chunk.slice(last, m.index)); last = re.lastIndex;
          if (m[2] === "m") sgr(m[1].split(";").filter(Boolean).map(Number));
        }
        text(chunk.slice(last));
      },
      prompt() { style = {}; newSpan(); span.innerHTML = '<span style="color:#5be08a">' + PROMPT + '</span> <span style="color:#8a8a8a">%</span> '; newSpan(); },
      async type(s, ms) { for (const ch of s) { text(ch); await new Promise(r => setTimeout(r, ms)); } },
      paste(s) { text(s); },
      newline() { text("\\n"); },
      /** Smoothly scrolls so the first line matching \`pattern\` is near the top (or back to the bottom). */
      async reveal(pattern, ms) {
        follow = !pattern;
        const re = pattern ? new RegExp(pattern) : null;
        const el = re ? [...out.querySelectorAll("span")].find((s) => re.test(s.textContent)) : null;
        const from = out.scrollTop;
        const to = el ? Math.max(0, el.offsetTop - out.offsetTop - 30) : out.scrollHeight;
        const t0 = performance.now();
        await new Promise((done) => {
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
            out.scrollTop = from + (to - from) * e;
            k < 1 ? requestAnimationFrame(step) : done();
          };
          requestAnimationFrame(step);
        });
      },
    };
    </script>`,
    `body{background:linear-gradient(135deg,#1c2624,#121211)}
     .win{position:absolute;inset:56px 80px;border-radius:16px;background:#0d0d0c;box-shadow:0 30px 80px rgba(0,0,0,.5);
       border:1px solid #2b2b29;display:flex;flex-direction:column;overflow:hidden}
     .bar{height:52px;flex:none;display:flex;align-items:center;gap:10px;padding:0 20px;background:#1d1d1b;border-bottom:1px solid #2b2b29}
     .bar i{width:15px;height:15px;border-radius:50%;background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
     .bar span{flex:1;text-align:center;margin-right:70px;color:#a3a29b;font-size:20px}
     #out{flex:1;overflow:hidden;padding:26px 34px 120px;font:22px/1.45 ${MONO};color:#e6e6e6;white-space:pre-wrap;word-break:break-all}
     .win{overflow-y:hidden}`,
  );
}
