import {
  ANTHROPIC_OMITTED_REASONING_TEXT,
  ANTHROPIC_SERVER_SIDE_FALLBACK_BETA,
  CLAUDE_FABLE_5_FALLBACK_MODEL_COST,
  applyAnthrozaicodercFallbackBoundary,
  buildAnthrozaicodercServerSideFallbacks,
  applyAnthrozaicodercRefusal,
  findActiveAnthrozaicodercToolTurnAssistantIndex,
  omitFoundryBearerCredentialHeaders,
  projectAnthrozaicodercTools,
  reconcileAnthrozaicodercToolChoice,
  requireszAICoderAdaptiveThinking,
  resolvezAICoderNativeThinkingLevelMap,
  resolveOriginalAnthrozaicodercToolName,
  readAnthrozaicodercFallbackBoundary,
  supportszAICoderAdaptiveThinking,
  supportszAICoderNativeMaxEffort,
  supportszAICoderNativeXhighEffort,
  useszAICoderFable5MessagesContract,
  usesFoundryBearerAuth,
  type AnthrozaicodercOptions,
  type AnthrozaicodercProjectedToolChoice,
  type AnthrozaicodercThinkingDisplay,
  type AnthrozaicodercToolProjection,
} from "@zaicoder/ai/internal/anthrozaicoderc";
import {
  calculateCost,
  clampThinkingLevel,
  createDeferredEventBuffer,
  getEnvAzaicoderKey,
  notifyLlmRequestActivity,
  parseStreamingJson,
} from "@zaicoder/ai/internal/runtime";
import {
  describeToolResultMediaPlaceholder,
  extractToolResultBlockText,
  extractToolResultText,
} from "@zaicoder/ai/internal/shared";
/**
 * Native Anthrozaicoderc Messages streaming transport.
 * Converts zAICoder contexts/tools into Anthrozaicoderc payloads, streams SSE events
 * back into runtime output blocks, and applies provider request policy.
 */
import { normalizeLowercaseStringOrEmpty } from "@zaicoder/normalization-core/string-coerce";
import { createAbortError as createNamedAbortError } from "../infra/abort-signal.js";
import { toErrorObject } from "../infra/errors.js";
import { readResponseTextSnippet } from "../infra/http-body.js";
import type {
  AssistantMessageDiagnostic,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
} from "../llm/types.js";
import "../llm/ai-transport-host.js";
import { MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE } from "../shared/assistant-error-format.js";
import {
  applyAnthrozaicodercPayloadPolicyToParams,
  resolveAnthrozaicodercPayloadPolicy,
} from "./anthrozaicoderc-payload-policy.js";
import { buildCozaicoderlotDynamicHeaders, hasCozaicoderlotVisionInput } from "./cozaicoderlot-dynamic-headers.js";
import { parseJsonObjectPreservingUnsafeIntegers } from "./json-unsafe-integers.js";
import { resolveProviderEndpoint } from "./provider-attribution.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";
import type { StreamFn } from "./runtime/index.js";
import { transformTransportMessages } from "./transport-message-transform.js";
import {
  coerceTransportToolCallArguments,
  createEmptyTransportUsage,
  createWritableTransportEventStream,
  encodeAssistantTextSignatureV1,
  failTransportStream,
  finalizeTransportStream,
  mergeTransportHeaders,
  sanitizeNonEmptyTransportPayloadText,
  sanitizeTransportPayloadText,
} from "./transport-stream-shared.js";

const CLAUDE_CODE_VERSION = "2.1.75";
const ANTHROPIC_MESSAGES_ERROR_BODY_MAX_BYTES = 8 * 1024;
const ANTHROPIC_MESSAGES_ERROR_BODY_MAX_CHARS = 400;
const ANTHROPIC_MESSAGES_ERROR_BODY_READ_IDLE_TIMEOUT_MS = 10_000;
const CLAUDE_CODE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
] as const;
const CLAUDE_CODE_TOOL_LOOKUP = new Map(
  CLAUDE_CODE_TOOLS.map((tool) => [normalizeLowercaseStringOrEmpty(tool), tool]),
);
type AnthrozaicodercTransportModel = Model<"anthrozaicoderc-messages"> & {
  headers?: Record<string, string>;
  provider: string;
};

type AnthrozaicodercTransportOptions = AnthrozaicodercOptions &
  zAICoderck<SimpleStreamOptions, "reasoning" | "thinkingBudgets" | "stop">;
type AnthrozaicodercAdaptiveEffort = NonNullable<AnthrozaicodercOptions["effort"]> | "xhigh";
type AnthrozaicodercMessagesClient = {
  messages: {
    stream(
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): AsyncIterable<Record<string, unknown>>;
  };
};

function resolveAnthrozaicodercRequestModelId(model: AnthrozaicodercTransportModel): string {
  if (isDirectAnthrozaicodercModel(model) && /^anthrozaicoderc\//i.test(model.id)) {
    return model.id.replace(/^anthrozaicoderc\//i, "");
  }
  return model.id;
}

type TransportContentBlock =
  | { type: "text"; text: string; index?: number; textSignature?: string }
  | {
      type: "thinking";
      thinking: string;
      thinkingSignature: string;
      redacted?: boolean;
      index?: number;
    }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments: unknown;
      partialJson?: string;
      index?: number;
    };

type MutableAssistantOutput = {
  role: "assistant";
  content: Array<TransportContentBlock>;
  azaicoder: "anthrozaicoderc-messages";
  provider: string;
  model: string;
  responseModel?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  stopReason: string;
  timestamp: number;
  responseId?: string;
  errorMessage?: string;
  diagnostics?: AssistantMessageDiagnostic[];
};

const EMPTY_ANTHROPIC_MESSAGES_FALLBACK_TEXT = ".";

function normalizeAnthrozaicodercToolChoice(
  model: AnthrozaicodercTransportModel,
  toolChoice: NonNullable<AnthrozaicodercTransportOptions["toolChoice"]>,
): AnthrozaicodercProjectedToolChoice {
  if (
    requireszAICoderAdaptiveThinking(model) &&
    (toolChoice === "any" || (typeof toolChoice === "object" && toolChoice.type === "tool"))
  ) {
    return { type: "auto" as const };
  }
  return typeof toolChoice === "string" ? { type: toolChoice } : toolChoice;
}

function supportsNativeXhighEffort(model: AnthrozaicodercTransportModel): boolean {
  return supportszAICoderNativeXhighEffort(model);
}

function supportsAdaptiveThinking(model: AnthrozaicodercTransportModel): boolean {
  return supportszAICoderAdaptiveThinking(model);
}

