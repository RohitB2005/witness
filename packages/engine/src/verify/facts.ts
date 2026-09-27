// Fact sheets for the LLM stages after exploring (judge, skeptic, writer): recorded facts only, in plain
// text. Page text always goes to a model wrapped as untrusted content (CLAUDE.md rule 7).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunStore } from "../store/run-store";

/** The snapshot text behind an aria_snapshot evidence id ("" if it can't be read). */
export async function snapshotText(
  store: RunStore,
  runId: string,
  evidenceId?: string,
): Promise<string> {
  if (!evidenceId) return "";
  const ev = await store.getEvidence(runId, evidenceId).catch(() => undefined);
  if (!ev || ev.kind !== "aria_snapshot" || !ev.path) return "";
  return readFile(path.join(store.runDir(runId), ev.path), "utf8").catch(() => "");
}

const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?([^:]*)(?::\s*(.*))?$/;
const SHOWN = new Set([
  "heading",
  "paragraph",
  "text",
  "alert",
  "status",
  "cell",
  "term",
  "definition",
  "listitem",
  "button",
  "link",
  "strong",
  "generic",
  "option",
  "textbox",
  "combobox",
  "spinbutton",
  "searchbox",
]);

/**
 * What a person would read on the page, one line per element ("heading: Your quote", "alert: …"), without
 * refs or URLs; at most `max` lines. Selected options and field values are kept (they're what's on screen).
 */
export function pageText(snapshot: string, max = 80): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of snapshot.split("\n")) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const [, , role = "", q, attrs = "", inline] = m;
    if (!SHOWN.has(role)) continue;
    if (role === "option" && !/\[selected\]/.test(attrs)) continue;
    let name = q ?? "";
    try {
      name = q !== undefined ? (JSON.parse(`"${q}"`) as string) : "";
    } catch {
      // keep raw
    }
    const value = (inline ?? "").replace(/^"|"$/g, "").trim();
    const text = [name, value].filter(Boolean).join(": ").replace(/\s+/g, " ").trim();
    if (!text || text.startsWith("/url") || text.length > 200) continue;
    const line = `${role}: ${text}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}
