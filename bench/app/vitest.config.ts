import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bench",
    include: ["src/**/*.test.ts"],
  },
});
