// Prefixed short IDs (CLAUDE.md): run_, st_, sp_, ev_, jr_, ex_, cd_, fd_.
import { randomBytes } from "node:crypto";

export type IdPrefix = "run" | "st" | "sp" | "ev" | "jr" | "ex" | "cd" | "fd";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A random 8-character base-36 suffix: ~41 bits, plenty for one run's objects. */
export function newId(prefix: IdPrefix, length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Run IDs also carry a sortable timestamp so `runs/` lists in time order. */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `run_${stamp}_${newId("run", 4).slice(4)}`;
}

export const RUN_ID_PATTERN = /^run_[0-9]{8}-[0-9]{6}_[0-9a-z]{4}$/;
