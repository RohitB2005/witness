// Dev bench: Vite with HMR on :5173 proxying /api and /__bench to the API on :5174.
import { createServer } from "vite";
import { BENCH_APP_DIR, loadRootEnv, startServer } from "../src/server/start";

loadRootEnv();

const apiPort = Number(process.env.BENCH_API_PORT ?? 5174);
await startServer({ port: apiPort });
const vite = await createServer({ root: BENCH_APP_DIR });
await vite.listen();
vite.printUrls();
