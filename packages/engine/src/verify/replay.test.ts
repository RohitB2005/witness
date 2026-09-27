// Replay verification against a fixture site (SPEC FR-8): a real bug reproduces 2/2, a fixed one 0/2, a
// flaky one takes the third attempt (D49), a logged-in path logs in first (D37), a static finding re-runs
// once, a server error is found again by its signature, and no LLM can be called while replaying.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SafetyPolicy } from "../browser/policy";
import { SecretVault } from "../browser/vault";
import { StateRegistry } from "../explore/states";
import { newId } from "../ids";
import { assertLlmAllowed } from "../llm/guard";
import type { Check } from "../oracle/language";
import type { Candidate, Step } from "../types";
import { createHarness, type Harness } from "../../test/harness";
import { page, startFixtureServer, type FixtureServer } from "../../test/fixture-server";
import { replayTargets, type ReplayDeps } from "./replay";

let h: Harness;
let site: FixtureServer;
let flakyHits = 0;
let loggedInHits = 0;

const totals = (sub: string, total: string) =>
  page(
    `<dl><dt>Subtotal</dt><dd data-testid="sub">${sub}</dd><dt>Total</dt><dd data-testid="total">${total}</dd></dl>`,
  );

beforeAll(async () => {
  h = await createHarness();
  site = await startFixtureServer({
    "/buggy": { body: totals("$100.00", "$130.00") },
    "/fixed": { body: totals("$100.00", "$100.00") },
    "/flaky": () => ({ body: totals("$100.00", flakyHits++ % 2 === 0 ? "$130.00" : "$100.00") }),
    "/img": { body: page(`<img src="/missing.png" alt="A photo">`) },
    "/crash": {
      body: page(`<p>Loading</p><script>fetch("/api/data").catch(() => {})</script>`),
    },
    "/api/data": { status: 500, contentType: "application/json", body: "{}" },
    "/login": {
      body: page(
        `<form method="post" action="/session"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Log in</button></form>`,
      ),
    },
    "POST /session": {
      status: 303,
      headers: { location: "/account", "set-cookie": "s=1; Path=/" },
    },
    "/account": (req) => {
      const inSession = /s=1/.test(req.headers.cookie ?? "");
      if (inSession) loggedInHits++;
      return inSession
        ? { body: totals("$100.00", "$130.00").replace("<main>", "<main><button>Log out</button>") }
        : { status: 302, headers: { location: "/login" } };
    },
  });
});
afterAll(async () => {
  await site.close();
  await h.close();
});

const totalCheck: Check = {
  type: "numericRelation",
  left: { read: { by: "testId", id: "total" } },
  op: "eq",
  right: { read: { by: "testId", id: "sub" } },
};

function steps(path: string, journeyId: string, expectationId: string): Step[] {
  const base = {
    journeyId,
    kind: "happy" as const,
    beforeEvidenceIds: [],
    afterEvidenceIds: [],
    urlBefore: site.url("/"),
    urlAfter: site.url(path),
    ok: true,
  };
  return [
    {
      ...base,
      id: newId("sp"),
      index: 0,
      action: { type: "goto", path },
      description: `Go to ${path}`,
    },
    {
      ...base,
      id: newId("sp"),
      index: 1,
      action: { type: "check", check: totalCheck, expectationId },
      description: "Check: the total equals the subtotal",
      expectationId,
    },
  ];
}

function checkCandidate(
  path: string,
  recorded: Step[],
  expectationId: string,
  session: Candidate["session"] = "anonymous",
): Candidate {
  return {
    id: newId("cd"),
    kind: "bug",
    source: { kind: "check", id: "numericRelation", expectationId },
    category: "functional",
    route: path,
    url: site.url(path),
    session,
    viewport: "desktop",
    journeyId: recorded[0]?.journeyId,
    stepIds: recorded.map((s) => s.id),
    evidenceIds: [],
    signature: { kind: "check_failed", expectationId },
    groupKey: `check|${path}`,
    signals: {},
    detail: { title: "t", impact: "i", expected: "e", actual: "a", whyFlagged: "w" },
    summary: `totals on ${path}`,
    check: totalCheck,
  };
}

