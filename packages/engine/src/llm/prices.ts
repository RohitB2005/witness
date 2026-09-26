// Fallback prices (US$ per million tokens) for cost *estimates* when the provider doesn't report a cost.
// Source: OpenRouter's model list, 26 Sep 2026 (DEVLOG). Real runs use the cost OpenRouter reports.
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5": { input: 2, output: 10 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  "anthropic/claude-opus-5.5": { input: 4, output: 20 },
};

/** Estimated cost; unknown models are priced at the most expensive listed rate (never under-estimate). */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES_PER_MTOK[model] ?? { input: 4, output: 20 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
