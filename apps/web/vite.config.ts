import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = Number(process.env.WITNESS_PORT ?? 4317);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5317,
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
