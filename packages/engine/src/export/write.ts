// Writes a finished run's exports into its folder (and optionally another folder): report.md, report.json,
// a self-contained report.html, and tests/ with one Playwright spec per exportable bug (FR-10, FR-11).
// Everything written passes through `redact` (vault values → placeholders), as every store write does.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHtml } from "../report/html";
import { renderMarkdown } from "../report/markdown";
import type { RunStore } from "../store/run-store";
import type { RunResult } from "../types";
import { exportTests } from "./playwright";

export type ExportFormat = "md" | "json" | "html";

const MAX_INLINE_BYTES = 8 * 1024 * 1024;

export async function writeRunExports(
  store: RunStore,
  result: RunResult,
  opts: {
    formats: Set<ExportFormat>;
    redact: (s: string) => string;
    outDir?: string;
    tests?: boolean;
  },
): Promise<{
  written: string[];
  tests: number;
  testsSkipped: { findingId: string; reason: string }[];
}> {
  const runDir = store.runDir(result.runId);
  const written: string[] = [];
  const put = async (dir: string, name: string, content: string) => {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, opts.redact(content));
    written.push(file);
  };

  let tests = 0;
  let testsSkipped: { findingId: string; reason: string }[] = [];
  if (opts.tests !== false) {
    const out = exportTests(result);
    for (const f of out.files) await put(runDir, path.join("tests", f.name), f.content);
    for (const f of result.findings) {
      const file = out.tests.get(f.id);
      if (file) f.testFile = file;
    }
    tests = out.tests.size;
    testsSkipped = out.skipped;
    await store.saveResult(result); // run.json now records each finding's test file
  }

  const docs: [string, () => Promise<string>][] = [];
  if (opts.formats.has("md")) docs.push(["report.md", async () => renderMarkdown(result)]);
  if (opts.formats.has("json"))
    docs.push(["report.json", async () => JSON.stringify(result, null, 2)]);
  if (opts.formats.has("html"))
    docs.push([
      "report.html",
      async () => renderHtml(result, { images: await screenshots(store, result) }),
    ]);
  for (const [name, render] of docs) {
    const content = await render();
    await put(runDir, name, content);
    if (opts.outDir) await put(path.resolve(opts.outDir), name, content);
  }
  return { written, tests, testsSkipped };
}

/** The first screenshot of each reported finding, as data URIs (at most 8 MB in all). */
async function screenshots(store: RunStore, result: RunResult): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let total = 0;
  for (const f of result.findings) {
    if (f.tier === "discarded") continue;
    for (const id of f.evidenceIds) {
      const ev = await store.getEvidence(result.runId, id).catch(() => undefined);
      if (ev?.kind !== "screenshot" || !ev.path) continue;
      const bytes = await readFile(path.join(store.runDir(result.runId), ev.path)).catch(
        () => undefined,
      );
      if (!bytes || total + bytes.length > MAX_INLINE_BYTES) break;
      total += bytes.length;
      out.set(id, `data:image/jpeg;base64,${bytes.toString("base64")}`);
      break;
    }
  }
  return out;
}
