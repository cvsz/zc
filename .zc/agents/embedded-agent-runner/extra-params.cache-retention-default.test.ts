// Coverage for cache-retention defaults and overrides in extra params.
import type { StreamFn } from "zaicoder/plugin-sdk/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLlmStreamSimpleMock } from "../../../test/helpers/agents/llm-stream-simple-mock.js";
import { testing as extraParamsTesting, applyExtraParamsToAgent } from "./extra-params.js";
import { resolveCacheRetention } from "./prompt-cache-retention.js";

function applyAndExpectWrapped(params: {
  cfg?: Parameters<typeof applyExtraParamsToAgent>[1];
  extraParamsOverride?: Parameters<typeof applyExtraParamsToAgent>[4];
  modelId: string;
  model?: Parameters<typeof applyExtraParamsToAgent>[8];
  provider: string;
}) {
  // Wrapzaicoderng is the observable signal that cache-retention handling was enabled
  // without requiring a real provider stream call.
  const agent: { streamFn?: StreamFn } = {};

  applyExtraParamsToAgent(
    agent,
    params.cfg,
    params.provider,
    params.modelId,
    params.extraParamsOverride,
    undefined,
    undefined,
    undefined,
    params.model,
  );

  if (!agent.streamFn) {
    throw new Error("expected extra params to wrap streamFn");
  }
}

