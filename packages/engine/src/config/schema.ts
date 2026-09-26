// Scan config input: what a user (CLI/API) supplies, validated and defaulted into a ScanConfig.
import { z } from "zod";
import {
  BudgetPresetSchema,
  CredentialsSchema,
  LlmCacheSchema,
  PipelineSchema,
  ScanConfigSchema,
  ScanModeSchema,
  type ScanConfig,
  type ScanMode,
} from "../types";

export const ScanInputSchema = z.object({
  url: z.string().min(1),
  mode: ScanModeSchema.optional(),
  budget: BudgetPresetSchema.default("standard"),
  credentials: CredentialsSchema.optional(),
  hint: z.string().max(200).optional(),
  requirements: z.string().max(5000, "requirements text is limited to 5,000 characters").optional(),
  pipeline: PipelineSchema.default("full"),
  llmCache: LlmCacheSchema.default("rw"),
  approvedJourneyIds: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
});
export type ScanInput = z.input<typeof ScanInputSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Parses a URL the user typed. Only http(s) is allowed (SPEC FR-1). Messages are plain language. */
export function parseTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError(`"${raw}" isn't a valid web address. Include http:// or https://.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(
      `Witness only scans http:// or https:// addresses (got ${url.protocol}).`,
    );
  }
  if (url.username || url.password) {
    throw new ConfigError("Put login details in the credentials fields, not in the URL.");
  }
  return url;
}

/** Hosts where staging (writes allowed) is the safe default: this machine or reserved test TLDs. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".test")
  );
}

export function defaultMode(url: URL): ScanMode {
  return isLocalHost(url.hostname) ? "staging" : "production";
}

export function resolveScanConfig(input: ScanInput): ScanConfig {
  const parsed = ScanInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ConfigError(
      `Invalid scan settings: ${issue?.path.join(".") || "input"} — ${issue?.message ?? "unknown"}`,
    );
  }
  const i = parsed.data;
  const url = parseTargetUrl(i.url);
  return ScanConfigSchema.parse({
    url: url.href,
    mode: i.mode ?? defaultMode(url),
    budget: i.budget,
    credentials: i.credentials,
    hint: i.hint,
    requirements: i.requirements?.trim() || undefined,
    pipeline: i.pipeline,
    llmCache: i.llmCache,
    viewport: { width: 1280, height: 800 },
    mobileViewport: { width: 375, height: 667 },
    approvedJourneyIds: i.approvedJourneyIds,
    seed: i.seed,
  });
}
