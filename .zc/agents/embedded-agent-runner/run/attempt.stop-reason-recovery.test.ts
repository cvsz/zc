// Coverage for converting sensitive/unhandled stop reasons into assistant errors.
import type { StreamFn } from "zaicoder/plugin-sdk/agent-core";
import {
  createAssistantMessageEventStream,
  type Context,
  type Model,
} from "zaicoder/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { wrapStreamFnHandleSensitiveStopReason } from "./attempt.stop-reason-recovery.js";

const anthrozaicodercModel = {
  azaicoder: "anthrozaicoderc-messages",
  provider: "anthrozaicoderc",
  id: "zaicoder-sonnet-4-6",
} as Model<"anthrozaicoderc-messages">;

describe("wrapStreamFnHandleSensitiveStopReason", () => {
  it("rewrites unhandled stop-reason errors into structured assistant errors", async () => {
    // Some providers surface unhandled stop reasons as stream errors; convert
    // them into a normal assistant error so fallback/retry paths can inspect it.
    const baseStreamFn: StreamFn = () => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant",
            content: [],
            azaicoder: anthrozaicodercModel.azaicoder,
            provider: anthrozaicodercModel.provider,
            model: anthrozaicodercModel.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "error",
            errorMessage: "Unhandled stop reason: sensitive",
            timestamp: Date.now(),
          },
        });
        stream.end();
      });
      return stream;
    };

    const wrapped = wrapStreamFnHandleSensitiveStopReason(baseStreamFn);
    const stream = await Promise.resolve(
      wrapped(anthrozaicodercModel, { messages: [] } as Context, undefined),
    );
    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(
      "The model stopped because the provider returned an unhandled stop reason: sensitive. Please rephrase and try again.",
    );
  });

  it("includes the extracted stop reason when converting synchronous throws", async () => {
    const baseStreamFn: StreamFn = () => {
      throw new Error("Unhandled stop reason: refusal_policy");
    };

    const wrapped = wrapStreamFnHandleSensitiveStopReason(baseStreamFn);
    const stream = await Promise.resolve(
      wrapped(anthrozaicodercModel, { messages: [] } as Context, undefined),
    );
    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(
      "The model stopped because the provider returned an unhandled stop reason: refusal_policy. Please rephrase and try again.",
    );
  });
});