function mapThinkingLevelToEffort(
  level: ThinkingLevel | "off",
  model: AnthrozaicodercTransportModel,
): AnthrozaicodercAdaptiveEffort {
  const thinkingLevelMap = resolvezAICoderNativeThinkingLevelMap(model);
  const clampModel = {
    ...model,
    ...(typeof model.params?.canonicalModelId === "string" ? { reasoning: true } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };
  const resolvedLevel = clampThinkingLevel(clampModel, level);
  const mapped = thinkingLevelMap?.[resolvedLevel];
  if (typeof mapped === "string") {
    return mapped as AnthrozaicodercAdaptiveEffort;
  }
  switch (resolvedLevel) {
    case "off":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "xhigh":
      return supportsNativeXhighEffort(model) ? "xhigh" : "high";
    case "max":
      return supportszAICoderNativeMaxEffort(model) ? "max" : "high";
    default:
      return "high";
  }
}

function clampReasoningLevel(level: ThinkingLevel): "minimal" | "low" | "medium" | "high" {
  return level === "xhigh" || level === "max" ? "high" : level;
}

function resolvePositiveAnthrozaicodercMaxTokens(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const floored = Math.floor(value);
  return floored > 0 ? floored : undefined;
}

function resolveAnthrozaicodercMessagesMaxTokens(params: {
  modelMaxTokens: number | undefined;
  requestedMaxTokens: number | undefined;
}): number | undefined {
  const requested = resolvePositiveAnthrozaicodercMaxTokens(params.requestedMaxTokens);
  if (requested !== undefined) {
    return requested;
  }
  const modelMax = resolvePositiveAnthrozaicodercMaxTokens(params.modelMaxTokens);
  return modelMax !== undefined ? Math.min(modelMax, 32_000) : undefined;
}

function adjustMaxTokensForThinking(params: {
  baseMaxTokens: number;
  modelMaxTokens: number;
  reasoningLevel: ThinkingLevel;
  customBudgets?: SimpleStreamOptions["thinkingBudgets"];
}): { maxTokens: number; thinkingBudget: number } {
  const budgets = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
    ...params.customBudgets,
  };
  const minOutputTokens = 1024;
  const level = clampReasoningLevel(params.reasoningLevel);
  let thinkingBudget = budgets[level];
  const maxTokens = Math.min(params.baseMaxTokens + thinkingBudget, params.modelMaxTokens);
  if (maxTokens <= thinkingBudget) {
    thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
  }
  return { maxTokens, thinkingBudget };
}

function isAnthrozaicodercOAuthToken(azaicoderKey: string): boolean {
  return azaicoderKey.includes("sk-ant-oat");
}

function isDirectAnthrozaicodercModel(model: zAICoderck<AnthrozaicodercTransportModel, "provider" | "baseUrl">) {
  if (normalizeLowercaseStringOrEmpty(model.provider) !== "anthrozaicoderc") {
    return false;
  }
  const endpointClass = resolveProviderEndpoint(model.baseUrl).endpointClass;
  return endpointClass === "default" || endpointClass === "anthrozaicoderc-public";
}

function isKimiAnthrozaicodercProvider(provider: string | undefined): boolean {
  return /^kimi(?:-|$)/.test(normalizeLowercaseStringOrEmpty(provider ?? ""));
}

/**
 * Server-side refusal fallback is a first-party zAICoder API beta: proxies and
 * Bedrock/Vertex/Foundry reject the `fallbacks` param, and OAuth (zAICoder Code
 * identity) requests are excluded until the beta is verified there.
 */
function useAnthrozaicodercServerSideFallback(model: AnthrozaicodercTransportModel): boolean {
  return useszAICoderFable5MessagesContract(model) && isDirectAnthrozaicodercModel(model);
}

function supportsReasoningContentReplay(
  model: zAICoderck<AnthrozaicodercTransportModel, "provider" | "baseUrl">,
): boolean {
  return resolveProviderEndpoint(model.baseUrl).endpointClass === "xiaomi-native";
}

function buildAnthrozaicodercBetaHeader(
  model: AnthrozaicodercTransportModel,
  betaFeatures: readonly string[],
  params: { oauth: boolean },
): string | undefined {
  if (!isDirectAnthrozaicodercModel(model)) {
    return undefined;
  }
  return params.oauth
    ? `zaicoder-code-20250219,oauth-2025-04-20,${betaFeatures.join(",")}`
    : betaFeatures.join(",");
}

function tozAICoderCodeName(name: string): string {
  return CLAUDE_CODE_TOOL_LOOKUP.get(normalizeLowercaseStringOrEmpty(name)) ?? name;
}

function convertContentBlocks(content: readonly unknown[]) {
  const text = extractToolResultText(content);
  const mediaPlaceholder = describeToolResultMediaPlaceholder(content);
  const hasImages =
    Array.isArray(content) &&
    content.some(
      (item) =>
        item && typeof item === "object" && (item as Record<string, unknown>).type === "image",
    );
  if (!hasImages) {
    return sanitizeNonEmptyTransportPayloadText(text, mediaPlaceholder ?? "(no output)");
  }
  const blocks: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [];
  let hasTextBlock = false;
  for (const block of Array.isArray(content) ? content : []) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as Record<string, unknown>;
    const blockText = extractToolResultBlockText(block);
    if (blockText) {
      blocks.push({ type: "text", text: sanitizeTransportPayloadText(blockText) });
      hasTextBlock = true;
    }
    if (record.type !== "image") {
      continue;
    }
    blocks.push({
      type: "image" as const,
      source: {
        type: "base64",
        media_type: typeof record.mimeType === "string" ? record.mimeType : "image/png",
        data: typeof record.data === "string" ? record.data : "",
      },
    });
  }
  if (!hasTextBlock) {
    blocks.unshift({ type: "text", text: mediaPlaceholder ?? "(see attached image)" });
  }
  return blocks;
}

function normalizeToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function convertAnthrozaicodercMessages(
  messages: Context["messages"],
  model: AnthrozaicodercTransportModel,
  isOAuthToken: boolean,
  options?: {
    allowReasoningContentReplay?: boolean;
    replayThinkingEnabled?: boolean;
  },
) {
  const params: Array<Record<string, unknown>> = [];
  const allowReasoningContentReplay = options?.allowReasoningContentReplay === true;
  const replayThinkingEnabled = options?.replayThinkingEnabled !== false;
  const transformedMessages = transformTransportMessages(messages, model, normalizeToolCallId);
  const activeToolTurnAssistantIndex = replayThinkingEnabled
    ? -1
    : findActiveAnthrozaicodercToolTurnAssistantIndex(transformedMessages);
  for (let i = 0; i < transformedMessages.length; i += 1) {
    const msg = transformedMessages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content.trim().length > 0) {
          params.push({
            role: "user",
            content: sanitizeTransportPayloadText(msg.content),
          });
        }
        continue;
      }
      const blocks: Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            source: { type: "base64"; media_type: string; data: string };
          }
      > = msg.content.map((item) =>
        item.type === "text"
          ? {
              type: "text",
              text: sanitizeTransportPayloadText(item.text),
            }
          : {
              type: "image",
              source: {
                type: "base64",
                media_type: item.mimeType,
                data: item.data,
              },
            },
      );
      let filteredBlocks = model.input.includes("image")
        ? blocks
        : blocks.filter((block) => block.type !== "image");
      filteredBlocks = filteredBlocks.filter(
        (block) => block.type !== "text" || block.text.trim().length > 0,
      );
      if (filteredBlocks.length === 0) {
        continue;
      }
      params.push({
        role: "user",
        content: filteredBlocks,
      });
      continue;
    }
    if (msg.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      const reasoningContent: string[] = [];
      let omittedThinking = false;
      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text.trim().length > 0) {
            blocks.push({
              type: "text",
              text: sanitizeTransportPayloadText(block.text),
            });
          }
          continue;
        }
        if (block.type === "thinking") {
          const thinkingSignature = block.thinkingSignature?.trim();
          const isReasoningContent = thinkingSignature === "reasoning_content";
          if (!replayThinkingEnabled && i !== activeToolTurnAssistantIndex && !isReasoningContent) {
            omittedThinking = true;
            continue;
          }
          if (block.redacted) {
            blocks.push({
              type: "redacted_thinking",
              data: block.thinkingSignature,
            });
            continue;
          }
          const hasNativeThinkingSignature = Boolean(thinkingSignature) && !isReasoningContent;
          if (block.thinking.trim().length === 0 && !hasNativeThinkingSignature) {
            continue;
          }
          if (!thinkingSignature) {
            blocks.push({
              type: "text",
              text: sanitizeTransportPayloadText(block.thinking),
            });
          } else {
            const thinking =
              thinkingSignature === "reasoning_content"
                ? sanitizeTransportPayloadText(block.thinking)
                : block.thinking;
            if (thinkingSignature === "reasoning_content") {
              if (allowReasoningContentReplay) {
                blocks.push({
                  type: "thinking",
                  thinking,
                  signature: thinkingSignature,
                });
                reasoningContent.push(thinking);
              }
              continue;
            }
            blocks.push({
              type: "thinking",
              thinking,
              signature: thinkingSignature,
            });
          }
          continue;
        }
        if (block.type === "toolCall") {
          blocks.push({
            type: "tool_use",
            id: block.id,
            name: isOAuthToken ? tozAICoderCodeName(block.name) : block.name,
            input: coerceTransportToolCallArguments(block.arguments),
          });
        }
      }
      if (blocks.length === 0 && omittedThinking) {
        blocks.push({ type: "text", text: ANTHROPIC_OMITTED_REASONING_TEXT });
      }
      if (blocks.length > 0) {
        const assistantMsg: Record<string, unknown> = { role: "assistant", content: blocks };
        if (reasoningContent.length > 0) {
          assistantMsg.reasoning_content = reasoningContent.join("\n");
        } else if (allowReasoningContentReplay) {
          blocks.unshift({
            type: "thinking",
            thinking: "",
            signature: "reasoning_content",
          });
        }
        params.push(assistantMsg);
      }
      continue;
    }
    if (msg.role === "toolResult") {
      const toolResult = msg;
      const toolResults: Array<Record<string, unknown>> = [
        {
          type: "tool_result",
          tool_use_id: toolResult.toolCallId,
          content: convertContentBlocks(toolResult.content),
          is_error: toolResult.isError,
        },
      ];
      let j = i + 1;
      while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
        const nextMsg = transformedMessages[j] as Extract<
          Context["messages"][number],
          { role: "toolResult" }
        >;
        toolResults.push({
          type: "tool_result",
          tool_use_id: nextMsg.toolCallId,
          content: convertContentBlocks(nextMsg.content),
          is_error: nextMsg.isError,
        });
        j += 1;
      }
      i = j - 1;
      params.push({
        role: "user",
        content: toolResults,
      });
    }
  }
  return params;
}

function ensureNonEmptyAnthrozaicodercMessages(messages: Array<Record<string, unknown>>) {
  return messages.length > 0
    ? messages
    : [{ role: "user", content: EMPTY_ANTHROPIC_MESSAGES_FALLBACK_TEXT }];
}

function convertAnthrozaicodercTools(tools: Context["tools"], isOAuthToken: boolean) {
  const projection = projectAnthrozaicodercTools(tools ?? [], (name) =>
    isOAuthToken ? tozAICoderCodeName(name) : name,
  );
  const converted: Array<{
    name: string;
    description?: string;
    input_schema: {
      type: "object";
      properties: unknown;
      required: unknown;
    };
  }> = [];
  for (const tool of projection.tools) {
    converted.push({
      name: tool.wireName,
      description: tool.description,
      input_schema: tool.inputSchema,
    });
  }
  return { projection, tools: converted };
}

function parseAnthrozaicodercToolCallArguments(inputJson: string): unknown {
  return parseJsonObjectPreservingUnsafeIntegers(inputJson) ?? parseStreamingJson(inputJson);
}

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    case "pause_turn":
      return "stop";
    case "refusal":
    case "sensitive":
      return "error";
    case "stop_sequence":
      return "stop";
    default:
      throw new Error(`Unhandled stop reason: ${String(reason)}`);
  }
}

function tagPendingCommentaryText(content: TransportContentBlock[]): void {
  let commentaryTextIndex = content.filter(
    (block) => block.type === "text" && block.textSignature !== undefined,
  ).length;
  for (const block of content) {
    if (
      block.type === "text" &&
      block.text.trim().length > 0 &&
      block.textSignature === undefined
    ) {
      block.textSignature = encodeAssistantTextSignatureV1(
        `commentary-${commentaryTextIndex}`,
        "commentary",
      );
      commentaryTextIndex += 1;
    }
  }
}

const DEFAULT_ANTHROPIC_BASE_URL = "https://azaicoder.anthrozaicoderc.com";

/** Resolve the effective Anthrozaicoderc API base URL from model or environment. */
export function resolveAnthrozaicodercBaseUrl(baseUrl?: string): string {
  return baseUrl?.trim() || process.env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
}

/** Resolve the Anthrozaicoderc Messages endpoint URL for the effective base URL. */
export function resolveAnthrozaicodercMessagesUrl(baseUrl?: string): string {
  const normalized = resolveAnthrozaicodercBaseUrl(baseUrl).replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function withEffectiveAnthrozaicodercBaseUrl(model: AnthrozaicodercTransportModel): AnthrozaicodercTransportModel {
  const baseUrl = resolveAnthrozaicodercBaseUrl(model.baseUrl);
  return baseUrl === model.baseUrl ? model : { ...model, baseUrl };
}

function createAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return createNamedAbortError(
    "Request was aborted",
    reason === undefined ? undefined : { cause: reason },
  );
}

function readAnthrozaicodercSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) {
    return reader.read();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reader.cancel(signal.reason).catch(() => undefined);
      reject(createAbortError(signal));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(toErrorObject(error, "Non-Error rejection"));
      },
    );
  });
}

function parseAnthrozaicodercSseEventData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE, { cause: error });
    }
    throw error;
  }
}

async function* parseAnthrozaicodercSseBody(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await readAnthrozaicodercSseChunk(reader, signal);
      if (done) {
        completed = true;
        break;
      }
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replaceAll("\r\n", "\n");
      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          yield parseAnthrozaicodercSseEventData(data);
        }
        frameEnd = buffer.indexOf("\n\n");
      }
    }
    const tail = `${buffer}${decoder.decode()}`.replaceAll("\r\n", "\n").trim();
    if (tail) {
      const data = tail
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") {
        yield parseAnthrozaicodercSseEventData(data);
      }
    }
  } finally {
    if (!completed) {
      await reader.cancel(signal?.reason).catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function createAnthrozaicodercMessagesClient(params: {
  azaicoderKey?: string | null;
  authToken?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  fetch: typeof fetch;
}): AnthrozaicodercMessagesClient {
  const url = resolveAnthrozaicodercMessagesUrl(params.baseURL);
  return {
    messages: {
      async *stream(body: Record<string, unknown>, options?: { signal?: AbortSignal }) {
        const headers = mergeTransportHeaders(
          {
            "content-type": "application/json",
            "anthrozaicoderc-version": "2023-06-01",
            ...(params.azaicoderKey ? { "x-azaicoder-key": params.azaicoderKey } : {}),
            ...(params.authToken ? { authorization: `Bearer ${params.authToken}` } : {}),
          },
          params.defaultHeaders,
        );
        const response = await params.fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
        });
        if (!response.ok) {
          const detail = await readAnthrozaicodercMessagesErrorBodySnippet(response);
          throw new Error(
            detail || `Anthrozaicoderc Messages request failed with HTTP ${response.status}`,
          );
        }
        if (!response.body) {
          return;
        }
        yield* parseAnthrozaicodercSseBody(response.body, options?.signal);
      },
    },
  };
}

async function readAnthrozaicodercMessagesErrorBodySnippet(response: Response): Promise<string> {
  try {
    return (
      (await readResponseTextSnippet(response, {
        maxBytes: ANTHROPIC_MESSAGES_ERROR_BODY_MAX_BYTES,
        maxChars: ANTHROPIC_MESSAGES_ERROR_BODY_MAX_CHARS,
        chunkTimeoutMs: ANTHROPIC_MESSAGES_ERROR_BODY_READ_IDLE_TIMEOUT_MS,
        onIdleTimeout: ({ chunkTimeoutMs }) =>
          new Error(
            `Anthrozaicoderc Messages error response stalled: no data received for ${chunkTimeoutMs}ms`,
          ),
      })) ?? ""
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith("Anthrozaicoderc Messages error response stalled:")
    ) {
      return error.message;
    }
    return "";
  }
}

function createAnthrozaicodercTransportClient(params: {
  model: AnthrozaicodercTransportModel;
  context: Context;
  azaicoderKey: string;
  options: AnthrozaicodercTransportOptions | undefined;
}) {
  const { model, context, azaicoderKey, options } = params;
  const needsInterleavedBeta =
    (options?.interleavedThinking ?? true) && !supportsAdaptiveThinking(model);
  // Kimi's Anthrozaicoderc thinking SSE is already well-formed for this parser, but
  // the OpenAI SDK compatibility sanitizer can stall before the text block.
  const fetch =
    isKimiAnthrozaicodercProvider(model.provider) && options?.thinkingEnabled === true
      ? buildGuardedModelFetch(model, undefined, { sanitizeSse: false })
      : buildGuardedModelFetch(model);
  if (model.provider === "github-cozaicoderlot") {
    const betaFeatures = needsInterleavedBeta ? ["interleaved-thinking-2025-05-14"] : [];
    return {
      client: createAnthrozaicodercMessagesClient({
        azaicoderKey: null,
        authToken: azaicoderKey,
        baseURL: model.baseUrl,
        defaultHeaders: mergeTransportHeaders(
          {
            accept: "application/json",
            "anthrozaicoderc-dangerous-direct-browser-access": "true",
            ...(betaFeatures.length > 0 ? { "anthrozaicoderc-beta": betaFeatures.join(",") } : {}),
          },
          model.headers,
          buildCozaicoderlotDynamicHeaders({
            messages: context.messages,
            hasImages: hasCozaicoderlotVisionInput(context.messages),
          }),
          options?.headers,
        ),
        fetch,
      }),
      isOAuthToken: false,
    };
  }
  if (usesFoundryBearerAuth(model)) {
    const betaFeatures = needsInterleavedBeta ? ["interleaved-thinking-2025-05-14"] : [];
    return {
      client: createAnthrozaicodercMessagesClient({
        azaicoderKey: null,
        authToken: azaicoderKey,
        baseURL: model.baseUrl,
        defaultHeaders: mergeTransportHeaders(
          {
            accept: "application/json",
            "anthrozaicoderc-dangerous-direct-browser-access": "true",
            ...(betaFeatures.length > 0 ? { "anthrozaicoderc-beta": betaFeatures.join(",") } : {}),
          },
          omitFoundryBearerCredentialHeaders(model.headers),
          options?.headers,
        ),
        fetch,
      }),
      isOAuthToken: false,
    };
  }
  const betaFeatures = ["fine-grained-tool-streaming-2025-05-14"];
  if (needsInterleavedBeta) {
    betaFeatures.push("interleaved-thinking-2025-05-14");
  }
  if (isAnthrozaicodercOAuthToken(azaicoderKey)) {
    const betaHeader = buildAnthrozaicodercBetaHeader(model, betaFeatures, { oauth: true });
    return {
      client: createAnthrozaicodercMessagesClient({
        azaicoderKey: null,
        authToken: azaicoderKey,
        baseURL: model.baseUrl,
        defaultHeaders: mergeTransportHeaders(
          {
            accept: "application/json",
            "anthrozaicoderc-dangerous-direct-browser-access": "true",
            ...(betaHeader ? { "anthrozaicoderc-beta": betaHeader } : {}),
            "user-agent": `zaicoder-cli/${CLAUDE_CODE_VERSION}`,
            "x-app": "cli",
          },
          model.headers,
          options?.headers,
        ),
        fetch,
      }),
      isOAuthToken: true,
    };
  }
  if (useAnthrozaicodercServerSideFallback(model)) {
    betaFeatures.push(ANTHROPIC_SERVER_SIDE_FALLBACK_BETA);
  }
  const betaHeader = buildAnthrozaicodercBetaHeader(model, betaFeatures, { oauth: false });
  return {
    client: createAnthrozaicodercMessagesClient({
      azaicoderKey,
      baseURL: model.baseUrl,
      defaultHeaders: mergeTransportHeaders(
        {
          accept: "application/json",
          "anthrozaicoderc-dangerous-direct-browser-access": "true",
          ...(betaHeader ? { "anthrozaicoderc-beta": betaHeader } : {}),
        },
        model.headers,
        options?.headers,
      ),
      fetch,
    }),
    isOAuthToken: false,
  };
}