function deps(all: Step[], extra: Partial<ReplayDeps> = {}): ReplayDeps {
  const vault = new SecretVault();
  vault.set("pw", "hunter2-fixture");
  return {
    browser: h.browser,
    policy: new SafetyPolicy({ origin: site.origin, mode: "staging" }),
    evidence: h.writer,
    store: h.store,
    runId: h.runId,
    vault,
    sink: () => {},
    mode: "staging",
    viewport: { width: 1280, height: 800 },
    mobileViewport: { width: 375, height: 667 },
    credentials: { username: "ada@example.test", passwordRef: "pw" },
    loginUrl: site.url("/login"),
    states: new StateRegistry(),
    steps: new Map(all.map((s) => [s.id, s])),
    deadline: Date.now() + 60_000,
    ...extra,
  };
}

describe("replayTargets", () => {
  it("reproduces a real bug twice, drops a fixed one, and gives a flaky one a third attempt", async () => {
    const buggy = steps("/buggy", "jr_a", "ex_a");
    const fixed = steps("/fixed", "jr_b", "ex_b");
    const flaky = steps("/flaky", "jr_c", "ex_c");
    const targets = [
      { key: "buggy", candidate: checkCandidate("/buggy", buggy, "ex_a"), priority: 0 },
      { key: "fixed", candidate: checkCandidate("/fixed", fixed, "ex_b"), priority: 0 },
      { key: "flaky", candidate: checkCandidate("/flaky", flaky, "ex_c"), priority: 0 },
    ];
    const r = await replayTargets(targets, deps([...buggy, ...fixed, ...flaky]));
    expect(r.get("buggy")).toMatchObject({ attempts: 2, reproduced: 2 });
    expect(r.get("fixed")).toMatchObject({ attempts: 2, reproduced: 0 });
    expect(r.get("fixed")!.notes[0]).toContain("the check passed");
    expect(r.get("flaky")).toMatchObject({ attempts: 3, reproduced: 2 });
  });

  it("logs in before replaying a logged-in path (never reuses an old session)", async () => {
    const recorded = steps("/account", "jr_d", "ex_d");
    const logins = () => site.requests.filter((q) => q === "POST /session").length;
    const before = logins();
    const r = await replayTargets(
      [
        {
          key: "acct",
          candidate: checkCandidate("/account", recorded, "ex_d", "authenticated"),
          priority: 0,
        },
      ],
      deps(recorded),
    );
    expect(r.get("acct")).toMatchObject({ attempts: 2, reproduced: 2 });
    expect(logins() - before).toBe(2); // one login per attempt
    expect(loggedInHits).toBeGreaterThanOrEqual(2);
  });

  it("re-runs a static detector once, and finds a server error again by its signature", async () => {
    const img: Candidate = {
      ...checkCandidate("/img", [], "ex_x"),
      source: { kind: "detector", id: "DET-BROKENIMG" },
      category: "broken-resource",
      stepIds: [],
      signature: { kind: "detector", detectorId: "DET-BROKENIMG", key: "/missing.png" },
      groupKey: `brokenimg|${site.url("/missing.png")}`,
      check: undefined,
    };
    const crashSteps = steps("/crash", "jr_e", "ex_e").slice(0, 1);
    const crash: Candidate = {
      ...checkCandidate("/crash", crashSteps, "ex_e"),
      source: { kind: "detector", id: "DET-HTTP5XX" },
      category: "crash",
      signature: { kind: "http", method: "GET", pathPattern: "/api/data", statusClass: "5xx" },
      groupKey: "http5xx|GET /api/data",
      check: undefined,
    };
    const r = await replayTargets(
      [
        { key: "img", candidate: img, priority: 0 },
        { key: "crash", candidate: crash, priority: 0 },
      ],
      deps(crashSteps),
    );
    expect(r.get("img")).toMatchObject({ attempts: 1, reproduced: 1 });
    expect(r.get("crash")).toMatchObject({ attempts: 2, reproduced: 2 });
  });

  it("marks what it had no time for, and never lets an LLM call through", async () => {
    const recorded = steps("/buggy", "jr_f", "ex_f");
    const r = await replayTargets(
      [{ key: "late", candidate: checkCandidate("/buggy", recorded, "ex_f"), priority: 0 }],
      deps(recorded, { deadline: Date.now() - 1 }),
    );
    expect(r.get("late")).toMatchObject({ attempts: 0, skipped: expect.stringContaining("time") });
    // The guard is active inside replays: a gateway call from there would throw.
    await expect(
      (async () => {
        const { withoutLlm } = await import("../llm/guard");
        await withoutLlm("replay verification", async () => assertLlmAllowed("judge"));
      })(),
    ).rejects.toThrow(/replay/);
  });
});
