import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { isBugId, setActiveBugs } from "../shared/bugs";
import { App } from "./App";
import { AuthProvider } from "./auth";
import "./index.css";

// Load the active bug flags once, before the first render (BENCH_SPEC §1).
async function loadBugFlags(): Promise<void> {
  try {
    const res = await fetch("/__bench/bugs");
    const body = (await res.json()) as { active?: unknown };
    const ids = Array.isArray(body.active)
      ? body.active.filter((v): v is string => typeof v === "string")
      : [];
    setActiveBugs(ids.filter(isBugId));
  } catch {
    setActiveBugs([]);
  }
}

await loadBugFlags();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
