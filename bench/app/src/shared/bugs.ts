// Every seeded defect in Harbour Clean is guarded by isBugOn("Bxx"), so `grep isBugOn` lists them all.
// Ground truth for what each flag does lives in bench/bugs.yaml (frozen), bench/bugs-v2.yaml (B19+,
// frozen separately) and bench/BENCH_SPEC.md §4.
//
// This module is shared: the server and the browser each hold their own copy of the active set.
// The server sets it from BENCH_BUGS at start-up and from POST /__bench/bugs; the browser loads it
// from GET /__bench/bugs once before the first render.

export const BUG_IDS = [
  "B01",
  "B02",
  "B03",
  "B04",
  "B05",
  "B06",
  "B07",
  "B08",
  "B09",
  "B10",
  "B11",
  "B12",
  "B13",
  "B14",
  "B15",
  "B16",
  "B17",
  "B18",
  "C01",
  // v2 (bench/bugs-v2.yaml): QA coverage pack. B24 is only added if its probe (A6) is built.
  "B19",
  "B20",
  "B21",
  "B22",
  "B23",
] as const;

export type BugId = (typeof BUG_IDS)[number];

export function isBugId(value: string): value is BugId {
  return (BUG_IDS as readonly string[]).includes(value);
}

/**
 * Parses a BENCH_BUGS value: "none" (or empty), "all", or a comma list like "B01, b05,C01".
 * Throws on unknown IDs so a typo never silently runs the clean build.
 */
export function parseBugList(raw: string | undefined): BugId[] {
  const value = (raw ?? "").trim();
  if (value === "" || value.toLowerCase() === "none") return [];
  if (value.toLowerCase() === "all") return [...BUG_IDS];
  const ids = value
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== "");
  const unknown = ids.filter((id) => !isBugId(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown bug flag(s): ${unknown.join(", ")}. Valid: ${BUG_IDS.join(", ")}`);
  }
  return BUG_IDS.filter((id) => ids.includes(id));
}

let active = new Set<BugId>();

export function setActiveBugs(ids: Iterable<BugId>): void {
  active = new Set(ids);
}

export function getActiveBugs(): BugId[] {
  return BUG_IDS.filter((id) => active.has(id));
}

export function isBugOn(id: BugId): boolean {
  return active.has(id);
}
