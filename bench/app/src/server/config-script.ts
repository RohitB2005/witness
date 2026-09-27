// The app's runtime config script (GET /config.js), loaded by index.html before the bundle.
//
// Fake keys are assembled from fragments at runtime, so the served script matches real key patterns
// while the repo never contains a full key literal (GitHub push protection; ADDENDUM_QA_COVERAGE.md).
// Both are obviously fake to a human reader.
import { isBugOn } from "../shared/bugs";

const FAKE_TAIL = ["WITNESS", "BENCH", "FAKE", "DONOTUSE", "0000"];

/** Decoy D05: a publishable key is meant to be public, so exposing it is not a bug. */
export function publishableKey(): string {
  return ["pk", "live", FAKE_TAIL.join("") + "PUBLIC"].join("_");
}

/** B19: a server-side secret key that must never reach the browser. */
export function serverSecretKey(): string {
  return ["sk", "live", FAKE_TAIL.join("") + "SECRET"].join("_");
}

export function configScript(): string {
  const config: Record<string, unknown> = {
    payments: {
      provider: "card",
      publishableKey: publishableKey(),
      // B19: the server's secret key is shipped to the browser alongside the publishable one
      ...(isBugOn("B19") ? { secretKey: serverSecretKey() } : {}),
    },
    support: { email: "help@harbourclean.test" },
  };
  return `window.__HARBOUR_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
}
