// Destructive-verb policy (AI_AGENT_SPEC.md §4, SECURITY.md T1): a second layer on top of the network-level
// write block. Decided by code on the control's accessible name and visible text — never by the prompt.
import type { ScanMode } from "../types";

/** Blocked in both modes: irreversible, account-level or money-moving actions. */
export const ALWAYS_BLOCKED =
  /\b(delete|close|remove|deactivate) (my |your |the )?account\b|\bunsubscribe\b|\btransfer (funds|money)\b/i;

/** Blocked in production mode: anything that changes data or sends something. */
export const PRODUCTION_BLOCKED =
  /\b(delete|remove|cancel|pay|purchase|place order|checkout|check out|send|submit|confirm)\b/i;

/** The reason a click on a control with this name/text must not happen, or undefined if it may. */
export function destructiveBlock(label: string, mode: ScanMode): string | undefined {
  const text = label.replace(/\s+/g, " ").trim();
  if (ALWAYS_BLOCKED.test(text)) {
    return `"${text.slice(0, 60)}" is an account-level or irreversible action, which Witness never performs.`;
  }
  if (mode === "production" && PRODUCTION_BLOCKED.test(text)) {
    return `"${text.slice(0, 60)}" would change data, and this scan is in production (read-only) mode.`;
  }
  return undefined;
}

/** Keys the Explorer may press. */
export const ALLOWED_KEYS = new Set(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown"]);
