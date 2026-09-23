// Loads the repo-root .env (if present) without overriding variables already set.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv() {
  const file = path.join(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