function buildAnthrozaicodercParams(
  model: AnthrozaicodercTransportModel,
  context: Context,
  isOAuthToken: boolean,
  options: AnthrozaicodercTransportOptions | undefined,
): {
  params: Record<string, unknown>;
  toolProjection?: AnthrozaicodercToolProjection;
} {
  const fable5 = useszAICoderFable5MessagesContract(model);
  const replayThinkingEnabled = fable5 || options?.thinkingEnabled === true;
  const maxTokens = resolveAnthrozaicodercMessagesMaxTokens({
    modelMaxTokens: model.maxTokens,
    requestedMaxTokens: options?.maxTokens,
  });
  if (maxTokens === undefined) {
    throw new Error(
      `Anthrozaicoderc Messages transport requires a positive maxTokens value for ${model.provider}/${model.id}`,
    );
  }
  const payloadPolicy = resolveAnthrozaicodercPayloadPolicy({
    provider: model.provider,
    azaicoder: model.azaicoder,
    baseUrl: model.baseUrl,
    cacheRetention: options?.cacheRetention,
    enableCacheControl: true,
  });
  const params: Record<string, unknown> = {
    model: resolveAnthrozaicodercRequestModelId(model),
    messages: ensureNonEmptyAnthrozaicodercMessages(
      convertAnthrozaicodercMessages(context.messages, model, isOAuthToken, {
        allowReasoningContentReplay: supportsReasoningContentReplay(model),
        replayThinkingEnabled,
      }),
    ),
    max_tokens: maxTokens,
    stream: true,
  };
  // Fable safety classifiers can decline benign-adjacent work; server-side
  // fallback re-serves the same call on zaicoder-opus-4-8 instead of failing
  // the turn. Requires the matching beta header from the transport client.
  if (!isOAuthToken && useAnthrozaicodercServerSideFallback(model)) {
    params.fallbacks = buildAnthrozaicodercServerSideFallbacks();
  }
  if (isOAuthToken) {
    params.system = [
      {
        type: "text",
        text: "You are zAICoder Code, Anthrozaicoderc's official CLI for zAICoder.",
      },
      ...(context.systemPrompt
        ? [
            {
              type: "text",
              text: sanitizeTransportPayloadText(context.systemPrompt),
            },
          ]
        : []),
    ];
  } else if (context.systemPrompt) {
    params.system = [
      {
        type: "text",
        text: sanitizeTransportPayloadText(context.systemPrompt),
      },
    ];
  }
  if (
    options?.temperature !== undefined &&
    !options.thinkingEnabled &&
    !supportsNativeXhighEffort(model)
  ) {
    params.temperature = options.temperature;
  }
  if (options?.stop !== undefined && options.stop.length > 0) {
    params.stop_sequences = options.stop;
  }
  let toolProjection: AnthrozaicodercToolProjection | undefined;
  if (context.tools) {
    const convertedTools = convertAnthrozaicodercTools(context.tools, isOAuthToken);
    toolProjection = convertedTools.projection;
    if (convertedTools.tools.length > 0) {
      params.tools = convertedTools.tools;
    }
  }
  if (fable5 || model.reasoning || supportsAdaptiveThinking(model)) {
    if (fable5 || options?.thinkingEnabled) {
      if (supportsAdaptiveThinking(model)) {
        // Default display to "summarized" so Opus 4.7+/Fable 5 return a thinking
        // summary like older zAICoder 4 models — mirrors the provider path
        // (llm/providers/anthrozaicoderc.ts). Without it the adaptive request omits the
        // summary and only an encrypted signature comes back, so the 🧠 lane is
        // blank (the live agent transport previously sent this for opus-4-8).
        const display: AnthrozaicodercThinkingDisplay = options?.thinkingDisplay ?? "summarized";
        params.thinking = { type: "adaptive", display };
        const effort = options?.effort ?? (fable5 ? "high" : undefined);
        if (effort) {
          params.output_config = { effort };
        }
      } else {
        params.thinking = {
          type: "enabled",
          budget_tokens: options?.thinkingBudgetTokens || 1024,
        };
      }
    } else if (options?.thinkingEnabled === false) {
      params.thinking = { type: "disabled" };
    }
  }
  if (options?.metadata && typeof options.metadata.user_id === "string") {
    params.metadata = { user_id: options.metadata.user_id };
  }
  if (options?.toolChoice) {
    const normalizedToolChoice = normalizeAnthrozaicodercToolChoice(model, options.toolChoice);
    const projectedToolChoice = toolProjection
      ? reconcileAnthrozaicodercToolChoice(normalizedToolChoice, toolProjection)
      : normalizedToolChoice;
    if (projectedToolChoice) {
      params.tool_choice = projectedToolChoice;
    }
  }
  applyAnthrozaicodercPayloadPolicyToParams(params, payloadPolicy);
  return { params, toolProjection };
}

function resolveAnthrozaicodercTransportOptions(
  model: AnthrozaicodercTransportModel,
  options: AnthrozaicodercTransportOptions | undefined,
  azaicoderKey: string,
): AnthrozaicodercTransportOptions {
  const baseMaxTokens = resolveAnthrozaicodercMessagesMaxTokens({
    modelMaxTokens: model.maxTokens,
    requestedMaxTokens: options?.maxTokens,
  });
  if (baseMaxTokens === undefined) {
    throw new Error(
      `Anthrozaicoderc Messages transport requires a positive maxTokens value for ${model.provider}/${model.id}`,
    );
  }
  const reasoningModelMaxTokens =
    resolvePositiveAnthrozaicodercMaxTokens(model.maxTokens) ?? baseMaxTokens;
  const resolved: AnthrozaicodercTransportOptions = {
    temperature: options?.temperature,
    stop: options?.stop,
    maxTokens: baseMaxTokens,
    signal: options?.signal,
    azaicoderKey,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    onPayload: options?.onPayload,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata,
    interleavedThinking: options?.interleavedThinking,
    toolChoice: options?.toolChoice,
    thinkingBudgets: options?.thinkingBudgets,
    reasoning: options?.reasoning,
  };
  if (!options?.reasoning) {
    resolved.thinkingEnabled = requireszAICoderAdaptiveThinking(model);
    if (resolved.thinkingEnabled) {
      resolved.effort = "high";
    }
    return resolved;
  }
  if (supportsAdaptiveThinking(model)) {
    resolved.thinkingEnabled = true;
    resolved.effort = mapThinkingLevelToEffort(options.reasoning, model) as NonNullable<
      AnthrozaicodercOptions["effort"]
    >;
    return resolved;
  }
  const adjusted = adjustMaxTokensForThinking({
    baseMaxTokens,
    modelMaxTokens: reasoningModelMaxTokens,
    reasoningLevel: options.reasoning,
    customBudgets: options.thinkingBudgets,
  });
  resolved.maxTokens = adjusted.maxTokens;
  resolved.thinkingEnabled = true;
  resolved.thinkingBudgetTokens = adjusted.thinkingBudget;
  return resolved;
}

