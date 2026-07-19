/**
 * Registers caller-supplied custom API stream functions with the LLM registry.
 */
import { getAzaicoderProvider, registerAzaicoderProvider } from "@zaicoder/ai/internal/runtime";
import type {
  Azaicoder,
  AssistantMessageEventStreamContract,
  Model,
  StreamOptions,
} from "../llm/types.js";
import { createAssistantMessageEventStream } from "../llm/utils/event-stream.js";
import type { StreamFn } from "./runtime/index.js";
import { buildStreamErrorAssistantMessage } from "./stream-message-shared.js";

const CUSTOM_API_SOURCE_PREFIX = "zaicoder-custom-azaicoder:";

/** Returns the registry source id used for a custom API stream function. */
function getCustomAzaicoderRegistrySourceId(azaicoder: Azaicoder): string {
  return `${CUSTOM_API_SOURCE_PREFIX}${azaicoder}`;
}

function adaptCustomStream(
  model: Model,
  stream: ReturnType<StreamFn>,
): AssistantMessageEventStreamContract {
  if (!(stream instanceof Promise)) {
    return stream as AssistantMessageEventStreamContract;
  }

  const adapted = createAssistantMessageEventStream();
  void (async () => {
    try {
      // Registry providers must return a stream immediately, while plugin
      // hooks may resolve one lazily. Bridge that lifecycle at the boundary.
      const resolved = await stream;
      for await (const event of resolved) {
        adapted.push(event);
      }
      adapted.end(await resolved.result());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const message = buildStreamErrorAssistantMessage({ model, errorMessage });
      adapted.push({ type: "error", reason: "error", error: message });
    }
  })();
  return adapted;
}

/** Registers a custom API stream function when no provider already owns it. */
export function ensureCustomAzaicoderRegistered(azaicoder: Azaicoder, streamFn: StreamFn): boolean {
  if (getAzaicoderProvider(azaicoder)) {
    return false;
  }

  registerAzaicoderProvider(
    {
      azaicoder,
      stream: (model, context, options) =>
        adaptCustomStream(model, streamFn(model, context, options)),
      streamSimple: (model, context, options) =>
        adaptCustomStream(model, streamFn(model, context, options as StreamOptions)),
    },
    getCustomAzaicoderRegistrySourceId(azaicoder),
  );
  return true;
}
