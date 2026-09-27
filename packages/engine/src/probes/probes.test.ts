// The automatic probes (D46) on a fixture site: DET-SORT flags only the option whose order is wrong, the
// sweep finds the one disclosure that crashes (and never clicks a submit button or a link), the reflected
// input probe finds unescaped search and address-parameter input (and not escaped input), and every
// finding replays through the normal replayer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SafetyPolicy } from "../browser/policy";
import { SecretVault } from "../browser/vault";
import { crawl } from "../crawl/crawler";
import { StateRegistry } from "../explore/states";
import type { Step } from "../types";
import { replayTargets } from "../verify/replay";
import { createHarness, DESKTOP, MOBILE, type Harness } from "../../test/harness";
import { page, startFixtureServer, type FixtureServer } from "../../test/fixture-server";
import { runProbes, type ProbeResult } from "./index";
import { sortControls, sortOrder } from "./sort";

let h: Harness;
let site: FixtureServer;
let probes: ProbeResult;
let policy: SafetyPolicy;

const LIST = `
<label for="sort">Sort by</label>
<select id="sort">
  <option value="rec">Recommended</option>
  <option value="pa">Price: low to high</option>
  <option value="pd">Price: high to low</option>
  <option value="na">Name A–Z</option>
</select>
<ul id="items"></ul>
<script>
  const items = [["Oven", 100], ["Carpet", 8], ["Deck", 45], ["Window", 20]];
  const draw = (list) => { document.getElementById("items").innerHTML = list.map(([n, p]) => "<li><h3>" + n + "</h3><p>$" + p + " each</p></li>").join(""); };
  draw(items);
  document.getElementById("sort").addEventListener("change", (e) => {
    const v = e.target.value, l = [...items];
    if (v === "pa") l.sort((a, b) => ("$" + a[1] < "$" + b[1] ? -1 : 1)); // the bug: text sort
    if (v === "pd") l.sort((a, b) => b[1] - a[1]);
    if (v === "na") l.sort((a, b) => a[0].localeCompare(b[0]));
    draw(l);
  });
</script>`;

const FAQ = `
<form method="post" action="/subscribe"><button>Subscribe</button></form>
<a href="/list" aria-expanded="false">A link that must not be swept</a>
${["Hours", "Prices", "Supplies"]
  .map(
    (q, i) =>
      `<h3><button type="button" aria-expanded="false" data-i="${i}">${q}</button></h3><div hidden>Answer ${i}</div>`,
  )
  .join("")}
<script>
  document.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.i === "2") { const d = undefined; d.links.push(1); }
    b.setAttribute("aria-expanded", "true"); b.parentElement.nextElementSibling.hidden = false;
  }));
</script>`;

beforeAll(async () => {
  h = await createHarness();
  site = await startFixtureServer({
    "/": {
      body: page(
        `<a href="/list">List</a> <a href="/faq">FAQ</a> <a href="/search">Search</a> <a href="/echo?term=hello">Echo</a> <a href="/safe?term=hello">Safe</a>`,
        { title: "Home" },
      ),
    },
    "/list": { body: page(LIST, { title: "List" }) },
    "/faq": { body: page(FAQ, { title: "FAQ" }) },
    "POST /subscribe": { body: page("<p>Subscribed</p>") },
    "/search": (req) => {
      const q = new URL(req.url ?? "/", "http://x").searchParams.get("q") ?? "";
      return {
        body: page(
          `<form role="search" action="/search"><label for="q">Search books</label><input id="q" name="q" type="search"><button>Search</button></form>${q ? `<h2>Results for ${q}</h2>` : ""}`,
          { title: "Search" },
        ),
      };
    },
    "/echo": (req) => {
      const t = new URL(req.url ?? "/", "http://x").searchParams.get("term") ?? "";
      return { body: page(`<p>You asked for ${t}</p>`, { title: "Echo" }) };
    },
    "/safe": (req) => {
      const t = new URL(req.url ?? "/", "http://x").searchParams.get("term") ?? "";
      const esc = t
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      return { body: page(`<p>You asked for ${esc}</p>`, { title: "Safe" }) };
    },
  });
  policy = new SafetyPolicy({ origin: site.origin, mode: "staging" });
  const crawled = await crawl({
    browser: h.browser,
    policy,
    evidence: h.writer,
    sink: () => {},
    startUrl: site.url("/"),
    viewport: DESKTOP,
    mobileViewport: MOBILE,
    pageBudget: 15,
    deadline: Date.now() + 60_000,
  });
  probes = await runProbes({
    browser: h.browser,
    policy,
    evidence: h.writer,
    store: h.store,
    runId: h.runId,
    vault: new SecretVault(),
    sink: () => {},
    mode: "staging",
    viewport: DESKTOP,
    mobileViewport: MOBILE,
    states: new StateRegistry(crawled.states),
    crawl: {
      states: crawled.states,
      snapshots: crawled.snapshots,
      linkUrls: crawled.links.map((l) => l.url),
    },
    deadline: Date.now() + 90_000,
  });
}, 180_000);
afterAll(async () => {
  await site.close();
  await h.close();
});

