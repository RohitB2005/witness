// LLM response cache (AI_AGENT_SPEC.md §1). Key = sha256 of everything that determines the response.
// Modes: off (never read or write), rw (read-through, write on miss), replay (read-only; a miss is a
// CacheMissError — for the offline demo and reproducible eval reruns). Entries hold only redacted text.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type CacheMode = "off" | "rw" | "replay";

export class CacheMissError extends Error {
  override name = "CacheMissError";
}

export const CachedResponseSchema = z.object({
  /** Raw model output: the JSON text (structured) or the tool call (tools). */
  text: z.string().optional(),
  toolCall: z.object({ name: z.string(), input: z.unknown() }).optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  model: z.string(),
  createdAt: z.string(),
});
export type CachedResponse = z.infer<typeof CachedResponseSchema>;

export function cacheKey(parts: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex");
}

/** IDs the code makes up afresh every run (ids.ts). Run IDs never appear in prompts. */
const RUN_SCOPED_ID = /(?<![0-9A-Za-z_])(st|sp|ev|jr|ex|cd|fd)_[0-9a-z]{8}(?![0-9A-Za-z_])/g;
const PLACEHOLDER = /(?<![0-9A-Za-z_])(st|sp|ev|jr|ex|cd|fd)_@(\d+)(?![0-9])/g;

/** Applies `fn` to every string inside a JSON-like value (not to its JSON text, where escapes hide IDs). */
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mapStrings(v, fn)]),
    );
  return value;
}

/**
 * Makes cache keys independent of the random IDs a run generates (DEVLOG D86). The same prompt in two runs
 * differs only in its `ex_…`/`ev_…`/`jr_…` IDs, so without this a replay (`--llm-cache replay`, the offline
 * demo) can never get past the first prompt that names one. IDs become `ex_@1`, `ex_@2`… in order of first
 * appearance; the cached answer is stored in that form and mapped back to this run's IDs on read.
 */
export class RunIdMap {
  readonly #toPlaceholder = new Map<string, string>();
  readonly #toId = new Map<string, string>();

  /** `text`: the prompt's strings, in order (IDs are numbered by first appearance). */
  constructor(text: string) {
    const counts = new Map<string, number>();
    for (const m of text.matchAll(RUN_SCOPED_ID)) {
      if (this.#toPlaceholder.has(m[0])) continue;
      const n = (counts.get(m[1]!) ?? 0) + 1;
      counts.set(m[1]!, n);
      const ph = `${m[1]}_@${n}`;
      this.#toPlaceholder.set(m[0], ph);
      this.#toId.set(ph, m[0]);
    }
  }

  normalize(text: string): string {
    return text.replace(RUN_SCOPED_ID, (id) => this.#toPlaceholder.get(id) ?? id);
  }

  restore(text: string): string {
    return text.replace(PLACEHOLDER, (ph) => this.#toId.get(ph) ?? ph);
  }

  normalizeValue<T>(value: T): T {
    return mapStrings(value, (s) => this.normalize(s)) as T;
  }

  restoreValue<T>(value: T): T {
    return mapStrings(value, (s) => this.restore(s)) as T;
  }
}

export class LlmCache {
  constructor(
    readonly dir: string,
    readonly mode: CacheMode,
  ) {}

  #file(role: string, key: string): string {
    if (!/^[a-z-]+$/.test(role) || !/^[0-9a-f]{64}$/.test(key)) throw new Error("bad cache key");
    // v2: keys with run-generated IDs normalised (D86). Entries from before live one level up, unused.
    return path.join(this.dir, "v2", role, `${key}.json`);
  }

  /** The cached response, undefined on a miss in rw/off mode; throws CacheMissError in replay mode. */
  async get(role: string, key: string): Promise<CachedResponse | undefined> {
    if (this.mode === "off") return undefined;
    const file = this.#file(role, key);
    if (!existsSync(file)) {
      if (this.mode === "replay")
        throw new CacheMissError(`No cached ${role} response for this prompt (replay mode).`);
      return undefined;
    }
    const parsed = CachedResponseSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (parsed.success) return parsed.data;
    if (this.mode === "replay") throw new CacheMissError(`Cached ${role} response is unreadable.`);
    return undefined;
  }

  async put(role: string, key: string, value: CachedResponse): Promise<void> {
    if (this.mode !== "rw") return;
    const file = this.#file(role, key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, file);
  }
}

/** JSON with sorted object keys, so key order never changes the hash. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
