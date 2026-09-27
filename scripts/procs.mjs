// Starting and stopping child processes for the dev and demo scripts (Node only, so they run in PowerShell).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./env.mjs";

const children = [];
/** A package binary: the working folder's own node_modules first (vite lives in each app), then the root's. */
const bin = (name, cwd = REPO_ROOT) => {
  const file = process.platform === "win32" ? `${name}.cmd` : name;
  const local = path.join(cwd, "node_modules", ".bin", file);
  return existsSync(local) ? local : path.join(REPO_ROOT, "node_modules", ".bin", file);
};

/** Runs a repo-local binary (tsx, vite, playwright…) with a name prefix on its output. */
export function start(name, cmd, args, opts = {}) {
  const child = spawn(bin(cmd, opts.cwd), args, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const tag = `[${name}] `;
  const pipe = (stream, out) =>
    stream.on("data", (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) out.write(tag + line + "\n");
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping && opts.required !== false) {
      console.error(`${tag}stopped (exit ${code}). Stopping everything.`);
      stopAll(1);
    }
  });
  return child;
}

/** Runs a command to completion; resolves with its exit code. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin(cmd, opts.cwd), args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let stopping = false;
export function stopAll(code = 0) {
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

/** Waits until `url` answers (any HTTP status), or gives up after `ms`. */
export async function waitFor(url, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}
