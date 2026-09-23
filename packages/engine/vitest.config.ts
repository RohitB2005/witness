import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "engine",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    passWithNoTests: true,
    // Many engine tests drive a real Chromium against fixture servers.
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
