// Plain-language step descriptions, generated deterministically from the recorded action (never by the
// LLM). They become the report's "steps to reproduce" and the live view's action log (FR-10, FR-13).
import { describeLocator } from "../oracle/locate";
import type { Action } from "../types";

/** Placeholders are shown as what they stand for; the secret value is never in a description. */
function shownValue(value: string): string {
  if (value === "") return "nothing (clear the field)";
  const secret = /^\{\{secret:([a-zA-Z0-9_-]+)\}\}$/.exec(value);
  if (secret) return secret[1] === "username" ? "the test account's username" : `the ${secret[1]}`;
  const clipped = value.length > 60 ? `${value.slice(0, 57)}… (${value.length} characters)` : value;
  return `"${clipped}"`;
}

export function describeAction(action: Action, statement?: string): string {
  switch (action.type) {
    case "goto":
      return `Go to ${action.path}`;
    case "click":
      return `${action.clickCount === 2 ? "Double-click" : "Click"} ${describeLocator(action.target)}`;
    case "fill":
      return `Type ${shownValue(action.value)} into ${describeLocator(action.target)}`;
    case "select":
      return `Choose "${action.option}" in ${describeLocator(action.target)}`;
    case "press":
      return `Press ${action.key}`;
    case "reload":
      return "Reload the page";
    case "scroll":
      return `Scroll ${action.direction}`;
    case "wait":
      return `Wait ${(action.ms / 1000).toFixed(1)} s`;
    case "check":
      if (action.check.type === "capture") return `Note the value of ${action.check.name}`;
      return statement ? `Check: ${statement}` : `Check (${action.check.type})`;
  }
}
