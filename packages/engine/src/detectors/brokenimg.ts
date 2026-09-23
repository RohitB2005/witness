// DET-BROKENIMG — an <img> whose request returned 4xx/5xx, or that finished loading with no pixels.
import type { CandidateDraft, PageDetector } from "./types";

interface ImgProbe {
  src: string;
  alt: string;
  complete: boolean;
  naturalWidth: number;
}

export const brokenImgDetector: PageDetector = {
  id: "DET-BROKENIMG",
  viewport: "desktop",
  async run({ page, capture, evidence, state }) {
    const images: ImgProbe[] = await page
      .evaluate(() =>
        Array.from(document.images).map((img) => ({
          src: img.currentSrc || img.src,
          alt: img.alt,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
        })),
      )
      .catch(() => []);
    const failedStatus = new Map<string, number>();
    for (const e of capture.slice.network) {
      if (e.resourceType === "image" && e.status !== undefined && e.status >= 400) {
        failedStatus.set(e.path, e.status);
      }
    }
    const broken = new Map<string, { img: ImgProbe; status?: number; path: string }>();
    for (const img of images) {
      if (!img.src || img.src.startsWith("data:")) continue;
      let url: URL;
      try {
        url = new URL(img.src);
      } catch {
        continue;
      }
      const status = failedStatus.get(url.pathname);
      // `complete && naturalWidth === 0` = the browser gave up on it; lazy images that never started aren't complete.
      if (status !== undefined || (img.complete && img.naturalWidth === 0)) {
        broken.set(url.href, { img, status, path: url.pathname });
      }
    }
    if (broken.size === 0) return [];
    const probeId = await evidence.put(
      "dom_probe",
      {
        probe: "broken-images",
        images: [...broken.values()].map((b) => ({ ...b.img, status: b.status })),
      },
      { stateId: state.id },
    );
    const out: CandidateDraft[] = [];
    for (const [href, { img, status, path }] of broken) {
      const label = img.alt ? `"${img.alt}"` : path;
      out.push({
        kind: "bug",
        source: { kind: "detector", id: "DET-BROKENIMG" },
        category: "broken-resource",
        signature: { kind: "detector", detectorId: "DET-BROKENIMG", key: path },
        groupKey: `brokenimg|${href}`,
        signals: status !== undefined ? { request: { method: "GET", path, status } } : {},
        detail: {
          title: `Image doesn't load: ${label}`,
          impact: "Visitors see a broken image placeholder instead of the picture.",
          expected: `The image ${path} loads and displays.`,
          actual:
            status !== undefined
              ? `The image request returned HTTP ${status}.`
              : "The image finished loading with no content (width 0).",
          whyFlagged: "DET-BROKENIMG: an <img> failed to load (always a bug).",
        },
        summary: `Broken image ${path}`,
        evidenceIds: [probeId, capture.evidence.network],
      });
    }
    return out;
  },
};
