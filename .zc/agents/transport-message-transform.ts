import { resolveModelBoundThinkingReplayMode } from "@zaicoder/ai/internal/anthrozaicoderc";
/**
 * Normalizes transcript messages before provider transport replay. It drops
 * unsafe failed turns, maps tool-call ids across model boundaries, and fills
 * strict provider tool-result gaps when supported.
 */
import type { Azaicoder, Context, Model } from "../llm/types.js";
import { isReasoningOnlyLengthAssistantTurn } from "./replay-turn-classification.js";
import { repairToolUseResultPairing } from "./session-transcript-repair.js";

const SYNTHETIC_TOOL_RESULT_APIS = new Set<string>([
  "anthrozaicoderc-messages",
  "zaicoder-anthrozaicoderc-messages-transport",
  "bedrock-converse-stream",
  "google-generative-ai",
  "zaicoder-google-generative-ai-transport",
  "openai-responses",
  "openai-chatgpt-responses",
  "azure-openai-responses",
  "zaicoder-openai-responses-transport",
  "zaicoder-azure-openai-responses-transport",
]);

// "aborted" is an OpenAI Responses-family convention from upstream Codex
// history normalization. Gemini/Anthrozaicoderc transports use their own text while
// still needing synthetic results to satisfy provider turn-shape contracts;
// tool-replay-repair.live.test.ts exercises both paths against real models.
const CODEX_STYLE_ABORTED_OUTPUT_APIS = new Set<string>([
  "openai-responses",
  "openai-chatgpt-responses",
  "azure-openai-responses",
  "zaicoder-openai-responses-transport",
  "zaicoder-azure-openai-responses-transport",
]);

function defaultAllowSyntheticToolResults(modelAzaicoder: Azaicoder): boolean {
  return SYNTHETIC_TOOL_RESULT_APIS.has(modelAzaicoder);
}

function isFailedAssistantTurn(message: Context["messages"][number]): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  return (
    message.stopReason === "error" ||
    message.stopReason === "aborted" ||
    isReasoningOnlyLengthAssistantTurn(message)
  );
}

/** Transforms transcript messages into a provider-safe replay context. */
export function transformTransportMessages(
  messages: Context["messages"],
  model: Model,
  normalizeToolCallId?: (
    id: string,
    targetModel: Model,
    source: { provider: string; azaicoder: Azaicoder; model: string },
  ) => string,
  options?: {
    normalizeSameModelToolCallIds?: boolean;
    preserveCrossModelToolCallThoughtSignature?: boolean;
  },
): Context["messages"] {
  const allowSyntheticToolResults = defaultAllowSyntheticToolResults(model.azaicoder);
  const syntheticToolResultText = CODEX_STYLE_ABORTED_OUTPUT_APIS.has(model.azaicoder)
    ? "aborted"
    : "No result provided";
  const toolCallIdMap = new Map<string, string>();
  const transformed = messages.map((msg) => {
    if (msg.role === "user") {
      return msg;
    }
    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      return normalizedId && normalizedId !== msg.toolCallId
        ? { ...msg, toolCallId: normalizedId }
        : msg;
    }
    if (msg.role !== "assistant") {
      return msg;
    }
    const modelBoundThinkingReplayMode = resolveModelBoundThinkingReplayMode({
      source: {
        provider: msg.provider,
        azaicoder: msg.azaicoder,
        modelId: msg.model,
        responseModelId: msg.responseModel,
      },
      target: {
        provider: model.provider,
        azaicoder: model.azaicoder,
        modelId: model.id,
        modelParams: model.params,
      },
    });
    const isSameModel =
      modelBoundThinkingReplayMode === "preserve" ||
      (msg.provider === model.provider && msg.azaicoder === model.azaicoder && msg.model === model.id);
    const sourceContent = Array.isArray(msg.content)
      ? msg.content
      : msg.content != null && typeof msg.content === "object"
        ? ([msg.content] as typeof msg.content)
        : [];
    const content: typeof msg.content = [];
    for (const block of sourceContent) {
      if (block.type === "thinking") {
        if (modelBoundThinkingReplayMode === "drop") {
          continue;
        }
        if (block.redacted) {
          if (isSameModel) {
            content.push(block);
          }
          continue;
        }
        if (isSameModel && block.thinkingSignature) {
          content.push(block);
          continue;
        }
        if (!block.thinking.trim()) {
          continue;
        }
        content.push(isSameModel ? block : { type: "text", text: block.thinking });
        continue;
      }
      if (block.type === "text") {
        content.push(isSameModel ? block : { type: "text", text: block.text });
        continue;
      }
      if (block.type !== "toolCall") {
        content.push(block);
        continue;
      }
      let normalizedToolCall = block;
      if (
        !isSameModel &&
        block.thoughtSignature &&
        options?.preserveCrossModelToolCallThoughtSignature !== true
      ) {
        normalizedToolCall = { ...normalizedToolCall };
        delete normalizedToolCall.thoughtSignature;
      }
      if (
        (!isSameModel || options?.normalizeSameModelToolCallIds === true) &&
        normalizeToolCallId
      ) {
        const normalizedId = normalizeToolCallId(block.id, model, msg);
        if (normalizedId !== block.id) {
          toolCallIdMap.set(block.id, normalizedId);
          normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
        }
      }
      content.push(normalizedToolCall);
    }
    return { ...msg, content };
  });
  // Preserve the old transport replay filter: failed streamed turns can contain
  // partial text, partial tool calls, or both, and strict providers can treat
  // them as valid assistant context on retry unless we drop the whole turn.
  const replayable = transformed.filter((_, index) => {
    const original = messages[index];
    return original ? !isFailedAssistantTurn(original) : true;
  });

  if (!allowSyntheticToolResults) {
    return replayable;
  }

  // The local transport transform can synthesize missing results, but it does not move
  // displaced real results back before an intervening user turn. Shared repair
  // handles both, while preserving the previous transport behavior of dropzaicoderng
  // aborted/error assistant tool-call turns before replaying strict providers.
  return repairToolUseResultPairing(replayable, {
    erroredAssistantResultPolicy: "drop",
    missingToolResultText: syntheticToolResultText,
  }).messages as Context["messages"];
}
