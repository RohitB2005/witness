// Planner validation (SPEC FR-5 AC) and the app-map summary. Pure: no browser, no model.
import { describe, expect, it } from "vitest";
import { resolveScanConfig } from "../config/schema";
import { resolveStartRoute, validatePlan, verifyGrounding, type PlannedCriterion } from "./planner";
import { buildAppMapSummary, parseSnapshot, type MapPage } from "./summary";

const SNAP_ITEMS = `- main [ref=e1]:
  - heading "Catalogue" [level=1] [ref=e2]
  - combobox "Sort by" [ref=e3]:
    - option "Title" [selected]
    - option "Price: low to high"
  - textbox "Search titles" [ref=e4]
  - button "Search" [ref=e5]
  - list "Books" [ref=e6]:
    - listitem [ref=e7]:
      - heading "Atlas" [level=2] [ref=e8]
      - paragraph [ref=e9]: $20 late fee
    - listitem [ref=e10]:
      - link "Borrow Atlas" [ref=e11]:
        - /url: /items/12
  - paragraph [ref=e12]: "Total (incl. 10% tax): $22.00"`;

const nav = `- navigation "Main" [ref=f1]:
  - link "Home" [ref=f2]:
    - /url: /
  - link "Catalogue" [ref=f3]:
    - /url: /items`;

function page(
  id: string,
  url: string,
  routePattern: string,
  snapshot: string,
  title = "Page",
): MapPage {
  return { state: { id, url, routePattern, title, session: "anonymous", status: 200 }, snapshot };
}

const pages: MapPage[] = [
  page(
    "st_home",
    "http://app.test/",
    "/",
    `${nav}\n- heading "Welcome" [level=1] [ref=a1]`,
    "Home",
  ),
  page("st_items", "http://app.test/items", "/items", `${nav}\n${SNAP_ITEMS}`, "Catalogue"),
  page(
    "st_i12",
    "http://app.test/items/12",
    "/items/:id",
    `${nav}\n- heading "Atlas" [level=1] [ref=b1]\n- button "Borrow" [ref=b2]`,
    "Atlas",
  ),
  page(
    "st_i13",
    "http://app.test/items/13",
    "/items/:id",
    `${nav}\n- heading "Bestiary" [level=1] [ref=c1]\n- button "Borrow" [ref=c2]`,
    "Bestiary",
  ),
];
const snapshotEvidence = new Map(pages.map((p) => [p.state.id, `ev_${p.state.id}`]));

const exp = (over: Record<string, unknown> = {}) => ({
  statement: "Sorting by price orders the list",
  check: {
    type: "ordered",
    items: { by: "role", role: "listitem" },
    read: "number",
    direction: "asc",
  },
  grounding: { kind: "ui_text", quote: "Price: low to high" },
  impact: "wrong-info",
  ...over,
});
const journey = (over: Record<string, unknown> = {}) => ({
  title: "Sort the catalogue",
  goal: "Sort items by price",
  priority: "core",
  startRoute: "/items",
  suggestedSteps: ["Open the catalogue", "Sort by price"],
  expectations: [exp()],
  ...over,
});
const appModel = { purpose: "A library catalogue", domain: "library", entities: ["item"] };

describe("validatePlan", () => {
  it("keeps valid journeys, verifies ui_text quotes against recorded pages", () => {
    const out = validatePlan(
      { appModel, journeys: [journey()] },
      { pages, snapshotEvidence, maxJourneys: 5 },
    );
    expect(out.journeys).toHaveLength(1);
    const e = out.journeys[0]!.expectations[0]!;
    expect(e.grounding).toEqual({
      kind: "ui_text",
      quote: "Price: low to high",
      verified: true,
      evidenceId: "ev_st_items",
    });
    expect(e.id).toMatch(/^ex_/);
    expect(e.journeyId).toBe(out.journeys[0]!.id);
    expect(e.origin).toBe("plan");
    expect(out.metrics).toMatchObject({ groundingUiText: 1, groundingVerified: 1 });
  });

  it("downgrades an unverifiable quote to convention (never trusts the model's quote)", () => {
    const out = validatePlan(
      {
        appModel,
        journeys: [
          journey({
            expectations: [exp({ grounding: { kind: "ui_text", quote: "Cheapest first!" } })],
          }),
        ],
      },
      { pages, snapshotEvidence, maxJourneys: 5 },
    );
    expect(out.journeys[0]!.expectations[0]!.grounding).toEqual({
      kind: "convention",
      rationale: 'Quoted text not found on any recorded page: "Cheapest first!"',
    });
    expect(out.metrics.groundingVerified).toBe(0);
  });

  it("drops expectations whose check doesn't parse, and journeys with unknown routes or bad shape", () => {
    const out = validatePlan(
      {
        appModel,
        journeys: [
          journey({ expectations: [exp(), exp({ check: { type: "looksFine" } })] }),
          journey({ title: "Ghost", startRoute: "/does-not-exist" }),
          { title: "x" },
        ],
      },
      { pages, snapshotEvidence, maxJourneys: 5 },
    );
    expect(out.journeys.map((j) => j.title)).toEqual(["Sort the catalogue"]);
    expect(out.journeys[0]!.expectations).toHaveLength(1);
    expect(out.metrics).toMatchObject({
      expectationsInvalidCheck: 1,
      journeysDroppedRoute: 1,
      journeysInvalid: 1,
    });
  });

  it("keeps core journeys first when trimming to the budget", () => {
    const out = validatePlan(
      {
        appModel,
        journeys: [
          journey({ title: "Secondary A", priority: "secondary" }),
          journey({ title: "Core A" }),
          journey({ title: "Secondary B", priority: "secondary" }),
          journey({ title: "Core B" }),
        ],
      },
      { pages, snapshotEvidence, maxJourneys: 3 },
    );
    expect(out.journeys.map((j) => j.title)).toEqual(["Core A", "Core B", "Secondary A"]);
    expect(out.metrics.journeysDroppedBudget).toBe(1);
  });
});

