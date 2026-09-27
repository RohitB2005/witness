// D78: the wall-clock cap is hard, and the report says in plain words what it cut.
import { describe, expect, it } from "vitest";
import { whatTheCapCut } from "../src/index";
import type { Journey } from "../src/types";

const none = {
  capsHit: [],
  crawlCut: 0,
  journeys: [] as Journey[],
  edgeSkipped: false,
  edgeVariantsSkipped: 0,
  notReplayed: 0,
  aiReviewsSkipped: 0,
  aiCallsCut: 0,
  uxSkipped: false,
  unwritten: 0,
};
const journey = (title: string, status: Journey["status"], incompleteReason?: string) =>
  ({ id: "jr_1", title, status, incompleteReason }) as Journey;

describe("whatTheCapCut", () => {
  it("nothing cut → not hit", () => {
    expect(whatTheCapCut(none)).toEqual({ hit: false, cut: [] });
  });

  it("a stage stopping at its share of the time counts as hit even with nothing listed", () => {
    expect(whatTheCapCut({ ...none, capsHit: ["wall-clock"] })).toEqual({ hit: true, cut: [] });
  });

  it.each<[Partial<Parameters<typeof whatTheCapCut>[0]>, string]>([
    [{ crawlCut: 3 }, "3 linked pages weren't visited."],
    [{ crawlCut: 1 }, "1 linked page wasn't visited."],
    [
      {
        journeys: [
          journey("Book a visit", "incomplete", "Its share of the exploring time ran out."),
          journey("Search", "skipped", "Not started: the time limit for exploring was reached."),
          journey("Profile", "incomplete", "Step budget (25) reached."), // not the clock
          journey("Done", "completed"),
        ],
      },
      '2 journeys stopped or didn\'t start: "Book a visit", "Search".',
    ],
    [{ edgeSkipped: true }, "The unusual-input tests didn't run."],
    [{ edgeVariantsSkipped: 4 }, "4 unusual inputs weren't tried."],
    [{ notReplayed: 8 }, "8 findings weren't replayed, so they are Needs review."],
    [{ notReplayed: 1 }, "1 finding wasn't replayed, so it is Needs review."],
    [{ aiReviewsSkipped: 2 }, "2 second-opinion AI reviews didn't run."],
    [{ uxSkipped: true }, "The UX review didn't run."],
    [
      { unwritten: 5 },
      "5 bug descriptions use the plain template instead of the AI writer's wording.",
    ],
    [{ aiCallsCut: 1 }, "1 AI call was stopped or not started."],
  ])("%o", (patch, line) => {
    const r = whatTheCapCut({ ...none, ...patch });
    expect(r.hit).toBe(true);
    expect(r.cut).toEqual([line]);
  });
});
