// Runtime control of a running bench (Node, not curl: PowerShell aliases `curl`).
//   pnpm bench:reset          restore seed data
//   pnpm bench:fix B01        turn a bug flag off ("simulate the fix")
//   pnpm bench:break B01      turn it back on
//   pnpm bench:status         show active flags
import { loadEnv } from "./env.mjs";

loadEnv();
const base = `http://localhost:${process.env.BENCH_PORT ?? 5180}`;
const [command, ...ids] = process.argv.slice(2);

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    console.error(`Can't reach the bench at ${base}. Is it running? (pnpm bench:serve)`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Bench refused: ${data.error ?? res.status}`);
    process.exit(1);
  }
  return data;
}

const showActive = (active) =>
  console.log(`Active bugs: ${active.length === 0 ? "none" : active.join(", ")}`);

switch (command) {
  case "reset":
    await call("POST", "/__bench/reset");
    console.log("Bench data restored to the seed.");
    break;
  case "fix":
  case "break": {
    if (ids.length === 0) {
      console.error(`Usage: pnpm bench:${command} B01 [B02 ...]`);
      process.exit(1);
    }
    const key = command === "fix" ? "disable" : "enable";
    const data = await call("POST", "/__bench/bugs", { [key]: ids.map((id) => id.toUpperCase()) });
    console.log(`${command === "fix" ? "Fixed" : "Broke"}: ${ids.join(", ").toUpperCase()}`);
    showActive(data.active);
    break;
  }
  case "status":
    showActive((await call("GET", "/__bench/bugs")).active);
    break;
  default:
    console.error("Usage: bench-control.mjs reset | fix <ids> | break <ids> | status");
    process.exit(1);
}
