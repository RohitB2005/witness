// Scripted mock models for gateway/planner/explorer tests (AI SDK MockLanguageModelV4): no network, no cost.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { SecretVault } from "../src/browser/vault";
import { LlmCache, type CacheMode } from "../src/llm/cache";
import { LlmGateway, type GatewayOptions, type LlmCallLogEntry } from "../src/llm/gateway";

export type MockReply =
  | { json: unknown }
  | { text: string }
  | { tool: string; input: unknown }
  | { error: Error }
  | ((prompt: string) => MockReply);

export interface MockModel {
  model: MockLanguageModelV4;
  /** Every prompt the model received (system + user text, flattened). */
  prompts: string[];
  /** The raw prompt messages of every call (to check message parts and provider options). */
  raw: unknown[];
}

export function mockModel(replies: MockReply[], costPerCall = 0.001): MockModel {
  const prompts: string[] = [];
  const raw: unknown[] = [];
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      raw.push(options.prompt);
      const flat = options.prompt
        .map((m) =>
          typeof m.content === "string"
            ? m.content
            : m.content.map((p) => ("text" in p ? p.text : "")).join("\n"),
        )
        .join("\n");
      prompts.push(flat);
      const scripted = replies[Math.min(i++, replies.length - 1)]!;
      const reply: Exclude<MockReply, (p: string) => MockReply> =
        typeof scripted === "function"
          ? (scripted(flat) as Exclude<MockReply, (p: string) => MockReply>)
          : scripted;
      if ("error" in reply) throw reply.error;
      const content =
        "tool" in reply
          ? [
              {
                type: "tool-call" as const,
                toolCallId: `call_${i}`,
                toolName: reply.tool,
                input: JSON.stringify(reply.input),
              },
            ]
          : [
              {
                type: "text" as const,
                text: "json" in reply ? JSON.stringify(reply.json) : reply.text,
              },
            ];
      return {
        content,
        finishReason: {
          unified: "tool" in reply ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 100, text: 100, reasoning: undefined },
        },
        providerMetadata: { openrouter: { usage: { cost: costPerCall } } },
        warnings: [],
      };
    },
  });
  return { model, prompts, raw };
}

export interface TestGateway {
  gateway: LlmGateway;
  smart: MockModel;
  fast: MockModel;
  vault: SecretVault;
  calls: LlmCallLogEntry[];
  cacheDir: string;
}

export async function testGateway(
  smartReplies: MockReply[],
  fastReplies: MockReply[] = smartReplies,
  opts: Partial<GatewayOptions> & { cacheMode?: CacheMode; cacheDir?: string } = {},
): Promise<TestGateway> {
  const smart = mockModel(smartReplies);
  const fast = mockModel(fastReplies);
  const vault = opts.vault ?? new SecretVault();
  const cacheDir = opts.cacheDir ?? (await mkdtemp(path.join(tmpdir(), "witness-llm-cache-")));
  const calls: LlmCallLogEntry[] = [];
  const gateway = new LlmGateway({
    models: { smart: smart.model, fast: fast.model },
    modelIds: { smart: "test/smart", fast: "test/fast" },
    vault,
    cache: opts.cache ?? new LlmCache(cacheDir, opts.cacheMode ?? "off"),
    costCapUsd: opts.costCapUsd ?? 1,
    onCall: (e) => calls.push({ ...e }),
    maxRetries: 0,
    ...opts,
  });
  return { gateway, smart, fast, vault, calls, cacheDir };
}
