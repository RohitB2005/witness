// CLAUDE.md rule 4 / AI_AGENT_SPEC.md §2: no bench (or external eval app) knowledge in Witness.
// Prompts get the spec's strict pattern; all other engine source gets the names that could only come
// from the benchmark or SauceDemo (generic words like "cleaning" are fine in code comments).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const PROMPTS = path.join(SRC, "llm", "prompts");

const PROMPT_PATTERN =
  /harbour|cleaning|\bGST\b|\bB\d{2}\b|HC-\d|sold out|saucedemo|secret_sauce|problem_user|swag labs/i;
const CODE_PATTERN =
  /harbour|harbourclean|\bHC-\d|saucedemo|secret_sauce|problem_user|error_user|swag labs|__bench|localhost:5180|:5180\b|BENCH_BUGS/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("prompt contamination", () => {
  it("prompts exist to check", () => {
    expect(files(PROMPTS).length).toBeGreaterThan(0);
  });

  it.each(files(PROMPTS).map((f) => [path.relative(SRC, f), f]))("%s is generic", (_rel, file) => {
    const text = readFileSync(file, "utf8");
    const m = PROMPT_PATTERN.exec(text);
    expect(m?.[0], `bench-specific text in a prompt: "${m?.[0]}"`).toBeUndefined();
  });

  it("no engine source file names the bench, its data or SauceDemo", () => {
    const hits = files(SRC)
      .filter((f) => !f.endsWith(".test.ts"))
      .flatMap((f) => {
        const m = CODE_PATTERN.exec(readFileSync(f, "utf8"));
        return m ? [`${path.relative(SRC, f)}: "${m[0]}"`] : [];
      });
    expect(hits).toEqual([]);
  });
});
