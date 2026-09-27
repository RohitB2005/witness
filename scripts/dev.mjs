// pnpm dev: the Witness server (restarts on change) and the dashboard's Vite dev server (hot reload).
import path from "node:path";
import { REPO_ROOT, loadEnv } from "./env.mjs";
import { start, waitFor } from "./procs.mjs";

loadEnv();
const port = process.env.WITNESS_PORT ?? "4317";
start("server", "tsx", ["watch", path.join("apps", "server", "src", "index.ts")]);
start("web", "vite", [], { cwd: path.join(REPO_ROOT, "apps", "web") });
if (await waitFor("http://127.0.0.1:5317"))
  console.log(
    `\nDashboard (dev, hot reload): http://localhost:5317   API: http://localhost:${port}\n`,
  );
