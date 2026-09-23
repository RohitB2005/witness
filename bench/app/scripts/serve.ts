// Production bench: Express serves the built frontend and the API on one port (default 5180).
// Usage: tsx scripts/serve.ts [--port 5199] [--build]
import path from "node:path";
import { existsSync } from "node:fs";
import { build } from "vite";
import { BENCH_APP_DIR, loadRootEnv, startServer } from "../src/server/start";

loadRootEnv();

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const port = Number(portArg >= 0 ? args[portArg + 1] : (process.env.BENCH_PORT ?? 5180));
const distDir = path.join(BENCH_APP_DIR, "dist");

if (args.includes("--build")) {
  await build({ root: BENCH_APP_DIR, logLevel: "warn" });
}
if (!existsSync(path.join(distDir, "index.html"))) {
  console.error("[bench] No production build found. Run `pnpm bench:build` first.");
  process.exit(1);
}
await startServer({ port, staticDir: distDir });