describe("requirements hook (addendum A5, P2)", () => {
  const requirements =
    "1. Customers can search the catalogue by title.\n2. Customers can reschedule a loan.";

  it("the scan config accepts requirements up to 5,000 characters", () => {
    expect(
      resolveScanConfig({ url: "http://app.test/", requirements: `  ${requirements}  ` })
        .requirements,
    ).toBe(requirements);
    expect(() =>
      resolveScanConfig({ url: "http://app.test/", requirements: "x".repeat(5001) }),
    ).toThrow(/5,000/);
  });

  it("a requirement quote is verified by string match against the requirements text", () => {
    expect(
      verifyGrounding(
        { kind: "requirement", quote: "search the  catalogue by title" },
        { pages, snapshotEvidence, requirements },
      ),
    ).toEqual({
      kind: "requirement",
      quote: "search the  catalogue by title",
      verified: true,
    });
    expect(
      verifyGrounding(
        { kind: "requirement", quote: "export to PDF" },
        { pages, snapshotEvidence, requirements },
      ).kind,
    ).toBe("convention");
    expect(
      verifyGrounding({ kind: "requirement", quote: "search" }, { pages, snapshotEvidence }).kind,
    ).toBe("convention");
  });
});

describe("resolveStartRoute", () => {
  const states = pages.map((p) => p.state);
  it.each([
    ["/items", "/items"],
    ["/items/", "/items"],
    ["http://app.test/items", "/items"],
    ["/items/:id", "/items/12"],
    ["/items/12", "/items/12"],
    ["/checkout", undefined],
  ])("%s → %s", (route, want) => {
    expect(resolveStartRoute(route, states)).toBe(want);
  });
});

describe("app-map summary", () => {
  it("parses headings, fields with options, buttons, links and notable text", () => {
    const p = parseSnapshot(SNAP_ITEMS);
    expect(p.headings).toEqual(["Catalogue", "Atlas"]);
    expect(p.fields).toEqual([
      'combobox "Sort by" options: Title (selected) | Price: low to high',
      'textbox "Search titles"',
    ]);
    expect(p.buttons).toEqual(["Search"]);
    expect(p.links).toEqual([{ text: "Borrow Atlas", url: "/items/12" }]);
    expect(p.text).toEqual(["$20 late fee", "Total (incl. 10% tax): $22.00"]);
  });

  it("lists site navigation once and groups pages that share a layout", () => {
    const s = buildAppMapSummary(pages);
    expect(s).toContain("Site navigation (on most pages): Home → /; Catalogue → /items");
    expect(s.match(/## \/items\/:id/g)).toHaveLength(1);
    expect(s).toContain('## /items  "Catalogue"');
    expect(s).toContain("Price: low to high");
  });

  it("stays within the size limit", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      page(
        `st_${i}`,
        `http://app.test/p${i}`,
        `/p${i}`,
        `${SNAP_ITEMS}\n- heading "Unique ${i}" [ref=z${i}]`,
      ),
    );
    expect(buildAppMapSummary(many, 5_000).length).toBeLessThanOrEqual(5_100);
  });
});

describe("validatePlan: acceptance criteria (ADDENDUM A5)", () => {
  const requirements = `Scope.\n1. Members can sort the catalogue by price.\n2. Members can renew a loan online.`;
  const crit = (over: Partial<PlannedCriterion> = {}): PlannedCriterion => ({
    number: 1,
    text: "Sort by price",
    quote: "Members can sort the catalogue by price.",
    importance: "core",
    foundInApp: true,
    lookFor: [],
    ...over,
  });

  it("keeps criteria whose quote is in the requirements, drops invented ones, links expectations", () => {
    const out = validatePlan(
      {
        appModel,
        journeys: [
          journey({
            expectations: [exp({ criterion: 1 }), exp({ criterion: 7 })],
            criteria: [1, 2],
          }),
        ],
        criteria: [
          crit(),
          crit({
            number: 2,
            text: "Renew a loan",
            quote: "Members can renew a loan online.",
            foundInApp: false,
            lookFor: ["Renew", " "],
          }),
          crit({ number: 3, text: "Pay fines", quote: "Members can pay fines by card." }), // not in the text
        ],
      },
      { pages, snapshotEvidence, requirements, maxJourneys: 5 },
    );
    expect(out.criteria.map((c) => [c.id, c.plannedNotFound, c.lookFor])).toEqual([
      ["AC1", false, []],
      ["AC2", true, ["Renew"]],
    ]);
    expect(out.metrics).toMatchObject({ criteriaProposed: 3, criteriaDroppedQuote: 1 });
    const [e1, e2] = out.journeys[0]!.expectations;
    expect(e1!.criterionId).toBe("AC1");
    expect(e2!.criterionId).toBeUndefined(); // AC7 doesn't exist
    expect(out.journeys[0]!.criterionIds).toEqual(["AC1", "AC2"]);
  });

  it("without requirements, no criteria survive", () => {
    const out = validatePlan(
      { appModel, journeys: [journey()], criteria: [crit()] },
      { pages, snapshotEvidence, maxJourneys: 5 },
    );
    expect(out.criteria).toEqual([]);
    expect(out.journeys[0]!.criterionIds).toBeUndefined();
  });
});
