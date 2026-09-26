// LLM settings from the environment, and model construction. OpenRouter only for now (DEVLOG D28); the
// gateway takes AI SDK LanguageModel objects, so another provider is one factory here.
import type { LanguageModel } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

export const LlmSettingsSchema = z.object({
  provider: z.literal("openrouter"),
  apiKey: z.string().min(1),
  smartModel: z.string().min(1),
  fastModel: z.string().min(1),
  /** Where the response cache lives (`.witness-cache/` at the repo root by default). */
  cacheDir: z.string().min(1),
  /** US$ cap from WITNESS_MAX_COST_USD; the run uses min(this, budget preset). */
  maxCostUsd: z.number().positive().optional(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

export class LlmConfigError extends Error {
  override name = "LlmConfigError";
}

/** Reads LLM settings from env vars. Throws LlmConfigError with a plain-language message if incomplete. */
export function llmSettingsFromEnv(env: NodeJS.ProcessEnv, cacheDir: string): LlmSettings {
  const provider = env.WITNESS_LLM_PROVIDER ?? "openrouter";
  if (provider !== "openrouter") {
    throw new LlmConfigError(
      `WITNESS_LLM_PROVIDER=${provider} isn't supported yet; only "openrouter" is built.`,
    );
  }
  if (!env.OPENROUTER_API_KEY)
    throw new LlmConfigError("OPENROUTER_API_KEY isn't set, so the AI stages can't run.");
  const max = env.WITNESS_MAX_COST_USD ? Number(env.WITNESS_MAX_COST_USD) : undefined;
  return LlmSettingsSchema.parse({
    provider,
    apiKey: env.OPENROUTER_API_KEY,
    smartModel: env.WITNESS_MODEL_SMART || "anthropic/claude-sonnet-5",
    fastModel: env.WITNESS_MODEL_FAST || "anthropic/claude-haiku-4.5",
    cacheDir,
    maxCostUsd: max && Number.isFinite(max) && max > 0 ? max : undefined,
  });
}

export interface Models {
  smart: LanguageModel;
  fast: LanguageModel;
  ids: { smart: string; fast: string };
}

export function createModels(s: LlmSettings): Models {
  const openrouter = createOpenRouter({ apiKey: s.apiKey });
  // Usage accounting returns the provider's real cost per call. Strict structured outputs are off: some
  // schemas have open fields (a check is validated by our own zod schema afterwards, then repaired).
  const opts = { usage: { include: true }, structuredOutputs: { strict: false } };
  return {
    smart: openrouter(s.smartModel, opts as Parameters<typeof openrouter>[1]),
    fast: openrouter(s.fastModel, opts as Parameters<typeof openrouter>[1]),
    ids: { smart: s.smartModel, fast: s.fastModel },
  };
}
