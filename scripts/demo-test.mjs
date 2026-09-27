// pnpm demo:test <path to an exported .spec.ts> (DEMO_RUNBOOK §1): runs one regression test against the
// bench. The test fails while its bug is on and passes once it's fixed (pnpm bench:fix <id>).
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "./env.mjs";
import { run } from "./procs.mjs";

loadEnv();
const arg = process.argv[2];
if (!arg) {
  console.error(
    "Usage: pnpm demo:test <path to an exported .spec.ts>  (e.g. runs/<run id>/tests/fd_xxx.spec.ts)",
  );
  process.exit(1);
}
const spec = path.resolve(process.env.INIT_CWD ?? process.cwd(), arg);
const dir = path.dirname(spec);
if (
  !existsSync(spec) ||
  !/\.spec\.ts$/.test(spec) ||
  !existsSync(path.join(dir, "playwright.config.ts"))
) {
  console.error(
    `Not an exported Witness test: ${spec}\n(Use "Download test" on a finding, or a file in runs/<run id>/tests/.)`,
  );
  process.exit(1);
}
const base = process.env.WITNESS_BASE_URL ?? `http://localhost:${process.env.BENCH_PORT ?? 5180}`;
console.log(`Running ${path.basename(spec)} against ${base}\n`);
const code = await run(
  "playwright",
  ["test", "-c", dir, path.basename(spec).replace(/\./g, "\\.")],
  {
    env: {
      WITNESS_BASE_URL: base,
      WITNESS_TEST_USER: process.env.WITNESS_TEST_USER ?? process.env.BENCH_TEST_EMAIL ?? "",
      WITNESS_TEST_PASSWORD:
        process.env.WITNESS_TEST_PASSWORD ?? process.env.BENCH_TEST_PASSWORD ?? "",
    },
  },
);
console.log(
  code === 0
    ? "\nPASSED: the app behaves correctly here."
    : "\nFAILED: the bug is still there (this test stays red until it's fixed).",
);
process.exit(code);
