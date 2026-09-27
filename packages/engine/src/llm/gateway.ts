// LLM gateway (AI_AGENT_SPEC.md §1): the only way engine code talks to a model.
//
// Every call: replay guard → redaction (secrets become {{secret:name}}) → leak assertion → budget check
// → cache → model (timeout, retries with backoff) → our own zod validation → one repair attempt → log.
// A failed call never throws for ordinary reasons (invalid output, provider down, budget, cache miss):
// it returns { ok: false } and the stage degrades. It throws only for bugs that must never pass silently:
// a secret about to leave the process, or an LLM call during replay.
import {
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  tool,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import type { SecretVault } from "../browser/vault";
import {
  CacheMissError,
  cacheKey,
  stableStringify,
  type CachedResponse,
  type LlmCache,
} from "./cache";
import { assertLlmAllowed } from "./guard";
import { estimateCostUsd } from "./prices";
import { UNIVERSAL_RULES } from "./prompts/universal";
import { redactSecrets } from "../detectors/secrets";

export type LlmRole = "planner" | "explorer" | "edge" | "judge" | "skeptic" | "reporter" | "ux";
export type ModelTier = "smart" | "fast";
type JsonSchemaObject = Record<string, unknown>;

export interface LlmCallLogEntry {
  at: string;
  role: LlmRole;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  costEstimated: boolean;
  latencyMs: number;
  cached: boolean;
  attempt: number;
  valid: boolean;
  repaired: boolean;
  error?: string;
}

export interface GatewayOptions {
  models: { smart: LanguageModel; fast: LanguageModel };
  modelIds: { smart: string; fast: string };
  vault: SecretVault;
  cache: LlmCache;
  /** Hard US$ cap for this run: no call starts once spend reaches it. */
  costCapUsd: number;
  onCall?: (entry: LlmCallLogEntry) => void;
  timeoutMs?: number;
  maxRetries?: number;
  /** Mark the system prompt cacheable (Anthropic prompt caching through OpenRouter). */
  promptCaching?: boolean;
}

export type LlmFailureReason = "invalid" | "budget" | "provider" | "cache-miss";
export type LlmResult<T> =
  | { ok: true; value: T; repaired: boolean; partial?: boolean }
  | { ok: false; reason: LlmFailureReason; error: string };

export interface StructuredRequest<T> {
  role: LlmRole;
  tier: ModelTier;
  instructions: string;
  prompt: string;
  /** The real contract: output is validated against this, and repaired once on failure. */
  schema: z.ZodType<T>;
  schemaName: string;
  /** What the model is shown; defaults to the zod schema as JSON Schema. */
  llmSchema?: JsonSchemaObject;
  /**
   * A looser schema to accept if the output is still invalid after the repair (the caller then drops the
   * invalid parts itself, e.g. one bad check in an otherwise good plan). The result says `partial: true`.
   */
  fallbackSchema?: z.ZodType<T>;
  temperature?: number;
  /** Hidden reasoning ("thinking") effort. Default "none": it adds latency and cost (DEVLOG D31). */
  reasoning?: ReasoningEffort;
  /** Per-call timeout (default: the gateway's, 60 s). */
  timeoutMs?: number;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
type CallKnobs = { temperature: number; reasoning: ReasoningEffort; timeoutMs?: number };

export interface ToolSpec {
  description: string;
  /** Validation contract for this tool's input. */
  schema: z.ZodType;
  /** What the model is shown; defaults to `schema` as JSON Schema. Use it to keep open fields small. */
  llmSchema?: JsonSchemaObject;
}

export interface ToolRequest {
  role: LlmRole;
  tier: ModelTier;
  instructions: string;
  /**
   * Leading parts of the user message that stay the same across many calls (e.g. the run's site map, then
   * one journey's brief). With prompt caching on, each is sent as its own block with a cache breakpoint
   * (at most 3: with the system prompt's that's Anthropic's limit of 4).
   */
  promptPrefix?: string | string[];
  prompt: string;
  tools: Record<string, ToolSpec>;
  temperature?: number;
  reasoning?: ReasoningEffort;
  timeoutMs?: number;
}

export interface ToolCallValue {
  name: string;
  input: unknown;
}

export class SecretLeakError extends Error {
  override name = "SecretLeakError";
}

class BudgetError extends Error {}

/** The log entry of one in-flight call. */
interface EntryRef {
  entry?: LlmCallLogEntry;
}

export interface GatewayTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  invalid: number;
  repaired: number;
  cacheHits: number;
  failures: number;
}

export class LlmGateway {
  readonly totals: GatewayTotals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    invalid: 0,
    repaired: 0,
    cacheHits: 0,
    failures: 0,
  };

  constructor(private readonly o: GatewayOptions) {}

  get budgetExhausted(): boolean {
    return this.totals.costUsd >= this.o.costCapUsd;
  }

  modelId(tier: ModelTier): string {
    return this.o.modelIds[tier];
  }

  /** One structured-output call: JSON validated by `schema`, one repair attempt. */
  async structured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>> {
    assertLlmAllowed(req.role);
    const llmSchema = req.llmSchema ?? toJsonSchema(req.schema);
    let previous: { raw: string; error: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ref: EntryRef = {};
      const prompt = previous
        ? repairPrompt(req.prompt, previous.raw, previous.error, "JSON")
        : req.prompt;
      let raw: string;
      try {
        const res = await this.#call(ref, req.role, req.tier, req.instructions, prompt, attempt, {
          kind: "structured",
          schemaName: req.schemaName,
          llmSchema,
          temperature: req.temperature ?? 0,
          reasoning: req.reasoning ?? "none",
          timeoutMs: req.timeoutMs,
        });
        raw = res.text ?? "";
      } catch (err) {
        return this.#failure(err, ref);
      }
      const parsed = parseJson(raw);
      const valid = parsed.ok ? req.schema.safeParse(parsed.value) : undefined;
      if (valid?.success) {
        if (attempt > 0) this.totals.repaired++;
        this.#mark(ref, { valid: true, repaired: attempt > 0 });
        return { ok: true, value: valid.data, repaired: attempt > 0 };
      }
      const error = parsed.ok ? summariseIssues(valid!.error) : parsed.error;
      this.totals.invalid++;
      this.#mark(ref, { valid: false, repaired: false, error });
      previous = { raw, error };
    }
    if (req.fallbackSchema && previous) {
      const parsed = parseJson(previous.raw);
      const loose = parsed.ok ? req.fallbackSchema.safeParse(parsed.value) : undefined;
      if (loose?.success) return { ok: true, value: loose.data, repaired: true, partial: true };
    }
    this.totals.failures++;
    return {
      ok: false,
      reason: "invalid",
      error: `Invalid ${req.schemaName} after one repair: ${previous?.error}`,
    };
  }

  /** One tool call (toolChoice: required): the chosen tool's input validated by its schema, one repair attempt. */
  async toolCall(req: ToolRequest): Promise<LlmResult<ToolCallValue>> {
    assertLlmAllowed(req.role);
    let previous: { raw: string; error: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ref: EntryRef = {};
      const prompt = previous
        ? repairPrompt(req.prompt, previous.raw, previous.error, "tool call")
        : req.prompt;
      let call: ToolCallValue | undefined;
      try {
        const res = await this.#call(ref, req.role, req.tier, req.instructions, prompt, attempt, {
          kind: "tools",
          tools: req.tools,
          promptPrefix: req.promptPrefix,
          temperature: req.temperature ?? 0,
          reasoning: req.reasoning ?? "none",
          timeoutMs: req.timeoutMs,
        });
        call = res.toolCall;
      } catch (err) {
        return this.#failure(err, ref);
      }
      let error: string;
      if (!call) error = "You didn't call a tool. Call exactly one tool.";
      else if (!req.tools[call.name]) error = `There is no tool named "${call.name}".`;
      else {
        const valid = req.tools[call.name]!.schema.safeParse(call.input);
        if (valid.success) {
          if (attempt > 0) this.totals.repaired++;
          this.#mark(ref, { valid: true, repaired: attempt > 0 });
          return { ok: true, value: { name: call.name, input: valid.data }, repaired: attempt > 0 };
        }
        error = `Invalid input for ${call.name}: ${summariseIssues(valid.error)}`;
      }
      this.totals.invalid++;
      this.#mark(ref, { valid: false, repaired: false, error });
      previous = { raw: JSON.stringify(call ?? null), error };
    }
    this.totals.failures++;
    return { ok: false, reason: "invalid", error: previous?.error ?? "invalid tool call" };
  }

  // -------------------------------------------------------------------------------------------

  // Each call has its own log entry (calls run concurrently since P3: writer, UX, judge, skeptic).
  #mark(
    ref: EntryRef,
    patch: Pick<LlmCallLogEntry, "valid" | "repaired"> & { error?: string },
  ): void {
    if (!ref.entry) return;
    Object.assign(ref.entry, patch);
    this.o.onCall?.(ref.entry);
    ref.entry = undefined;
  }

  #failure(err: unknown, ref: EntryRef): { ok: false; reason: LlmFailureReason; error: string } {
    if (err instanceof SecretLeakError) throw err;
    if (err instanceof Error && err.name === "ReplayGuardError") throw err;
    this.totals.failures++;
    const reason: LlmFailureReason =
      err instanceof BudgetError
        ? "budget"
        : err instanceof CacheMissError
          ? "cache-miss"
          : "provider";
    const error = firstLine(err);
    if (ref.entry) {
      ref.entry.error = error;
      this.o.onCall?.(ref.entry);
      ref.entry = undefined;
    }
    return { ok: false, reason, error };
  }

  async #call(
    ref: EntryRef,
    role: LlmRole,
    tier: ModelTier,
    instructionsIn: string,
    promptIn: string,
    attempt: number,
    spec:
      | ({ kind: "structured"; schemaName: string; llmSchema: JsonSchemaObject } & CallKnobs)
      | ({
          kind: "tools";
          tools: Record<string, ToolSpec>;
          promptPrefix?: string | string[];
        } & CallKnobs),
  ): Promise<{ text?: string; toolCall?: ToolCallValue }> {
    const model = this.o.modelIds[tier];
    // Redact, then assert: nothing that leaves the process may contain a vault value (T5).
    // Secret-key patterns found in page content never reach the model either (ADDENDUM A1).
    const instructions = redactSecrets(
      this.o.vault.toPlaceholders(`${UNIVERSAL_RULES}\n\n${instructionsIn}`),
    );
    const prompt = redactSecrets(this.o.vault.toPlaceholders(promptIn));
    const promptPrefix =
      spec.kind === "tools" && spec.promptPrefix !== undefined
        ? (Array.isArray(spec.promptPrefix) ? spec.promptPrefix : [spec.promptPrefix])
            .slice(0, 3)
            .map((p) => redactSecrets(this.o.vault.toPlaceholders(p)))
        : undefined;
    const toolDefs =
      spec.kind === "tools"
        ? Object.fromEntries(
            Object.entries(spec.tools).map(([name, t]) => [
              name,
              { description: t.description, inputSchema: t.llmSchema ?? toJsonSchema(t.schema) },
            ]),
          )
        : undefined;
    const payload = {
      model,
      role,
      instructions,
      promptPrefix,
      prompt,
      tools: toolDefs,
      output:
        spec.kind === "structured" ? { name: spec.schemaName, schema: spec.llmSchema } : undefined,
      temperature: spec.temperature,
      reasoning: spec.reasoning,
    };
    const serialized = stableStringify(payload);
    if (this.o.vault.leaks(serialized)) {
      throw new SecretLeakError(`Refusing to send a ${role} prompt that contains a secret value.`);
    }
    const key = cacheKey(payload);
    const entry: LlmCallLogEntry = {
      at: new Date().toISOString(),
      role,
      model,
      promptHash: key.slice(0, 16),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      costEstimated: false,
      latencyMs: 0,
      cached: false,
      attempt,
      valid: false,
      repaired: false,
    };
    ref.entry = entry;

    const hit = await this.o.cache.get(role, key); // throws CacheMissError in replay mode
    if (hit) {
      entry.cached = true;
      entry.inputTokens = hit.inputTokens;
      entry.outputTokens = hit.outputTokens;
      this.totals.cacheHits++;
      this.totals.calls++;
      return { text: hit.text, toolCall: hit.toolCall };
    }
    if (this.budgetExhausted) {
      throw new BudgetError(
        `LLM spend cap reached (US$${this.o.costCapUsd.toFixed(2)}); no further AI calls in this run.`,
      );
    }

    const system = this.o.promptCaching
      ? {
          role: "system" as const,
          content: instructions,
          providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } },
        }
      : instructions;
    const started = Date.now();
    let text: string | undefined;
    let toolCall: ToolCallValue | undefined;
    let usage: {
      inputTokens?: number;
      outputTokens?: number;
      inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
    };
    let providerCost: number | undefined;
    // A stable prefix goes first as its own block; with caching on, it carries a second cache breakpoint.
    const input =
      promptPrefix !== undefined
        ? {
            messages: [
              {
                role: "user" as const,
                content: [
                  ...promptPrefix.map((text) => ({
                    type: "text" as const,
                    text,
                    ...(this.o.promptCaching
                      ? { providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } } }
                      : {}),
                  })),
                  { type: "text" as const, text: prompt },
                ],
              },
            ],
          }
        : { prompt };
    const common = {
      model: this.o.models[tier],
      instructions: system,
      ...input,
      temperature: spec.temperature,
      maxRetries: this.o.maxRetries ?? 3,
      timeout: spec.timeoutMs ?? this.o.timeoutMs ?? 60_000,
      providerOptions: { openrouter: { reasoning: { effort: spec.reasoning } } },
    };
    try {
      if (spec.kind === "structured") {
        const r = await generateText({
          ...common,
          output: Output.object({ schema: jsonSchema(spec.llmSchema), name: spec.schemaName }),
        });
        text = r.text;
        usage = r.usage;
        providerCost = reportedCost(r.providerMetadata);
      } else {
        const tools = Object.fromEntries(
          Object.entries(toolDefs!).map(([name, t]) => [
            name,
            tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) }),
          ]),
        );
        const r = await generateText({ ...common, tools, toolChoice: "required" });
        const c =
          r.toolCalls[0] ??
          (r.content.find((p) => p.type === "tool-call") as
            { toolName: string; input: unknown } | undefined);
        if (c)
          toolCall = {
            name: c.toolName,
            input: typeof c.input === "string" ? safeJson(c.input) : c.input,
          };
        text = r.text;
        usage = r.usage;
        providerCost = reportedCost(r.providerMetadata);
      }
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        text = err.text ?? "";
        usage = err.usage ?? {};
      } else {
        entry.latencyMs = Date.now() - started;
        throw err;
      }
    }
    entry.latencyMs = Date.now() - started;
    entry.inputTokens = usage.inputTokens ?? 0;
    entry.outputTokens = usage.outputTokens ?? 0;
    entry.cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    entry.cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    entry.costEstimated = providerCost === undefined;
    entry.costUsd = providerCost ?? estimateCostUsd(model, entry.inputTokens, entry.outputTokens);
    this.totals.calls++;
    this.totals.inputTokens += entry.inputTokens;
    this.totals.outputTokens += entry.outputTokens;
    this.totals.costUsd += entry.costUsd;

    const cached: CachedResponse = {
      text,
      toolCall,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd: entry.costUsd,
      model,
      createdAt: entry.at,
    };
    await this.o.cache.put(role, key, cached);
    return { text, toolCall };
  }
}

// ---------------------------------------------------------------------------------------------

export function toJsonSchema(schema: z.ZodType): JsonSchemaObject {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return rest;
}

function reportedCost(meta: unknown): number | undefined {
  const cost = (meta as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter
    ?.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false, error: "The response wasn't valid JSON." };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Zod issues as short "path: message" lines (at most 8), for the repair prompt and the log. */
export function summariseIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function repairPrompt(prompt: string, raw: string, error: string, what: string): string {
  return `${prompt}\n\n<previous_attempt>\n${raw.slice(0, 4000)}\n</previous_attempt>\nYour previous ${what} was invalid: ${error}\nFix exactly these problems and respond again.`;
}

function firstLine(err: unknown): string {
  return ((err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "").slice(0, 300);
}
