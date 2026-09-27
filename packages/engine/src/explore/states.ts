// Page states seen anywhere in the run (crawl + agent), keyed like the crawler's dedupe: route pattern +
// aria structure hash + session. The executor asks "is this state new?" to decide whether the full page
// detectors (axe, images, perf, overflow) need to run again.
import { routePattern, structureHash } from "../crawl/normalise";
import { newId } from "../ids";
import type { PageState } from "../types";

export class StateRegistry {
  readonly #byKey = new Map<string, PageState>();
  /** States first discovered by the agent (appended to the run's state list). */
  readonly added: PageState[] = [];
  /** Snapshot text of each added state, in memory (the requirements "not found" search reads it). */
  readonly texts = new Map<string, string>();

  constructor(initial: PageState[] = []) {
    for (const s of initial) this.#byKey.set(key(s.routePattern, s.structureHash, s.session), s);
  }

  static keyFor(url: string, snapshot: string): string {
    return `${routePattern(url)}|${structureHash(snapshot)}`;
  }

  /** Finds or creates the state for this page; `isNew` is true the first time the run sees it. */
  register(input: {
    url: string;
    snapshot: string;
    title: string;
    session: PageState["session"];
    evidenceIds: string[];
    status?: number;
    /** Id to give the state if it's new (so evidence captured before registering can point at it). */
    id?: string;
  }): { state: PageState; isNew: boolean } {
    const pattern = routePattern(input.url);
    const hash = structureHash(input.snapshot);
    const k = key(pattern, hash, input.session);
    const existing = this.#byKey.get(k);
    if (existing) return { state: existing, isNew: false };
    const state: PageState = {
      id: input.id ?? newId("st"),
      url: input.url,
      routePattern: pattern,
      structureHash: hash,
      title: input.title,
      status: input.status,
      session: input.session,
      evidenceIds: input.evidenceIds,
      discoveredBy: "agent",
    };
    this.#byKey.set(k, state);
    this.added.push(state);
    this.texts.set(state.id, input.snapshot);
    return { state, isNew: true };
  }
}

function key(pattern: string, hash: string, session: string): string {
  return `${pattern}|${hash}|${session}`;
}
