// Automatic probes (P3, D46): deterministic checks Witness runs by itself after the crawl, with no LLM.
// They run alongside the AI stages (their own browsers; nothing they do writes data), and in the
// deterministic pipeline on their own.
// - DET-SORT: each sort option on the unfiltered list (both modes; read-only).
// - Interaction sweep: collapsed accordions, disclosures and tabs, clicked once (staging mode only).
// - Reflected input: the inert canary in GET parameters and search boxes, then DET-XSS (both modes).
import { candidateEvent, log } from "../events";
import { withoutLlm } from "../llm/guard";
import type { Candidate, Journey } from "../types";
import type { ProbeDeps } from "./common";
import { reflectProbe } from "./reflect";
import { sortProbe } from "./sort";
import { sweepProbe } from "./sweep";

export type { ProbeDeps } from "./common";

export interface ProbeResult {
  candidates: Candidate[];
  journeys: Journey[];
  metrics: Record<string, number>;
  notTested: string[];
}

export async function runProbes(deps: ProbeDeps): Promise<ProbeResult> {
  const out: ProbeResult = { candidates: [], journeys: [], metrics: {}, notTested: [] };
  const add = (name: string, r: Awaited<ReturnType<typeof sortProbe>>) => {
    out.candidates.push(...r.candidates);
    if (r.journey) out.journeys.push(r.journey);
    for (const [k, v] of Object.entries(r.metrics)) out.metrics[`probe.${name}.${k}`] = v;
  };
  await withoutLlm("the automatic probes", async () => {
    const run = async (name: string, fn: () => ReturnType<typeof sortProbe>) => {
      if (Date.now() > deps.deadline) {
        out.notTested.push(`The ${name} check wasn't run: the time limit was reached.`);
        return;
      }
      try {
        add(name, await fn());
      } catch (err) {
        log(deps.sink, "warn", `The ${name} check failed to run: ${String(err).split("\n")[0]}`);
      }
    };
    await run("sort", () => sortProbe(deps));
    if (deps.mode === "staging") await run("sweep", () => sweepProbe(deps));
    else
      out.notTested.push(
        "Collapsed sections, menus and tabs weren't opened: the interaction sweep only runs in staging mode.",
      );
    await run("reflect", () => reflectProbe(deps));
  });
  for (const c of out.candidates) {
    deps.sink(candidateEvent(c));
  }
  return out;
}
