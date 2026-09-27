// End-to-end AI pipeline on the fictional library site with scripted mock models: plan (with one invalid
// check and one unknown route, which code must drop) → explore (select a sort, assert, fill and send a
// form) → edge inputs (fixed set + one generated variant) → findings. No network, no cost.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SecretVault } from "../src/browser/vault";
import { resolveScanConfig } from "../src/config/schema";
import { PLAN_AUTO_APPROVE_MS, runScan, type WitnessEvent } from "../src/index";
import { JsonRunStore } from "../src/store/json-store";
import type { Pipeline } from "../src/types";
import { createHarness, type Harness } from "./harness";
import { startLibrarySite, type LibrarySite } from "./library-site";
import { mockModel, type MockReply } from "./mock-llm";

const PLAN = {
  appModel: {
    purpose: "A library catalogue where people browse books and request new ones.",
    domain: "library",
    entities: ["book", "request"],
  },
  journeys: [
    {
      title: "Sort books by price",
      goal: "Sort the book list from the lowest to the highest late fee",
      priority: "core",
      startRoute: "/books",
      suggestedSteps: ["Open Books", "Choose Price: low to high", "Check the order"],
      expectations: [
        {
          statement: "Price: low to high lists books from the lowest to the highest fee",
          check: {
            type: "ordered",
            items: {
              by: "role",
              role: "listitem",
              within: { by: "role", role: "list", name: "Books" },
            },
            read: "number",
            direction: "asc",
          },
          grounding: { kind: "ui_text", quote: "Price: low to high" },
          impact: "wrong-info",
          category: "functional",
          when: "after choosing Price: low to high",
        },
        {
          statement: "An expectation with a broken check",
          check: { type: "looksRight" },
          grounding: { kind: "ui_text", quote: "Text that is on no page" },
          impact: "cosmetic",
        },
      ],
    },
    {
      title: "Request a book",
      goal: "Send a book request with a name and an email",
      priority: "core",
      startRoute: "/request",
      suggestedSteps: ["Fill in the form", "Send it"],
      expectations: [
        {
          statement: "Sending a request shows a confirmation",
          check: { type: "visible", target: { by: "text", text: "Request received" } },
          grounding: { kind: "convention", rationale: "Forms confirm what they did." },
          impact: "blocks-completion",
          category: "functional",
          when: "after sending the request",
        },
      ],
      edgeTargets: [{ formRoute: "/request", formName: "Request a book" }],
    },
    {
      title: "A page that doesn't exist",
      goal: "Visit a page the crawler never found",
      priority: "secondary",
      startRoute: "/nowhere",
      suggestedSteps: ["Open it"],
      expectations: [],
    },
    {
      title: "Malformed",
      goal: "x",
      priority: "sometimes",
      startRoute: "/",
      suggestedSteps: [],
      expectations: [],
    },
  ],
};

const smartReply = (prompt: string): MockReply => {
  if (prompt.includes("Plan the journeys.")) return { json: PLAN };
  // Escalated Explorer turns (e.g. the first view of labelled amounts) go to the smart model.
  if (prompt.includes("<journey id=")) return explorerReply(prompt);
  if (prompt.includes("Propose the edge inputs.")) {
    return {
      json: {
        variants: [
          {
            field: "Email",
            value: "not an email at all",
            purpose: "text without an @",
            expectation: "reject",
            rationale: "It's an email field.",
          },
        ],
      },
    };
  }
  return { text: "{}" };
};

