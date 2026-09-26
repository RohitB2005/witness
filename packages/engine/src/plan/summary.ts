// App-map summary for the Planner (AI_AGENT_SPEC.md §3.1), built deterministically from the crawl's
// AI-mode snapshots. Per page: route, title, headings, fields (with dropdown options), buttons, in-page
// links and notable text (amounts, totals, sort/save/search wording). Site-wide navigation is listed once,
// and pages that share a layout are grouped, so the summary stays well under ~12k tokens.
import { createHash } from "node:crypto";
import type { PageState } from "../types";

export interface MapPage {
  state: Pick<PageState, "id" | "url" | "routePattern" | "title" | "session" | "status">;
  snapshot: string;
}

interface Parsed {
  headings: string[];
  fields: string[];
  buttons: string[];
  links: { text: string; url?: string }[];
  text: string[];
  landmarks: Set<string>;
}

const FIELD_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
  "checkbox",
  "radio",
  "slider",
  "switch",
  "listbox",
]);
const TEXT_ROLES = new Set([
  "paragraph",
  "text",
  "generic",
  "cell",
  "definition",
  "term",
  "listitem",
  "status",
  "alert",
  "strong",
  "emphasis",
  "caption",
  "note",
  "rowheader",
  "columnheader",
]);
const NOTABLE =
  /[$€£¥]\s?\d|\d[.,]\d{2}\b|\d\s?%|\b(total|subtotal|tax|price|cost|fee|sum|balance|due|sort|order by|save|saved|search|result|results|showing|count|items?|qty|quantity|required|error|success|confirm|upcoming|status)\b/i;

const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/;

function unquote(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

/** Pulls the useful parts out of one AI-mode snapshot. Pure. */
export function parseSnapshot(snapshot: string): Parsed {
  const out: Parsed = {
    headings: [],
    fields: [],
    buttons: [],
    links: [],
    text: [],
    landmarks: new Set(),
  };
  const lines = snapshot.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]!);
    if (!m) continue;
    const [, indent = "", role = "", rawName, rest = ""] = m;
    const name = rawName !== undefined ? unquote(rawName) : "";
    const inline = /:\s*"?(.+?)"?\s*$/.exec(rest.replace(/\[[^\]]*\]/g, ""))?.[1]?.trim();
    if (["banner", "navigation", "main", "contentinfo", "search", "form", "dialog"].includes(role))
      out.landmarks.add(role);
    if (role === "heading" && name) out.headings.push(name);
    else if (FIELD_ROLES.has(role)) {
      let desc = `${role}${name ? ` "${name}"` : ""}`;
      if (role === "combobox" || role === "listbox") {
        const opts: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const o = LINE.exec(lines[j]!);
          if (!o || (o[1] ?? "").length <= indent.length) break;
          if (o[2] === "option")
            opts.push(unquote(o[3] ?? "") + (/\[selected\]/.test(o[4] ?? "") ? " (selected)" : ""));
        }
        if (opts.length)
          desc += ` options: ${opts.slice(0, 12).join(" | ")}${opts.length > 12 ? ` | … ${opts.length - 12} more` : ""}`;
      }
      if (/\[required\]/.test(rest)) desc += " (required)";
      out.fields.push(desc);
    } else if (role === "button" && name) out.buttons.push(name);
    else if (role === "link" && name) {
      const next = lines[i + 1] ?? "";
      const url = /^\s*- \/url: (.+)$/.exec(next)?.[1]?.replace(/^"|"$/g, "");
      out.links.push({ text: name, url });
    } else if (TEXT_ROLES.has(role)) {
      const t = (inline ?? name).trim();
      if (t && t.length <= 160 && NOTABLE.test(t)) out.text.push(t);
    }
  }
  return out;
}

/** Layout fingerprint: roles and depth only (names removed), so /items/a and /items/b group together. */
function layoutKey(route: string, snapshot: string): string {
  const skeleton = snapshot
    .split("\n")
    .map((l) => LINE.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${(m[1] ?? "").length}${m[2]}`)
    .join(",");
  const parent = route.split("?")[0]!.split("/").slice(0, -1).join("/");
  return `${parent}|${createHash("sha256").update(skeleton).digest("hex").slice(0, 12)}`;
}

function uniq<T>(xs: T[], key: (x: T) => string = String): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function list(label: string, items: string[], max: number): string {
  if (!items.length) return "";
  const shown = items.slice(0, max).map((s) => (s.length > 90 ? `${s.slice(0, 87)}…` : s));
  return `  ${label}: ${shown.join("; ")}${items.length > max ? `; … ${items.length - max} more` : ""}`;
}

/** The summary text. `maxChars` ≈ 4 chars per token; default keeps it under ~12k tokens. */
export function buildAppMapSummary(pages: MapPage[], maxChars = 45_000): string {
  const ok = pages.filter((p) => (p.state.status ?? 200) < 400);
  const parsed = ok.map((p) => ({ page: p, parsed: parseSnapshot(p.snapshot) }));

  // Links present on (almost) every page are site navigation: list them once.
  const linkCounts = new Map<string, number>();
  for (const { parsed: p } of parsed)
    for (const l of uniq(p.links, (l) => `${l.text}|${l.url}`)) {
      const k = `${l.text} → ${l.url ?? "?"}`;
      linkCounts.set(k, (linkCounts.get(k) ?? 0) + 1);
    }
  const siteWide = new Set(
    [...linkCounts]
      .filter(([, n]) => n >= Math.max(2, Math.ceil(parsed.length * 0.6)))
      .map(([k]) => k),
  );

  // Group pages sharing a layout under the same parent path.
  const groups = new Map<string, typeof parsed>();
  for (const e of parsed) {
    const k = layoutKey(e.page.state.routePattern, e.page.snapshot);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }

  const sections: string[] = [];
  for (const group of groups.values()) {
    const { page, parsed: p } = group[0]!;
    const s = page.state;
    const others = group.slice(1).map((g) => g.page.state.routePattern);
    const lines = [
      `## ${s.routePattern}  "${s.title}"${s.session === "authenticated" ? "  (logged in)" : ""}`,
      others.length
        ? `  same layout: ${others.slice(0, 8).join(", ")}${others.length > 8 ? `, … ${others.length - 8} more` : ""}`
        : "",
      list("headings", uniq(p.headings), 10),
      list("fields", uniq(p.fields), 15),
      list("buttons", uniq(p.buttons), 15),
      list(
        "links",
        uniq(
          p.links
            .filter((l) => !siteWide.has(`${l.text} → ${l.url ?? "?"}`))
            .map((l) => `${l.text}${l.url ? ` → ${l.url}` : ""}`),
        ),
        12,
      ),
      list("text", uniq(p.text), 14),
    ].filter(Boolean);
    sections.push(lines.join("\n"));
  }
  const nav = [...siteWide].slice(0, 20);
  let text = [
    `Pages: ${ok.length} (${groups.size} distinct layouts)`,
    nav.length ? `Site navigation (on most pages): ${nav.join("; ")}` : "",
    ...sections,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n… (map truncated)`;
  return text;
}
