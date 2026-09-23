// DET-OVERFLOW — at phone width (375 × 667), the page scrolls sideways. Reports the widest offending
// element so a developer knows where to look.
import type { CandidateDraft, PageDetector } from "./types";
import { pathOf } from "./util";

export interface OverflowProbe {
  scrollWidth: number;
  clientWidth: number;
  offender?: { selector: string; width: number; right: number; text: string };
}

/** Runs in the page. Exported so tests can call it on fixture pages. */
export function probeOverflow(): OverflowProbe {
  const root = document.documentElement;
  const clientWidth = root.clientWidth;
  const scrollWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
  if (scrollWidth <= clientWidth + 1) return { scrollWidth, clientWidth };
  let best: OverflowProbe["offender"];
  for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= clientWidth + 1) continue;
    const style = getComputedStyle(el);
    if (style.position === "fixed" || style.visibility === "hidden") continue;
    // Prefer the widest element that sticks out: that's usually the cause, not its children.
    if (!best || r.width > best.width) {
      // (Inline, no helper functions: this body is serialised into the page by page.evaluate.)
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : "";
      best = {
        selector: `${el.tagName.toLowerCase()}${id}${cls}`,
        width: Math.round(r.width),
        right: Math.round(r.right),
        text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
      };
    }
  }
  return { scrollWidth, clientWidth, offender: best };
}

export const overflowDetector: PageDetector = {
  id: "DET-OVERFLOW",
  viewport: "mobile",
  async run({ page, evidence, state, mobileViewport }) {
    const probe = await page.evaluate(probeOverflow).catch(() => undefined);
    if (!probe || probe.scrollWidth <= probe.clientWidth + 1) return [];
    const probeId = await evidence.put(
      "dom_probe",
      { probe: "overflow", viewport: mobileViewport, ...probe },
      { stateId: state.id },
    );
    const shotId = await evidence.screenshot(page, { stateId: state.id, label: "phone width" });
    const where = probe.offender
      ? ` The widest element sticking out is ${probe.offender.selector} (${probe.offender.width} px wide).`
      : "";
    const out: CandidateDraft = {
      kind: "bug",
      source: { kind: "detector", id: "DET-OVERFLOW" },
      category: "responsive",
      signature: { kind: "detector", detectorId: "DET-OVERFLOW", key: pathOf(state.routePattern) },
      // /book and /book?service are the same page layout: group by path, not by query.
      groupKey: `overflow|${pathOf(state.routePattern)}`,
      signals: {},
      detail: {
        title: `Page scrolls sideways on a phone (${probe.scrollWidth} px content in a ${probe.clientWidth} px screen)`,
        impact:
          "On a phone, part of this page is cut off and visitors have to scroll sideways to reach it.",
        expected: `At ${mobileViewport.width} × ${mobileViewport.height} the page fits the screen width.`,
        actual: `The page is ${probe.scrollWidth} px wide on a ${probe.clientWidth} px screen.${where}`,
        whyFlagged:
          "DET-OVERFLOW: horizontal overflow at phone width (scrollWidth > clientWidth + 1).",
      },
      summary: `Overflow at ${mobileViewport.width} px`,
      evidenceIds: [probeId, shotId],
    };
    return [out];
  },
};
