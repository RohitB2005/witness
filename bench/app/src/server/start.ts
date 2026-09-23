// Starts the Harbour Clean server. Used by scripts/serve.ts (production) and scripts/dev.ts (API only).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { parseBugList, setActiveBugs, getActiveBugs } from "../shared/bugs";
import { createApp } from "./app";
import { Store } from "./store";

export const BENCH_APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = path.resolve(BENCH_APP_DIR, "..", "..");

/**
 * Loads the repo-root .env if present. Variables already set in the environment win, so
 * `bench:test` can force BENCH_BUGS=none even when .env says "all".
 */
export function loadRootEnv(): void {
  const envFile = path.join(REPO_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export interface StartOptions {
  port: number;
  host?: string;
  staticDir?: string;
}

export async function startServer({
  port,
  host = "localhost",
  staticDir,
}: StartOptions): Promise<Server> {
  setActiveBugs(parseBugList(process.env.BENCH_BUGS));
  const app = createApp({ store: new Store(), staticDir });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, (error?: Error) => {
      if (error) return reject(error);
      const active = getActiveBugs();
      console.log(
        `[bench] Harbour Clean on http://${host}:${port} — bugs: ${active.length === 0 ? "none" : active.join(",")}`,
      );
      resolve(server);
    });
  });
}