describe("sort option labels", () => {
  it.each([
    ["Price: low to high", { read: "number", direction: "asc" }],
    ["Price (high to low)", { read: "number", direction: "desc" }],
    ["Name (A to Z)", { read: "text", direction: "asc" }],
    ["Name Z–A", { read: "text", direction: "desc" }],
    ["Recommended", undefined],
    ["Newest", undefined],
  ])("%s", (label, want) => {
    const got = sortOrder(label);
    expect(got ? { read: got.read, direction: got.direction } : undefined).toEqual(want);
  });
  it("finds a sort dropdown in a snapshot, named or not", () => {
    const named = `- combobox "Sort by" [ref=e1]:\n  - option "Recommended" [selected]\n  - 'option "Price: low to high"'`;
    expect(sortControls(named)).toEqual([
      { name: "Sort by", options: ["Recommended", "Price: low to high"] },
    ]);
    const unnamed = `- combobox [ref=e2]:\n  - option "Name (A to Z)" [selected]\n  - option "Price (low to high)"`;
    expect(sortControls(unnamed)).toHaveLength(1);
    expect(sortControls(`- combobox "Country" [ref=e3]:\n  - option "Chile"`)).toEqual([]);
  });
});

describe("runProbes on a fixture site", () => {
  it("DET-SORT flags only the option that sorts wrongly", () => {
    const sort = probes.candidates.filter(
      (c) => c.source.kind === "detector" && c.source.id === "DET-SORT",
    );
    expect(
      sort.map((c) => c.signature.kind === "detector" && c.signature.key.split("|")[2]),
    ).toEqual(["Price: low to high"]);
    expect(sort[0]!.grounding).toMatchObject({
      kind: "ui_text",
      verified: true,
      quote: "Price: low to high",
    });
    expect(sort[0]!.check?.type).toBe("ordered");
    expect(probes.metrics["probe.sort.optionsChecked"]).toBe(3);
  });

  it("the sweep finds the crashing disclosure, and never clicks a submit button or a link", () => {
    const crash = probes.candidates.filter(
      (c) => c.source.kind === "detector" && c.source.id === "DET-PAGEERROR",
    );
    expect(crash).toHaveLength(1);
    expect(crash[0]!.stepIds).toHaveLength(2);
    expect(site.requests).not.toContain("POST /subscribe");
    const sweep = probes.journeys.find((j) => j.title.startsWith("Interaction sweep"))!;
    const clicked = (sweep.steps ?? [])
      .filter((s) => s.action.type === "click")
      .map((s) => s.description);
    expect(clicked.some((d) => /Supplies/.test(d))).toBe(true);
    expect(clicked.some((d) => /link|Subscribe/i.test(d))).toBe(false);
  });

  it("the reflected-input probe finds unescaped search and address input, not escaped input", () => {
    const xss = probes.candidates.filter(
      (c) => c.source.kind === "detector" && c.source.id === "DET-XSS",
    );
    const where = xss.map((c) => c.detail.title).sort();
    expect(where).toEqual([
      'Text typed into the "Search books" search box is inserted into the page as HTML (XSS risk)',
      'The "term" address parameter is inserted into the page as HTML (XSS risk)',
    ]);
    expect(xss.every((c) => c.route !== "/safe")).toBe(true);
    expect(xss.every((c) => c.check?.type === "notPresent")).toBe(true);
  });

  it("every probe finding replays through the normal replayer", async () => {
    const steps = new Map<string, Step>();
    for (const j of probes.journeys) for (const s of j.steps ?? []) steps.set(s.id, s);
    const results = await replayTargets(
      probes.candidates.map((c) => ({ key: c.id, candidate: c, priority: 0 })),
      {
        browser: h.browser,
        policy,
        evidence: h.writer,
        store: h.store,
        runId: h.runId,
        vault: new SecretVault(),
        sink: () => {},
        mode: "staging",
        viewport: DESKTOP,
        mobileViewport: MOBILE,
        states: new StateRegistry(),
        steps,
        deadline: Date.now() + 90_000,
      },
    );
    for (const c of probes.candidates)
      expect(results.get(c.id), c.detail.title).toMatchObject({ attempts: 2, reproduced: 2 });
  }, 120_000);
});
