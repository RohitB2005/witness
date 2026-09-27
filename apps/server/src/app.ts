// REST + SSE API for the dashboard (ARCHITECTURE §7). Local tool: it only answers requests addressed to
// localhost (SECURITY T11, and against DNS rebinding), never sends CORS headers, and resolves every file
// it serves inside the run's folder from validated IDs (T8).
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  RUN_ID_PATTERN,
  renderHtml,
  renderMarkdown,
  type RunResult,
  type RunStore,
  type WitnessEvent,
} from "@witness/engine";
import { BusyError, InputError, NewScanSchema, type ScanManager } from "./scans";

export interface AppOptions {
  store: RunStore;
  scans: ScanManager;
  /** Folder of evaluation results (summary.json files, EVALUATION.md). */
  evalDir: string;
  /** Built dashboard (apps/web/dist); served with an SPA fallback when present. */
  webDir?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const FINDING_ID = /^fd_[a-z0-9]+$/;
const ARTIFACT = /^ev_[a-z0-9]+\.(jpg|yaml)$/;
const FINGERPRINT = /^fp_[0-9a-f]{16}$/;
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".yaml": "text/yaml; charset=utf-8",
};

function hostname(host: string | undefined): string {
  if (!host) return "";
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
}

/** Only requests addressed to this machine, and writes only from the dashboard's own origin. */
function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (!LOCAL_HOSTS.has(hostname(req.headers.host))) {
    res.status(403).json({ error: "This server only answers requests to localhost." });
    return;
  }
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin) {
    let ok: boolean;
    try {
      ok = LOCAL_HOSTS.has(new URL(origin).hostname);
    } catch {
      ok = false;
    }
    if (!ok) {
      res.status(403).json({ error: "Requests from other sites aren't accepted." });
      return;
    }
  }
  next();
}

