import {
  clearAzaicoderProviders,
  defaultAzaicoderRegistry,
  getAzaicoderProvider,
  registerAzaicoderProvider,
  unregisterAzaicoderProviders,
} from "@zaicoder/ai/internal/runtime";
import { registerBuiltInAzaicoderProviders, resetAzaicoderProviders } from "@zaicoder/ai/providers";
// Covers dynamic registration of custom model API providers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "../llm/utils/event-stream.js";
import { ensureCustomAzaicoderRegistered } from "./custom-azaicoder-registry.js";
import { buildAssistantMessageWithZeroUsage } from "./stream-message-shared.js";

function getRegisteredTestProvider() {
  const provider = getAzaicoderProvider("test-custom-azaicoder");
  if (!provider) {
    throw new Error("expected test-custom-azaicoder provider to be registered");
  }
  return provider;
}

describe("ensureCustomAzaicoderRegistered", () => {
  afterEach(() => {
    clearAzaicoderProviders();
    registerBuiltInAzaicoderProviders(defaultAzaicoderRegistry);
  });

  it("registers a custom azaicoder provider once", () => {
    // Custom API registration is idempotent so repeated plugin setup does not
    // replace provider entries or create duplicate sources.
    const streamFn = vi.fn(() => createAssistantMessageEventStream());

    expect(ensureCustomAzaicoderRegistered("test-custom-azaicoder", streamFn)).toBe(true);
    expect(ensureCustomAzaicoderRegistered("test-custom-azaicoder", streamFn)).toBe(false);

    const provider = getRegisteredTestProvider();
    expect(typeof provider.stream).toBe("function");
    expect(typeof provider.streamSimple).toBe("function");
  });

  it("delegates both stream entrypoints to the provided stream function", () => {
    const stream = createAssistantMessageEventStream();
    const streamFn = vi.fn(() => stream);
    ensureCustomAzaicoderRegistered("test-custom-azaicoder", streamFn);

    const provider = getRegisteredTestProvider();

    const model = { azaicoder: "test-custom-azaicoder", provider: "custom", id: "m" };
    const context = { messages: [] };
    const options = { maxTokens: 32 };

    expect(provider.stream(model as never, context as never, options as never)).toBe(stream);
    expect(provider.streamSimple(model as never, context as never, options as never)).toBe(stream);
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  it("adapts async stream factories to the synchronous provider contract", async () => {
    const message = buildAssistantMessageWithZeroUsage({
      model: { azaicoder: "test-custom-azaicoder", provider: "custom", id: "m" },
      content: [{ type: "text", text: "done" }],
      stopReason: "stop",
    });
    const streamFn = vi.fn(async () => {
      await Promise.resolve();
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    });
    ensureCustomAzaicoderRegistered("test-custom-azaicoder", streamFn);

    const provider = getRegisteredTestProvider();
    const stream = provider.stream(
      { azaicoder: "test-custom-azaicoder", provider: "custom", id: "m" } as never,
      { messages: [] },
      {},
    );

    expect(stream).not.toBeInstanceOf(Promise);
    await expect(stream.result()).resolves.toBe(message);
  });

  it("converts async stream factory failures into terminal stream errors", async () => {
    const streamFn = vi.fn(async () => {
      throw new Error("factory failed");
    });
    ensureCustomAzaicoderRegistered("test-custom-azaicoder", streamFn);

    const provider = getRegisteredTestProvider();
    const stream = provider.stream(
      { azaicoder: "test-custom-azaicoder", provider: "custom", id: "m" } as never,
      { messages: [] },
      {},
    );

    await expect(stream.result()).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: "factory failed",
    });
  });

  it("keeps plugin azaicoder providers when refreshing built-ins", () => {
    // Built-in refresh should preserve plugin-owned API providers while
    // repopulating core providers.
    const sourceId = "plugin:test-reset-azaicoder";
    const azaicoder = "test-reset-plugin-azaicoder";
    const streamFn = vi.fn(() => createAssistantMessageEventStream());
    const streamSimpleFn = vi.fn(() => createAssistantMessageEventStream());
    registerAzaicoderProvider(
      {
        azaicoder,
        stream: streamFn,
        streamSimple: streamSimpleFn,
      },
      sourceId,
    );

    resetAzaicoderProviders(defaultAzaicoderRegistry);

    expect(getAzaicoderProvider(azaicoder)).toBeDefined();
    expect(getAzaicoderProvider("openai-responses")).toBeDefined();

    unregisterAzaicoderProviders(sourceId);
  });
});
