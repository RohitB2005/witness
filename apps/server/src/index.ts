// witness dashboard server: `pnpm dev` / `pnpm demo:up`. Binds 127.0.0.1 only (SECURITY T11).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JsonRunStore,
  LlmConfigError,
  createModels,
  llmSettingsFromEnv,
  newRunId,
  runScan,
} from "@witness/engine";
import { createApp } from "./app";
import { ScanManager } from "./scans";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const PORT = Number(process.env.WITNESS_PORT ?? 4317);
const HOST = "127.0.0.1";
const cacheDir = path.join(REPO_ROOT, ".witness-cache");
const store = new JsonRunStore({
  runsDir: path.resolve(REPO_ROOT, process.env.WITNESS_RUNS_DIR ?? "runs"),
  dataDir: path.join(REPO_ROOT, "data"),
});

const scans = new ScanManager({
  store,
  runner: runScan,
  llmCacheDir: cacheDir,
  newRunId,
  models: () => {
    try {
      const settings = llmSettingsFromEnv(process.env, cacheDir);
      return { models: createModels(settings), maxCostUsd: settings.maxCostUsd };
    } catch (err) {
      return { unavailable: err instanceof LlmConfigError ? err.message : String(err) };
    }
  },
});

const app = createApp({
  store,
  scans,
  evalDir: path.join(REPO_ROOT, "eval", "results"),
  webDir: path.join(REPO_ROOT, "apps", "web", "dist"),
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Witness dashboard: http://localhost:${PORT}`);
  if (!existsSync(path.join(REPO_ROOT, "apps", "web", "dist", "index.html")))
    console.log(
      "(The dashboard isn't built yet: run pnpm --filter @witness/web build, or use pnpm dev.)",
    );
});
server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(
    err.code === "EADDRINUSE"
      ? `Port ${PORT} is in use. Is Witness already running? (Set WITNESS_PORT to use another port.)`
      : err.message,
  );
  process.exit(1);
});
