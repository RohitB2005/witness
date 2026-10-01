// Demo settings (DEMO_RUNBOOK §4): only when `pnpm demo:up` starts the server with `--demo <bench URL>`.
// The New scan page fills itself from GET /api/demo, which never includes the password: the form sends
// `useDemoAccount: true` and the server puts the password from .env into the scan's vault (SECURITY T5),
// so it stays out of URLs, browser history and run files.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface DemoSettings {
  url: string;
  mode: "staging";
  budget: "demo";
  account?: { username: string; password: string };
  requirements?: { file: string; text: string };
}

/** What the dashboard may see: everything but the password. */
export interface PublicDemoSettings extends Omit<DemoSettings, "account"> {
  account?: { username: string };
}

const MAX_REQUIREMENTS = 5000;

/** Builds the demo settings from .env's test account and the requirements file. */
export function loadDemoSettings(o: {
  url: string;
  env: NodeJS.ProcessEnv;
  requirementsFile: string;
  warn?: (message: string) => void;
}): DemoSettings {
  const warn = o.warn ?? (() => {});
  const username = o.env.WITNESS_TEST_USER?.trim();
  const password = o.env.WITNESS_TEST_PASSWORD;
  let requirements: DemoSettings["requirements"];
  if (!existsSync(o.requirementsFile)) {
    warn(`Demo settings: ${o.requirementsFile} not found; requirements left empty.`);
  } else {
    const text = readFileSync(o.requirementsFile, "utf8");
    if (text.length > MAX_REQUIREMENTS)
      warn(
        `Demo settings: ${o.requirementsFile} is over 5,000 characters; requirements left empty.`,
      );
    else requirements = { file: path.basename(o.requirementsFile), text };
  }
  if (!username || !password)
    warn(
      "Demo settings: WITNESS_TEST_USER and WITNESS_TEST_PASSWORD aren't both set in .env; no test account.",
    );
  return {
    url: o.url,
    mode: "staging",
    budget: "demo",
    ...(username && password ? { account: { username, password } } : {}),
    ...(requirements ? { requirements } : {}),
  };
}

export function publicDemo(d: DemoSettings): PublicDemoSettings {
  const { account, ...rest } = d;
  return { ...rest, ...(account ? { account: { username: account.username } } : {}) };
}
