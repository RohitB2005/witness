import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = Number(process.env.BENCH_API_PORT ?? 5174);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/__bench": `http://localhost:${apiPort}`,
      "/config.js": `http://localhost:${apiPort}`,
    },
  },
  // Hidden source maps: built, but not referenced from the bundle. The server serves them only with
  // B20 on (and then adds a SourceMap header).
  build: { outDir: "dist", emptyOutDir: true, sourcemap: "hidden" },
});