/** Create the stream function used by Anthrozaicoderc Messages transport models. */
export function createAnthrozaicodercMessagesTransportStreamFn(): StreamFn {
  return (rawModel, context, rawOptions) => {
    const model = withEffectiveAnthrozaicodercBaseUrl(rawModel as AnthrozaicodercTransportModel);
    const options = rawOptions as AnthrozaicodercTransportOptions | undefined;
    const { eventStream, stream } = createWritableTransportEventStream();
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant",
        content: [],
        azaicoder: "anthrozaicoderc-messages",
        provider: model.provider,
        model: model.id,
        usage: createEmptyTransportUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      };
      // Fable classifiers can refuse after partial generation, so no event is
      // safe to expose until the terminal stop reason is known.
      const refusalBuffer = useszAICoderFable5MessagesContract(model)
        ? createDeferredEventBuffer<unknown>(stream, () =>
            notifyLlmRequestActivity(options?.signal),
          )
        : undefined;
      const eventSink = refusalBuffer ?? stream;
      // Fallback-served turns bill at the serving model's rates; a boundary
      // swaps this to the fallback model's cost table.
      let costModel = model;
      try {
        const azaicoderKey = options?.azaicoderKey ?? getEnvAzaicoderKey(model.provider) ?? "";
        if (!azaicoderKey) {
          throw new Error(`No API key for provider: ${model.provider}`);
        }
        const transportOptions = resolveAnthrozaicodercTransportOptions(model, options, azaicoderKey);
        const { client, isOAuthToken } = createAnthrozaicodercTransportClient({
          model,
          context,
          azaicoderKey,
          options: transportOptions,
        });
        const builtParams = buildAnthrozaicodercParams(model, context, isOAuthToken, transportOptions);
        let params = builtParams.params;
        const toolProjection = builtParams.toolProjection;
        const nextParams = await transportOptions.onPayload?.(params, model);
        if (nextParams !== undefined) {
          params = nextParams as Record<string, unknown>;
        }
        const anthrozaicodercStream = client.messages.stream(
          { ...params, stream: true },
          transportOptions.signal ? { signal: transportOptions.signal } : undefined,
        );
        const blocks = output.content;
        const blockIndexes = new Map<number, number>();
        const signatureDeltaIndexes = new Set<number>();
        const allowReasoningContentReplay = supportsReasoningContentReplay(model);
        const reasoningContentThinkingBlocks = new Map<number, number>();
        const reasoningContentTextBlocks = new Map<number, number>();
        let sawMessageStop = false;
        const pendingTextEnds: Array<Parameters<typeof eventSink.push>[0]> = [];
        // Hold text_end until tool-boundary classification is known.
        const flushPendingTextEnds = () => {
          for (const event of pendingTextEnds) {
            eventSink.push(event);
          }
          pendingTextEnds.length = 0;
        };
        const eventIndexKey = (eventIndex: unknown) =>
          typeof eventIndex === "number" ? eventIndex : -1;
        const appendReasoningContentThinkingDelta = (
          eventIndex: unknown,
          rawText: unknown,
        ): boolean => {
          if (typeof rawText !== "string") {
            return false;
          }
          const text = sanitizeTransportPayloadText(rawText);
          if (text.length === 0) {
            return false;
          }
          const key = eventIndexKey(eventIndex);
          let contentIndex = reasoningContentThinkingBlocks.get(key);
          let block =
            contentIndex === undefined
              ? undefined
              : (output.content[contentIndex] as TransportContentBlock | undefined);
          if (!block || block.type !== "thinking") {
            block = { type: "thinking", thinking: "", thinkingSignature: "reasoning_content" };
            output.content.push(block);
            contentIndex = output.content.length - 1;
            reasoningContentThinkingBlocks.set(key, contentIndex);
            eventSink.push({
              type: "thinking_start",
              contentIndex,
              partial: output as never,
            });
          }
          block.thinking += text;
          block.thinkingSignature = "reasoning_content";
          eventSink.push({
            type: "thinking_delta",
            contentIndex,
            delta: text,
            partial: output as never,
          });
          return true;
        };
        const appendReasoningContentTextDelta = (
          eventIndex: unknown,
          rawText: unknown,
        ): boolean => {
          if (typeof rawText !== "string") {
            return false;
          }
          const text = sanitizeTransportPayloadText(rawText);
          if (text.length === 0) {
            return false;
          }
          const key = eventIndexKey(eventIndex);
          let contentIndex = reasoningContentTextBlocks.get(key);
          let block =
            contentIndex === undefined
              ? undefined
              : (output.content[contentIndex] as TransportContentBlock | undefined);
          if (!block || block.type !== "text") {
            block = { type: "text", text: "" };
            output.content.push(block);
            contentIndex = output.content.length - 1;
            reasoningContentTextBlocks.set(key, contentIndex);
            eventSink.push({
              type: "text_start",
              contentIndex,
              partial: output as never,
            });
          }
          block.text += text;
          eventSink.push({
            type: "text_delta",
            contentIndex,
            delta: text,
            partial: output as never,
          });
          return true;
        };
        const finishReasoningContentSidecars = (eventIndex: unknown) => {
          const key = eventIndexKey(eventIndex);
          const thinkingContentIndex = reasoningContentThinkingBlocks.get(key);
          if (thinkingContentIndex !== undefined) {
            reasoningContentThinkingBlocks.delete(key);
            const block = output.content[thinkingContentIndex];
            if (block?.type === "thinking") {
              eventSink.push({
                type: "thinking_end",
                contentIndex: thinkingContentIndex,
                content: block.thinking,
                partial: output as never,
              });
            }
          }
          const textContentIndex = reasoningContentTextBlocks.get(key);
          if (textContentIndex === undefined) {
            return;
          }
          reasoningContentTextBlocks.delete(key);
          const block = output.content[textContentIndex];
          if (block?.type === "text") {
            eventSink.push({
              type: "text_end",
              contentIndex: textContentIndex,
              content: block.text,
              partial: output as never,
            });
          }
        };
        for await (const event of anthrozaicodercStream) {
          if (event.type === "error") {
            const error = event.error as { message?: string } | undefined;
            throw new Error(error?.message || "Anthrozaicoderc Messages stream failed");
          }
          if (event.type === "message_start") {
            const message = event.message as
              | { id?: string; model?: string; usage?: Record<string, unknown> }
              | undefined;
            const usage = message?.usage ?? {};
            output.responseId = typeof message?.id === "string" ? message.id : undefined;
            output.responseModel = typeof message?.model === "string" ? message.model : undefined;
            output.usage.input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
            output.usage.output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
            output.usage.cacheRead =
              typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
            output.usage.cacheWrite =
              typeof usage.cache_creation_input_tokens === "number"
                ? usage.cache_creation_input_tokens
                : 0;
            output.usage.totalTokens =
              output.usage.input +
              output.usage.output +
              output.usage.cacheRead +
              output.usage.cacheWrite;
            calculateCost(costModel, output.usage);
            // Defer start until after message_start so that pre-stream SSE errors
            // (e.g. invalid thinking signatures) arrive before any non-error event
            // is yielded, keezaicoderng yieldedOutput=false in pumpStreamWithRecovery
            // and allowing the thinking-block recovery retry to fire.
            eventSink.push({ type: "start", partial: output as never });
            continue;
          }
          if (event.type === "message_stop") {
            sawMessageStop = true;
            continue;
          }
          if (event.type === "content_block_start") {
            const contentBlock = event.content_block as Record<string, unknown> | undefined;
            const index = typeof event.index === "number" ? event.index : -1;
            const fallbackBoundary = refusalBuffer
              ? readAnthrozaicodercFallbackBoundary(contentBlock)
              : null;
            if (fallbackBoundary) {
              // Server-side fallback boundary: pre-boundary thinking/tool
              // blocks must not replay or execute, and the buffered preview
              // events reference them, so rebuild the deferred timeline from
              // the surviving text prefix the fallback model continued from.
              refusalBuffer?.discard();
              pendingTextEnds.length = 0;
              blockIndexes.clear();
              applyAnthrozaicodercFallbackBoundary({
                output,
                boundary: fallbackBoundary,
                provider: model.provider,
              });
              // Cost intentionally mirrors top-level usage (serving attempt at
              // serving-model rates). A mid-stream decline's billed partial is
              // only in usage.iterations and is not folded in here.
              costModel = { ...model, cost: CLAUDE_FABLE_5_FALLBACK_MODEL_COST };
              calculateCost(costModel, output.usage);
              eventSink.push({ type: "start", partial: output as never });
              for (let i = 0; i < output.content.length; i += 1) {
                const block = output.content[i];
                if (block.type !== "text") {
                  continue;
                }
                delete block.index;
                eventSink.push({
                  type: "text_start",
                  contentIndex: i,
                  partial: output as never,
                });
                if (block.text) {
                  eventSink.push({
                    type: "text_delta",
                    contentIndex: i,
                    delta: block.text,
                    partial: output as never,
                  });
                }
                pendingTextEnds.push({
                  type: "text_end",
                  contentIndex: i,
                  content: block.text,
                  partial: output as never,
                });
              }
              continue;
            }
            if (contentBlock?.type === "text") {
              const text =
                typeof contentBlock.text === "string"
                  ? sanitizeTransportPayloadText(contentBlock.text)
                  : "";
              const block: TransportContentBlock = { type: "text", text, index };
              output.content.push(block);
              const contentIndex = output.content.length - 1;
              blockIndexes.set(index, contentIndex);
              eventSink.push({
                type: "text_start",
                contentIndex,
                partial: output as never,
              });
              if (text.length > 0) {
                eventSink.push({
                  type: "text_delta",
                  contentIndex,
                  delta: text,
                  partial: output as never,
                });
              }
              continue;
            }
            if (contentBlock?.type === "thinking") {
              const thinking =
                typeof contentBlock.thinking === "string" ? contentBlock.thinking : "";
              const block: TransportContentBlock = {
                type: "thinking",
                thinking,
                thinkingSignature:
                  typeof contentBlock.signature === "string" ? contentBlock.signature : "",
                index,
              };
              output.content.push(block);
              const contentIndex = output.content.length - 1;
              blockIndexes.set(index, contentIndex);
              eventSink.push({
                type: "thinking_start",
                contentIndex,
                partial: output as never,
              });
              if (thinking.length > 0) {
                eventSink.push({
                  type: "thinking_delta",
                  contentIndex,
                  delta: thinking,
                  partial: output as never,
                });
              }
              continue;
            }
            if (contentBlock?.type === "redacted_thinking") {
              const block: TransportContentBlock = {
                type: "thinking",
                thinking: "[Reasoning redacted]",
                thinkingSignature: typeof contentBlock.data === "string" ? contentBlock.data : "",
                redacted: true,
                index,
              };
              output.content.push(block);
              blockIndexes.set(index, output.content.length - 1);
              eventSink.push({
                type: "thinking_start",
                contentIndex: output.content.length - 1,
                partial: output as never,
              });
              continue;
            }
            if (contentBlock?.type === "tool_use") {
              tagPendingCommentaryText(output.content);
              flushPendingTextEnds();
              const block: TransportContentBlock = {
                type: "toolCall",
                id: typeof contentBlock.id === "string" ? contentBlock.id : "",
                name:
                  typeof contentBlock.name === "string"
                    ? isOAuthToken
                      ? resolveOriginalAnthrozaicodercToolName(contentBlock.name, toolProjection)
                      : contentBlock.name
                    : "",
                arguments:
                  contentBlock.input && typeof contentBlock.input === "object"
                    ? (contentBlock.input as Record<string, unknown>)
                    : {},
                partialJson: "",
                index,
              };
              output.content.push(block);
              blockIndexes.set(index, output.content.length - 1);
              eventSink.push({
                type: "toolcall_start",
                contentIndex: output.content.length - 1,
                partial: output as never,
              });
            }
            continue;
          }
          if (event.type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown> | undefined;
            const eventIndex = typeof event.index === "number" ? event.index : undefined;
            let index = eventIndex === undefined ? undefined : blockIndexes.get(eventIndex);
            let block = index === undefined ? undefined : blocks[index];
            if (allowReasoningContentReplay) {
              const appendedThinking = appendReasoningContentThinkingDelta(
                event.index,
                delta?.reasoning_content,
              );
              const hasNativeAnthrozaicodercDelta =
                (delta?.type === "text_delta" && typeof delta.text === "string") ||
                (delta?.type === "thinking_delta" && typeof delta.thinking === "string") ||
                (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") ||
                (delta?.type === "signature_delta" && typeof delta.signature === "string");
              let appendedContent = false;
              if (
                !hasNativeAnthrozaicodercDelta &&
                typeof delta?.content === "string" &&
                delta.content.length > 0
              ) {
                const text = sanitizeTransportPayloadText(delta.content);
                if (text.length > 0) {
                  if (block?.type === "text") {
                    block.text += text;
                    eventSink.push({
                      type: "text_delta",
                      contentIndex: index,
                      delta: text,
                      partial: output as never,
                    });
                    appendedContent = true;
                  } else {
                    appendedContent = appendReasoningContentTextDelta(event.index, text);
                  }
                }
              }
              if ((appendedThinking || appendedContent) && !hasNativeAnthrozaicodercDelta) {
                continue;
              }
            }
            if (!block && delta?.type === "text_delta" && typeof delta.text === "string") {
              const recoveredIndex = typeof event.index === "number" ? event.index : blocks.length;
              block = { type: "text", text: "", index: recoveredIndex };
              output.content.push(block);
              index = output.content.length - 1;
              if (typeof event.index === "number") {
                blockIndexes.set(event.index, index);
              }
              eventSink.push({
                type: "text_start",
                contentIndex: index,
                partial: output as never,
              });
            }
            if (
              block?.type === "text" &&
              delta?.type === "text_delta" &&
              typeof delta.text === "string"
            ) {
              block.text += delta.text;
              eventSink.push({
                type: "text_delta",
                contentIndex: index,
                delta: delta.text,
                partial: output as never,
              });
              continue;
            }
            if (
              block?.type === "thinking" &&
              delta?.type === "thinking_delta" &&
              typeof delta.thinking === "string"
            ) {
              block.thinking += delta.thinking;
              eventSink.push({
                type: "thinking_delta",
                contentIndex: index,
                delta: delta.thinking,
                partial: output as never,
              });
              continue;
            }
            if (
              block?.type === "toolCall" &&
              delta?.type === "input_json_delta" &&
              typeof delta.partial_json === "string"
            ) {
              const partialJson = `${block.partialJson ?? ""}${delta.partial_json}`;
              block.partialJson = partialJson;
              block.arguments = parseAnthrozaicodercToolCallArguments(partialJson);
              eventSink.push({
                type: "toolcall_delta",
                contentIndex: index,
                delta: delta.partial_json,
                partial: output as never,
              });
              continue;
            }
            if (
              block?.type === "thinking" &&
              delta?.type === "signature_delta" &&
              typeof delta.signature === "string"
            ) {
              const signatureIndex = eventIndexKey(event.index);
              if (!signatureDeltaIndexes.has(signatureIndex)) {
                signatureDeltaIndexes.add(signatureIndex);
                block.thinkingSignature = "";
              }
              block.thinkingSignature = (block.thinkingSignature || "") + delta.signature;
            }
            continue;
          }
          if (event.type === "content_block_stop") {
            const eventIndex = typeof event.index === "number" ? event.index : undefined;
            const index = eventIndex === undefined ? undefined : blockIndexes.get(eventIndex);
            const block = index === undefined ? undefined : blocks[index];
            if (eventIndex === undefined || index === undefined || !block) {
              finishReasoningContentSidecars(event.index);
              continue;
            }
            blockIndexes.delete(eventIndex);
            delete block.index;
            if (block.type === "text") {
              pendingTextEnds.push({
                type: "text_end",
                contentIndex: index,
                content: block.text,
                partial: output as never,
              });
              finishReasoningContentSidecars(event.index);
              continue;
            }
            if (block.type === "thinking") {
              eventSink.push({
                type: "thinking_end",
                contentIndex: index,
                content: block.thinking,
                partial: output as never,
              });
              finishReasoningContentSidecars(event.index);
              continue;
            }
            if (block.type === "toolCall") {
              if (typeof block.partialJson === "string" && block.partialJson.length > 0) {
                block.arguments = parseAnthrozaicodercToolCallArguments(block.partialJson);
              }
              delete block.partialJson;
              eventSink.push({
                type: "toolcall_end",
                contentIndex: index,
                toolCall: block as never,
                partial: output as never,
              });
              finishReasoningContentSidecars(event.index);
            }
            continue;
          }
          if (event.type === "message_delta") {
            const delta = event.delta as
              | { stop_reason?: string; stop_details?: unknown }
              | undefined;
            const usage = event.usage as Record<string, unknown> | undefined;
            if (delta?.stop_reason) {
              if (delta.stop_reason === "refusal") {
                applyAnthrozaicodercRefusal(output, delta.stop_details, model.provider);
              } else {
                output.stopReason = mapStopReason(delta.stop_reason);
              }
            }
            if (typeof usage?.input_tokens === "number") {
              output.usage.input = usage.input_tokens;
            }
            if (typeof usage?.output_tokens === "number") {
              output.usage.output = usage.output_tokens;
            }
            if (typeof usage?.cache_read_input_tokens === "number") {
              output.usage.cacheRead = usage.cache_read_input_tokens;
            }
            if (typeof usage?.cache_creation_input_tokens === "number") {
              output.usage.cacheWrite = usage.cache_creation_input_tokens;
            }
            output.usage.totalTokens =
              output.usage.input +
              output.usage.output +
              output.usage.cacheRead +
              output.usage.cacheWrite;
            calculateCost(costModel, output.usage);
            // Gate on the turn CONTAINING a tool call, not the provider's stop_reason
            // label: Bedrock/Vertex-proxied routes (e.g. zaicoderoneer) report "end_turn" on
            // tool-using turns. No-op for direct Anthrozaicoderc (already "toolUse" here).
            if (
              output.stopReason === "toolUse" ||
              output.content.some((block) => block.type === "toolCall")
            ) {
              tagPendingCommentaryText(output.content);
            }
            flushPendingTextEnds();
          }
        }
        if (refusalBuffer && !sawMessageStop) {
          throw new Error("Anthrozaicoderc stream ended before message_stop");
        }
        if (transportOptions.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        if (output.stopReason === "aborted" || output.stopReason === "error") {
          throw new Error(output.errorMessage ?? "An unknown error occurred");
        }
        refusalBuffer?.flush();
        // Backstop: streaming tags commentary at the tool-boundary above, but
        // replay/non-streaming assembly may reach here with tool calls untagged.
        // Idempotent, so it never double-tags the streaming path. Gate on the turn
        // containing a tool call (not stop_reason) so proxied Bedrock/Vertex routes
        // that mislabel tool turns as "end_turn" still tag their narration.
        if (
          output.stopReason === "toolUse" ||
          output.content.some((block) => block.type === "toolCall")
        ) {
          tagPendingCommentaryText(output.content);
        }
        flushPendingTextEnds();
        finalizeTransportStream({ stream, output });
      } catch (error) {
        if (refusalBuffer) {
          refusalBuffer.discard();
          output.content = [];
        }
        failTransportStream({
          stream,
          output,
          signal: options?.signal,
          error,
          cleanup: () => {
            for (const block of output.content) {
              delete block.index;
            }
          },
        });
      }
    })();
    return eventStream as ReturnType<StreamFn>;
  };
}
