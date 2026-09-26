// Replay guard (AI_AGENT_SPEC.md §1): code that must be deterministic runs inside `withoutLlm`, and any
// LLM call made from inside it throws. Uses AsyncLocalStorage, so it follows awaits and callbacks.
import { AsyncLocalStorage } from "node:async_hooks";

const blocked = new AsyncLocalStorage<string>();

export class ReplayGuardError extends Error {
  override name = "ReplayGuardError";
}

/** Runs `fn` with LLM calls forbidden (replays, the edge-input runner). `why` appears in the error. */
export function withoutLlm<T>(why: string, fn: () => Promise<T>): Promise<T> {
  return blocked.run(why, fn);
}

/** Throws if the caller is inside `withoutLlm`. */
export function assertLlmAllowed(role: string): void {
  const why = blocked.getStore();
  if (why !== undefined) {
    throw new ReplayGuardError(
      `LLM call (${role}) attempted during ${why}; replays never use the LLM.`,
    );
  }
}