export function createApp(o: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(localOnly);
  app.use(express.json({ limit: "64kb" }));

  const runId = (req: Request, res: Response): string | undefined => {
    const id = String(req.params.id ?? "");
    if (!RUN_ID_PATTERN.test(id)) {
      res.status(400).json({ error: "That isn't a run ID." });
      return undefined;
    }
    return id;
  };
  const finished = async (req: Request, res: Response): Promise<RunResult | undefined> => {
    const id = runId(req, res);
    if (!id) return undefined;
    const r = await o.store.getResult(id);
    if (!r) {
      res
        .status(o.scans.isLive(id) ? 409 : 404)
        .json({ error: o.scans.isLive(id) ? "This scan is still running." : "No such run." });
      return undefined;
    }
    return r;
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, live: o.scans.live ?? null });
  });

  app.get("/api/scans", async (_req, res) => {
    const live = o.scans.live;
    const runs = (await o.store.listRuns()).map((r) => ({
      ...r,
      live: live?.runId === r.runId,
    }));
    res.json({ live: live ?? null, runs });
  });

  app.post("/api/scans", (req, res) => {
    const parsed = NewScanSchema.safeParse(req.body);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      res
        .status(400)
        .json({ error: `Check the form: ${i?.path.join(".") || "input"} — ${i?.message}` });
      return;
    }
    try {
      res.status(201).json(o.scans.start(parsed.data));
    } catch (err) {
      if (err instanceof BusyError) res.status(409).json({ error: err.message, runId: err.runId });
      else if (err instanceof InputError) res.status(400).json({ error: err.message });
      else throw err;
    }
  });

  app.get("/api/scans/:id", async (req, res) => {
    const r = await finished(req, res);
    if (r) res.json({ ...r, live: false });
  });

  app.get("/api/scans/:id/events", async (req, res) => {
    const id = runId(req, res);
    if (!id) return;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    // Tells the dashboard whether this stream is a scan happening now or a finished run's record.
    res.write(`event: hello\ndata: ${JSON.stringify({ live: o.scans.isLive(id) })}\n\n`);
    let closed = false;
    const send = (e: WitnessEvent | "end") => {
      if (closed) return;
      if (e === "end") {
        res.write("event: end\ndata: {}\n\n");
        closed = true;
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const unsubscribe = await o.scans.subscribe(id, send);
    if (!unsubscribe) {
      res.write(`event: missing\ndata: {}\n\n`);
      res.end();
      return;
    }
    const beat = setInterval(() => !closed && res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      closed = true;
      clearInterval(beat);
      unsubscribe();
    });
  });

  app.post("/api/scans/:id/plan", (req, res) => {
    const id = runId(req, res);
    if (!id) return;
    const body = z
      .strictObject({ approvedJourneyIds: z.array(z.string().regex(/^jr_[a-z0-9]+$/)).max(20) })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "approvedJourneyIds must be a list of journey IDs." });
      return;
    }
    if (!o.scans.approve(id, body.data.approvedJourneyIds))
      res.status(409).json({ error: "No plan is waiting for review in this run." });
    else res.json({ ok: true });
  });

  app.post("/api/scans/:id/cancel", (req, res) => {
    const id = runId(req, res);
    if (!id) return;
    if (!o.scans.cancel(id)) res.status(409).json({ error: "This run isn't running." });
    else res.json({ ok: true });
  });

  app.get("/api/scans/:id/artifacts/:file", async (req, res) => {
    const id = runId(req, res);
    if (!id) return;
    const file = String(req.params.file ?? "");
    const dir = path.resolve(o.store.runDir(id), "artifacts");
    const full = path.resolve(dir, file);
    if (!ARTIFACT.test(file) || path.dirname(full) !== dir) {
      res.status(400).json({ error: "That isn't an artifact name." });
      return;
    }
    if (!existsSync(full)) {
      res.status(404).json({ error: "No such artifact." });
      return;
    }
    res.setHeader("Content-Type", TYPES[path.extname(file)]!);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(await readFile(full));
  });

  /** The first screenshot among a finding's evidence (FR-10's evidence image). */
  app.get("/api/scans/:id/findings/:fid/screenshot", async (req, res) => {
    const r = await finished(req, res);
    if (!r) return;
    const f = r.findings.find((x) => x.id === req.params.fid);
    if (!f || !FINDING_ID.test(f.id)) {
      res.status(404).json({ error: "No such finding." });
      return;
    }
    for (const evId of f.evidenceIds) {
      const ev = await o.store.getEvidence(r.runId, evId);
      if (ev?.kind !== "screenshot" || !ev.path) continue;
      const full = path.resolve(o.store.runDir(r.runId), ev.path);
      if (!full.startsWith(path.resolve(o.store.runDir(r.runId), "artifacts") + path.sep)) continue;
      if (!existsSync(full)) continue;
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(await readFile(full));
      return;
    }
    res.status(404).json({ error: "This finding has no screenshot." });
  });

  app.get("/api/scans/:id/findings/:fid/test", async (req, res) => {
    const r = await finished(req, res);
    if (!r) return;
    const f = r.findings.find((x) => x.id === req.params.fid);
    const name = f?.testFile;
    if (!f || !name || !/^fd_[a-z0-9]+\.spec\.ts$/.test(name)) {
      res.status(404).json({ error: "No regression test was exported for this finding." });
      return;
    }
    const full = path.join(o.store.runDir(r.runId), "tests", name);
    if (!existsSync(full)) {
      res.status(404).json({ error: "The test file is missing." });
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(await readFile(full, "utf8"));
  });

  app.get("/api/scans/:id/export", async (req, res) => {
    const r = await finished(req, res);
    if (!r) return;
    const format = String(req.query.format ?? "html");
    const dir = o.store.runDir(r.runId);
    const files = { html: "report.html", md: "report.md", json: "report.json" } as const;
    if (!(format in files)) {
      res.status(400).json({ error: "format must be html, md or json." });
      return;
    }
    const name = files[format as keyof typeof files];
    const saved = path.join(dir, name);
    const body = existsSync(saved)
      ? await readFile(saved, "utf8")
      : format === "html"
        ? renderHtml(r)
        : format === "md"
          ? renderMarkdown(r)
          : JSON.stringify(r, null, 2);
    const type = { html: "text/html", md: "text/markdown", json: "application/json" }[format]!;
    res.setHeader("Content-Type", `${type}; charset=utf-8`);
    res.setHeader("Content-Disposition", `attachment; filename="witness-${r.runId}.${format}"`);
    res.send(body);
  });

  // "Not a bug" (FR-12): stored in data/suppressions.json for this origin. Never touches eval labels.
  app.post("/api/suppressions", async (req, res) => {
    const body = z
      .strictObject({
        origin: z.string().max(300),
        fingerprint: z.string().regex(FINGERPRINT),
        reason: z.string().trim().min(3).max(300),
      })
      .safeParse(req.body);
    let origin: string | undefined;
    try {
      origin = body.success ? new URL(body.data.origin).origin : undefined;
    } catch {
      origin = undefined;
    }
    if (!body.success || !origin || origin === "null") {
      res
        .status(400)
        .json({ error: "Give the app's origin, the finding's fingerprint and a reason." });
      return;
    }
    const existing = await o.store.getSuppressions(origin);
    if (!existing.some((s) => s.fingerprint === body.data.fingerprint))
      await o.store.addSuppression({
        origin,
        fingerprint: body.data.fingerprint,
        reason: body.data.reason,
        createdAt: new Date().toISOString(),
      });
    res.status(201).json({ ok: true });
  });

  app.get("/api/suppressions", async (req, res) => {
    const origin = typeof req.query.origin === "string" ? req.query.origin : undefined;
    res.json({ suppressions: await o.store.getSuppressions(origin) });
  });

  // Evaluation page: the most recent results folder's first summary, and the others to switch to.
  app.get("/api/eval/latest", async (req, res) => {
    const all = await evalSummaries(o.evalDir);
    if (!all.length) {
      res.status(404).json({ error: "No evaluation results yet (run pnpm eval:score)." });
      return;
    }
    const wanted = typeof req.query.path === "string" ? req.query.path : undefined;
    const pick = wanted ? all.find((s) => s.path === wanted) : all[0];
    if (!pick) {
      res.status(404).json({ error: "No such summary." });
      return;
    }
    res.json({
      path: pick.path,
      summary: JSON.parse(await readFile(path.join(o.evalDir, pick.path), "utf8")) as unknown,
      available: all.map((s) => ({ path: s.path, generatedAt: s.generatedAt })),
    });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "No such API route." });
  });

  if (o.webDir && existsSync(o.webDir)) {
    app.use(express.static(o.webDir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(o.webDir!, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Never echo the request (it may hold a password); a short message only.
    const message =
      err instanceof SyntaxError ? "The request body isn't valid JSON." : "Server error.";
    if (!(err instanceof SyntaxError)) console.error(err instanceof Error ? err.stack : err);
    if (!res.headersSent)
      res.status(err instanceof SyntaxError ? 400 : 500).json({ error: message });
  });
  return app;
}

async function evalSummaries(dir: string): Promise<{ path: string; generatedAt: string }[]> {
  const out: { path: string; generatedAt: string }[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const abs = path.join(dir, rel);
    for (const name of await readdir(abs).catch(() => [] as string[])) {
      const r = path.join(rel, name);
      const s = await stat(path.join(dir, r)).catch(() => undefined);
      if (s?.isDirectory()) await walk(r, depth + 1);
      else if (name === "summary.json") {
        try {
          const j = JSON.parse(await readFile(path.join(dir, r), "utf8")) as {
            generatedAt?: string;
          };
          out.push({ path: r.split(path.sep).join("/"), generatedAt: j.generatedAt ?? "" });
        } catch {
          // Not a summary we can read.
        }
      }
    }
  };
  await walk("", 0);
  // Newest results folder first (e.g. p3b-gate/); inside it, alphabetical, so a folder's scores keep a
  // stable order (labelled/ before the raw gate scores, v1 before v2).
  const top = (p: string) => p.split("/")[0]!;
  const newest = new Map<string, string>();
  for (const s of out)
    if ((newest.get(top(s.path)) ?? "") < s.generatedAt) newest.set(top(s.path), s.generatedAt);
  return out.sort(
    (a, b) =>
      newest.get(top(b.path))!.localeCompare(newest.get(top(a.path))!) || a.path.localeCompare(b.path),
  );
}