/** A scripted Explorer: reads the turn prompt (title, history, refs) and picks the next tool call. */
const explorerReply = (prompt: string): MockReply => {
  const title = /Title: (.+)/.exec(prompt)?.[1] ?? "";
  const history = /<recent_steps>([\s\S]*?)<\/recent_steps>/.exec(prompt)?.[1] ?? "";
  const ref = (re: RegExp) => {
    const line = prompt.split("\n").find((l) => re.test(l) && /\[ref=/.test(l)) ?? "";
    return /\[ref=([a-z0-9]+)\]/.exec(line)?.[1] ?? "e0";
  };
  const pending = /(ex_[a-z0-9]+) \[not checked yet\]/.exec(prompt)?.[1];
  if (title.startsWith("Sort")) {
    if (!history.includes('Choose "Price: low to high"')) {
      return {
        tool: "select",
        input: {
          ref: ref(/combobox "Sort by"/),
          option: "Price: low to high",
          why: "sort by price",
        },
      };
    }
    // A weak replacement check (always passes): the planned `ordered` check must still be used first.
    if (pending) {
      return { tool: "assert", input: { expectationId: pending, check: { type: "noNewErrors" } } };
    }
    return { tool: "finish", input: { outcome: "completed", note: "sorted and checked" } };
  }
  if (!history.includes('into the "Full name"')) {
    return {
      tool: "fill",
      input: { ref: ref(/textbox "Full name"/), value: "Ada Lovelace", why: "name" },
    };
  }
  if (!history.includes('into the "Email"')) {
    return {
      tool: "fill",
      input: { ref: ref(/textbox "Email"/), value: "ada@example.test", why: "email" },
    };
  }
  if (!history.includes('Click the "Send request"')) {
    return { tool: "click", input: { ref: ref(/button "Send request"/), why: "send" } };
  }
  if (pending) return { tool: "assert", input: { expectationId: pending } };
  return { tool: "finish", input: { outcome: "completed", note: "sent" } };
};

let h: Harness;
let site: LibrarySite;
let dir: string;

beforeAll(async () => {
  h = await createHarness();
  site = await startLibrarySite();
  dir = await mkdtemp(path.join(tmpdir(), "witness-ai-scan-"));
});
afterAll(async () => {
  await site.close();
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

async function scan(
  pipeline: Pipeline,
  models = { smart: mockModel([smartReply]), fast: mockModel([explorerReply]) },
) {
  const store = new JsonRunStore({
    runsDir: path.join(dir, "runs"),
    dataDir: path.join(dir, "data"),
  });
  const config = resolveScanConfig({
    url: site.url("/"),
    budget: "standard",
    pipeline,
    llmCache: "off",
  });
  const result = await runScan(config, {
    store,
    vault: new SecretVault(),
    browser: h.browser,
    models: {
      smart: models.smart.model,
      fast: models.fast.model,
      ids: { smart: "test/smart", fast: "test/fast" },
    },
    llmCacheDir: path.join(dir, "cache"),
  });
  return { result, store, models };
}

describe("AI pipeline (mock models)", () => {
  it(
    "plans, explores, tries edge inputs and reports check failures and edge findings",
    { timeout: 180_000 },
    async () => {
      const { result, store, models } = await scan("full");
      expect(result.error).toBeUndefined();
      expect(result.aiStagesSkipped).toBeUndefined();

      // Planner output was validated by code.
      expect(result.appModel?.domain).toBe("library");
      expect(result.journeys.filter((j) => !j.automatic).map((j) => j.title)).toEqual([
        "Sort books by price",
        "Request a book",
      ]);
      // The automatic probes ran alongside (D46), and the sort probe found the same sort bug on its own.
      expect(result.journeys.filter((j) => j.automatic).map((j) => j.title)).toContain(
        "Sort controls (automatic check)",
      );
      expect(
        result.findings.some((f) => f.source.kind === "detector" && f.source.id === "DET-SORT"),
      ).toBe(true);
      expect(result.aiMetrics).toMatchObject({
        "plan.journeysDroppedRoute": 1,
        "plan.journeysInvalid": 1,
        "plan.expectationsInvalidCheck": 1,
        "plan.planPartial": 1,
        "explore.journeysCompleted": 2,
      });
      const sortJourney = result.journeys[0]!;
      expect(sortJourney.status).toBe("completed");
      expect(sortJourney.expectations[0]!.grounding).toMatchObject({
        kind: "ui_text",
        verified: true,
      });

      // The sort bug: a failed `ordered` check, grounded in on-screen text, reproduced by replay → Confirmed.
      const sort = result.findings.find(
        (f) => f.source.kind === "check" && f.source.id === "ordered",
      );
      expect(sort, JSON.stringify(result.findings.map((f) => f.title))).toBeDefined();
      expect(sort!.tier).toBe("confirmed");
      expect(sort!.replay).toMatchObject({ attempts: 2, reproduced: 2 });
      expect(sort!.stageTiers).toEqual({ aiNoVerify: "confirmed", noSkeptic: "confirmed" });
      expect(sort!.repro?.check?.type).toBe("ordered");
      expect(sort!.severity).toBe("high"); // core journey, wrong-info
      expect(sort!.route).toBe("/books");
      expect(sort!.steps).toContain('Choose "Price: low to high" in the "Sort by" dropdown');
      expect(sort!.actual).toContain("comes after");

      // Edge inputs on the request form (deterministic runner).
      const bySource = (id: string) =>
        result.findings.filter(
          (f) => f.source.kind !== "judgement" && "id" in f.source && f.source.id === id,
        );
      const five = bySource("DET-HTTP5XX").find((f) => f.signals.request?.path === "/api/requests");
      expect(five, "apostrophe → 500").toBeDefined();
      expect(five!.severity).toBe("critical"); // crash during a core journey's form
      expect(five!.actual).toContain("apostrophe");
      expect(bySource("DET-XSS")).toHaveLength(1);
      const empty = result.findings.find(
        (f) => f.category === "validation" && /empty required/.test(f.title),
      );
      expect(empty, "empty required name accepted").toBeDefined();
      expect(bySource("maxRequests")).toHaveLength(1); // double submit created two
      // The generated variant ran, and the browser refused it (type=email), so no finding for it.
      expect(result.findings.some((f) => /without an @/.test(f.title))).toBe(false);
      expect(result.aiMetrics?.["edge.aiUsed"]).toBe(1);
      expect(result.aiMetrics?.["edge.fieldsDiscovered"]).toBe(1); // the pre-filled "Branch"

      // Every LLM call was logged; the explorer used the fast model.
      const log = (
        await readFile(path.join(store.runDir(result.runId), "llm-calls.ndjson"), "utf8")
      )
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { role: string; model: string });
      expect(log.filter((l) => l.role === "planner").length).toBeGreaterThanOrEqual(2); // + one repair
      // The Explorer runs on the fast model; the first view of labelled amounts (the late fees on
      // /books) escalates exactly that turn to the smart model.
      const explorer = log.filter((l) => l.role === "explorer");
      const smartTurns = explorer.filter((l) => l.model === "test/smart").length;
      expect(smartTurns).toBe(result.aiMetrics?.["explore.escalations"]);
      expect(smartTurns).toBeGreaterThanOrEqual(1);
      expect(explorer.length - smartTurns).toBeGreaterThan(smartTurns);
      expect(result.stats.llmCalls).toBe(log.length);
      expect(result.stats.costUsd).toBeGreaterThan(0);
      expect(result.stats.steps).toBeGreaterThan(5);
      expect(models.fast.prompts.every((p) => p.includes('<page_content untrusted="true"'))).toBe(
        true,
      );
      expect(result.verdict.level).toBe("not_ready");
    },
  );

  it(
    "ai-no-verify reports a grounded check failure as Confirmed (the unverified ablation)",
    { timeout: 180_000 },
    async () => {
      const { result } = await scan("ai-no-verify");
      const sort = result.findings.find(
        (f) => f.source.kind === "check" && f.source.id === "ordered",
      );
      expect(sort?.tier).toBe("confirmed");
      expect(sort?.tierReason).toContain("ablation A1");
    },
  );

  it(
    "one provider error on an Explorer turn is a bad turn, not the end of exploration",
    { timeout: 180_000 },
    async () => {
      let n = 0;
      const flaky = (prompt: string): MockReply =>
        ++n === 2 ? { error: new Error("upstream timeout") } : explorerReply(prompt);
      const { result } = await scan("full", {
        smart: mockModel([smartReply]),
        fast: mockModel([flaky]),
      });
      expect(result.aiStagesSkipped).toBeUndefined();
      expect(result.aiMetrics?.["explore.journeysCompleted"]).toBe(2);
      expect(result.aiMetrics?.["llm.failures"]).toBe(1);
    },
  );

  it(
    "degrades to deterministic findings when the planner fails (NFR-3)",
    { timeout: 120_000 },
    async () => {
      const broken = {
        smart: mockModel([{ text: "I can't do that" }]),
        fast: mockModel([explorerReply]),
      };
      const { result } = await scan("full", broken);
      expect(result.error).toBeUndefined();
      expect(result.aiStagesSkipped).toMatch(/^Planning failed \(invalid\)/);
      expect(result.journeys.filter((j) => !j.automatic)).toEqual([]);
      expect(result.stats.pages).toBeGreaterThan(0);
      expect(result.notTested[0]).toMatch(/only page loads/);
    },
  );
});

describe("plan review (live view)", () => {
  it(
    "shows the plan with an auto-approve countdown and runs only the approved journeys",
    { timeout: 120_000 },
    async () => {
      const store = new JsonRunStore({
        runsDir: path.join(dir, "runs"),
        dataDir: path.join(dir, "data"),
      });
      const models = { smart: mockModel([smartReply]), fast: mockModel([explorerReply]) };
      let shown: { titles: string[]; ms: number } | undefined;
      const events: WitnessEvent[] = [];
      const result = await runScan(
        resolveScanConfig({
          url: site.url("/"),
          budget: "quick",
          pipeline: "full",
          llmCache: "off",
        }),
        {
          store,
          vault: new SecretVault(),
          browser: h.browser,
          sink: (e) => events.push(e),
          models: {
            smart: models.smart.model,
            fast: models.fast.model,
            ids: { smart: "test/smart", fast: "test/fast" },
          },
          llmCacheDir: path.join(dir, "cache"),
          // The reviewer unticks every journey.
          approvePlan: async (journeys, ms) => {
            shown = { titles: journeys.map((j) => j.title), ms };
            return [];
          },
        },
      );
      expect(shown?.ms).toBe(PLAN_AUTO_APPROVE_MS);
      expect(shown?.titles.length).toBeGreaterThan(0);
      const plan = events.find((e) => e.t === "plan");
      expect(plan && plan.t === "plan" && plan.autoApproveInMs).toBe(PLAN_AUTO_APPROVE_MS);
      const planned = result.journeys.filter((j) => !j.automatic);
      expect(planned.length).toBe(shown?.titles.length);
      for (const j of planned) {
        expect(j.status).toBe("skipped");
        expect(j.incompleteReason).toBe("Not approved in the plan review.");
      }
      expect(models.fast.prompts).toHaveLength(0); // the Explorer never ran
    },
  );
});

describe("offline replay (NFR-5, D86)", () => {
  it(
    "a second scan with --llm-cache replay gets every AI answer from the first scan's cache",
    { timeout: 240_000 },
    async () => {
      const cacheDir = path.join(dir, "replay-cache");
      const run = async (llmCache: "rw" | "replay", models: ReturnType<typeof mockModel>[]) => {
        const store = new JsonRunStore({
          runsDir: path.join(dir, "runs"),
          dataDir: path.join(dir, "data"),
        });
        return runScan(
          resolveScanConfig({ url: site.url("/"), budget: "quick", pipeline: "full", llmCache }),
          {
            store,
            vault: new SecretVault(),
            browser: h.browser,
            models: {
              smart: models[0]!.model,
              fast: models[1]!.model,
              ids: { smart: "test/smart", fast: "test/fast" },
            },
            llmCacheDir: cacheDir,
          },
        );
      };
      const first = await run("rw", [mockModel([smartReply]), mockModel([explorerReply])]);
      expect(first.aiStagesSkipped).toBeUndefined();
      expect(first.stats.llmCalls).toBeGreaterThan(3);

      // Offline: any real model call fails. Every ID the run generates is new.
      const offline = [
        mockModel([{ error: new Error("network is off") }]),
        mockModel([{ error: new Error("network is off") }]),
      ];
      const second = await run("replay", offline);
      expect(second.aiStagesSkipped).toBeUndefined();
      expect(offline[0]!.prompts.length + offline[1]!.prompts.length).toBe(0);
      expect(second.stats.llmCacheHits).toBe(second.stats.llmCalls);
      expect(second.stats.llmCalls).toBeGreaterThan(3);
      const titles = (r: typeof first) =>
        r.findings
          .filter((f) => f.kind === "bug")
          .map((f) => f.title)
          .sort();
      expect(titles(second)).toEqual(titles(first));
      expect(second.journeys.map((j) => j.status)).toEqual(first.journeys.map((j) => j.status));
    },
  );
});
