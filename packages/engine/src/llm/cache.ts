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

export class LlmCache {
  constructor(
    readonly dir: string,
    readonly mode: CacheMode,
  ) {}

  #file(role: string, key: string): string {
    if (!/^[a-z-]+$/.test(role) || !/^[0-9a-f]{64}$/.test(key)) throw new Error("bad cache key");
    return path.join(this.dir, role, `${key}.json`);
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
