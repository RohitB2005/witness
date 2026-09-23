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
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