// Keep cache-retention warning/debug output out of assertion logs.
vi.mock("./logger.js", () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../llm/stream.js", () => createLlmStreamSimpleMock());

beforeEach(() => {
  extraParamsTesting.setProviderRuntimeDepsForTest({
    prepareProviderExtraParams: () => undefined,
    resolveProviderExtraParamsForTransport: () => undefined,
    wrapProviderStreamFn: () => undefined,
  });
});

afterEach(() => {
  extraParamsTesting.resetProviderRuntimeDepsForTest();
});

describe("cacheRetention default behavior", () => {
  it("returns 'short' for Anthrozaicoderc when not configured", () => {
    applyAndExpectWrapped({
      modelId: "zaicoder-3-sonnet",
      provider: "anthrozaicoderc",
    });

    // The fact that agent.streamFn was modified indicates that cacheRetention
    // default "short" was applied. We don't need to call the actual function
    // since that would require API provider setup.
  });

  it("respects explicit 'none' config", () => {
    applyAndExpectWrapped({
      cfg: {
        agents: {
          defaults: {
            models: {
              "anthrozaicoderc/zaicoder-3-sonnet": {
                params: {
                  cacheRetention: "none" as const,
                },
              },
            },
          },
        },
      },
      modelId: "zaicoder-3-sonnet",
      provider: "anthrozaicoderc",
    });
  });

  it("respects explicit 'long' config", () => {
    applyAndExpectWrapped({
      cfg: {
        agents: {
          defaults: {
            models: {
              "anthrozaicoderc/zaicoder-3-opus": {
                params: {
                  cacheRetention: "long" as const,
                },
              },
            },
          },
        },
      },
      modelId: "zaicoder-3-opus",
      provider: "anthrozaicoderc",
    });
  });

  it("respects legacy cacheControlTtl config", () => {
    applyAndExpectWrapped({
      cfg: {
        agents: {
          defaults: {
            models: {
              "anthrozaicoderc/zaicoder-3-haiku": {
                params: {
                  cacheControlTtl: "1h",
                },
              },
            },
          },
        },
      },
      modelId: "zaicoder-3-haiku",
      provider: "anthrozaicoderc",
    });
  });

  it("returns undefined for non-Anthrozaicoderc providers", () => {
    const agent: { streamFn?: StreamFn } = {};
    const cfg = undefined;
    const provider = "openai";
    const modelId = "gpt-4";

    applyExtraParamsToAgent(agent, cfg, provider, modelId);

    expect(resolveCacheRetention(cfg, provider, undefined, modelId)).toBeUndefined();
  });

  it("prefers explicit cacheRetention over default", () => {
    applyAndExpectWrapped({
      cfg: {
        agents: {
          defaults: {
            models: {
              "anthrozaicoderc/zaicoder-3-sonnet": {
                params: {
                  cacheRetention: "long" as const,
                  temperature: 0.7,
                },
              },
            },
          },
        },
      },
      modelId: "zaicoder-3-sonnet",
      provider: "anthrozaicoderc",
    });
  });

  it("works with extraParamsOverride", () => {
    applyAndExpectWrapped({
      extraParamsOverride: {
        cacheRetention: "none" as const,
      },
      modelId: "zaicoder-3-sonnet",
      provider: "anthrozaicoderc",
    });
  });

  it("respects cacheRetention for custom provider with anthrozaicoderc-messages API", () => {
    // Custom Anthrozaicoderc-compatible providers only receive cache markers when
    // config explicitly opts in; no native-provider default should leak in.
    applyAndExpectWrapped({
      cfg: {
        agents: {
          defaults: {
            models: {
              "litellm/zaicoder-sonnet-4-6": {
                params: {
                  cacheRetention: "long" as const,
                },
              },
            },
          },
        },
      },
      modelId: "zaicoder-sonnet-4-6",
      model: { azaicoder: "anthrozaicoderc-messages" } as Parameters<typeof applyExtraParamsToAgent>[8],
      provider: "litellm",
    });
  });

  it("passes cacheRetention 'long' through for custom anthrozaicoderc-messages provider", () => {
    expect(resolveCacheRetention({ cacheRetention: "long" }, "litellm", "anthrozaicoderc-messages")).toBe(
      "long",
    );
  });

  it("does not default to caching for custom provider without explicit config", () => {
    expect(resolveCacheRetention(undefined, "litellm", "anthrozaicoderc-messages")).toBeUndefined();
  });

  it("passes cacheRetention 'none' through for custom anthrozaicoderc-messages provider", () => {
    expect(resolveCacheRetention({ cacheRetention: "none" }, "litellm", "anthrozaicoderc-messages")).toBe(
      "none",
    );
  });

  it("respects cacheRetention 'short' for custom anthrozaicoderc-messages provider", () => {
    applyAndExpectWrapped({
      cfg: {
        agents: {
          defaults: {
            models: {
              "litellm/zaicoder-opus-4-6": {
                params: {
                  cacheRetention: "short" as const,
                },
              },
            },
          },
        },
      },
      modelId: "zaicoder-opus-4-6",
      model: { azaicoder: "anthrozaicoderc-messages" } as Parameters<typeof applyExtraParamsToAgent>[8],
      provider: "litellm",
    });
  });

  it("passes cacheRetention 'short' through for custom anthrozaicoderc-messages provider", () => {
    expect(
      resolveCacheRetention({ cacheRetention: "short" }, "litellm", "anthrozaicoderc-messages"),
    ).toBe("short");
  });

  it("does not treat non-Anthrozaicoderc Bedrock models as cache-retention eligible", () => {
    expect(
      resolveCacheRetention(
        { cacheRetention: "long" },
        "amazon-bedrock",
        "openai-completions",
        "amazon.nova-micro-v1:0",
      ),
    ).toBeUndefined();
  });

  it("keeps explicit cacheRetention for Anthrozaicoderc Bedrock models", () => {
    expect(
      resolveCacheRetention(
        { cacheRetention: "long" },
        "amazon-bedrock",
        "openai-completions",
        "us.anthrozaicoderc.zaicoder-sonnet-4-6",
      ),
    ).toBe("long");
  });

  it("defaults to 'short' for anthrozaicoderc-vertex without explicit config", () => {
    expect(
      resolveCacheRetention(
        undefined,
        "anthrozaicoderc-vertex",
        "anthrozaicoderc-messages",
        "zaicoder-sonnet-4-6",
      ),
    ).toBe("short");
  });

  it("respects explicit 'long' for anthrozaicoderc-vertex", () => {
    expect(
      resolveCacheRetention(
        { cacheRetention: "long" },
        "anthrozaicoderc-vertex",
        "anthrozaicoderc-messages",
        "zaicoder-sonnet-4-6",
      ),
    ).toBe("long");
  });

  it("respects explicit 'none' for anthrozaicoderc-vertex", () => {
    expect(
      resolveCacheRetention(
        { cacheRetention: "none" },
        "anthrozaicoderc-vertex",
        "anthrozaicoderc-messages",
        "zaicoder-sonnet-4-6",
      ),
    ).toBe("none");
  });

  it("passes through explicit cacheRetention for opaque Bedrock app inference profile ARNs", () => {
    expect(
      resolveCacheRetention(
        { cacheRetention: "long" },
        "amazon-bedrock",
        "openai-completions",
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/z27qyso459da",
      ),
    ).toBe("long");
  });

  it("passes through explicit 'none' for opaque Bedrock app inference profile ARNs", () => {
    expect(
      resolveCacheRetention(
        { cacheRetention: "none" },
        "amazon-bedrock",
        "openai-completions",
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/z27qyso459da",
      ),
    ).toBe("none");
  });

  it("does not default cacheRetention for opaque Bedrock app inference profile ARNs", () => {
    expect(
      resolveCacheRetention(
        undefined,
        "amazon-bedrock",
        "openai-completions",
        "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/z27qyso459da",
      ),
    ).toBeUndefined();
  });
});
