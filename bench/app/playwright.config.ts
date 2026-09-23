import { defineConfig, devices } from "@playwright/test";

// The bench's own tests. They always run against a fresh production build on a dedicated port with
// every bug flag off, so they never touch a demo bench that may be running on :5180.
const port = Number(process.env.BENCH_TEST_PORT ?? 5199);

export default defineConfig({
  testDir: "tests",
  workers: 1, // one in-memory server: tests share state, so run them serially
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    // Every test with all flags off: the clean app must pass all of them.
    { name: "clean" },
    // Each bug test again with only its own flag on; the fixture marks it as expected to fail.
    { name: "flagged", testMatch: /bugs\.spec\.ts$/, grep: /@(B\d\d|C01)\b/ },
  ],
  webServer: {
    command: `tsx scripts/serve.ts --build --port ${port}`,
    url: `http://localhost:${port}/__bench/bugs`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BENCH_BUGS: "none" },
    stdout: "ignore",
    stderr: "pipe",
  },
});
