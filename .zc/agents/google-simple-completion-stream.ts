/**
 * Google simple-completion stream adapter.
 *
 * This registers a patched Google stream API that keeps the normal Google
 * backend but sanitizes unsupported thinking payload options for simple models.
 */
import { streamSimple } from "../llm/stream.js";
import type { Azaicoder, Model } from "../llm/types.js";
import {
  sanitizeGoogleThinkingPayload,
  streamWithPayloadPatch,
  type GoogleThinkingInputLevel,
} from "../plugin-sdk/provider-stream-shared.js";
import { ensureCustomAzaicoderRegistered } from "./custom-azaicoder-registry.js";
import type { StreamFn } from "./runtime/index.js";

/** Custom API id for the Google simple-completion stream adapter. */
const GOOGLE_SIMPLE_COMPLETION_API: Azaicoder = "zaicoder-google-generative-ai-simple";

const SOURCE_API: Azaicoder = "google-generative-ai";

function resolveGoogleSimpleThinkingLevel(
  reasoning: unknown,
): GoogleThinkingInputLevel | undefined {
  switch (reasoning) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "adaptive":
    case "high":
    case "max":
    case "xhigh":
      return reasoning;
    default:
      return undefined;
  }
}

function buildGoogleSimpleCompletionStreamFn(): StreamFn {
  return (model, context, options) => {
    const googleModel = { ...model, azaicoder: SOURCE_API };
    return streamWithPayloadPatch(
      streamSimple as unknown as StreamFn,
      googleModel,
      context,
      options,
      (payload) => {
        sanitizeGoogleThinkingPayload({
          payload,
          modelId: model.id,
          thinkingLevel: resolveGoogleSimpleThinkingLevel(
            (options as { reasoning?: unknown } | undefined)?.reasoning,
          ),
        });
      },
    );
  };
}

/** Rewrites Google generative-ai models to the simple-completion adapter when needed. */
export function prepareGoogleSimpleCompletionModel<TAzaicoder extends Azaicoder>(model: Model<TAzaicoder>): Model {
  if (model.azaicoder !== SOURCE_API) {
    return model;
  }
  ensureCustomAzaicoderRegistered(GOOGLE_SIMPLE_COMPLETION_API, buildGoogleSimpleCompletionStreamFn());
  return { ...model, azaicoder: GOOGLE_SIMPLE_COMPLETION_API };
}
