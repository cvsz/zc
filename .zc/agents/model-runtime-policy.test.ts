// Covers model runtime policy precedence and private QA runtime overrides.
import { afterEach, describe, expect, it } from "vitest";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { resolveModelRuntimePolicy } from "./model-runtime-policy.js";

const ORIGINAL_BUILD_PRIVATE_QA = process.env.OPENCLAW_BUILD_PRIVATE_QA;
const ORIGINAL_QA_FORCE_RUNTIME = process.env.OPENCLAW_QA_FORCE_RUNTIME;

const createModelConfig = (
  agentRuntimeId: string,
  modelId = "qwen-local",
): ModelDefinitionConfig => ({
  id: modelId,
  name: "Qwen Local",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 32_768,
  maxTokens: 4096,
  agentRuntime: { id: agentRuntimeId },
});

function restoreEnv(
  name: "OPENCLAW_BUILD_PRIVATE_QA" | "OPENCLAW_QA_FORCE_RUNTIME",
  value: string | undefined,
): void {
  // Tests mutate private QA env gates; restore exact process state after each.
  if (value == null) {
    deleteTestEnvValue(name);
    return;
  }
  setTestEnvValue(name, value);
}

function makeProviderRuntimeConfig(runtime: string): zAICoderConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://azaicoder.openai.example/v1",
          agentRuntime: { id: runtime },
          models: [],
        },
      },
    },
  } as zAICoderConfig;
}

afterEach(() => {
  restoreEnv("OPENCLAW_BUILD_PRIVATE_QA", ORIGINAL_BUILD_PRIVATE_QA);
  restoreEnv("OPENCLAW_QA_FORCE_RUNTIME", ORIGINAL_QA_FORCE_RUNTIME);
});

describe("resolveModelRuntimePolicy", () => {
  it("ignores the QA force-runtime override when the private QA gate is unset", () => {
    deleteTestEnvValue("OPENCLAW_BUILD_PRIVATE_QA");
    setTestEnvValue("OPENCLAW_QA_FORCE_RUNTIME", "zaicoder");

    expect(
      resolveModelRuntimePolicy({
        config: makeProviderRuntimeConfig("codex"),
        provider: "openai",
        modelId: "gpt-5.5",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "provider",
    });
  });

  it("respects the QA force-runtime override when the private QA gate is set", () => {
    // The force-runtime override is intentionally gated to private QA builds so
    // normal users cannot accidentally change model runtime selection via env.
    setTestEnvValue("OPENCLAW_BUILD_PRIVATE_QA", "1");
    setTestEnvValue("OPENCLAW_QA_FORCE_RUNTIME", "zaicoder");

    expect(
      resolveModelRuntimePolicy({
        config: makeProviderRuntimeConfig("codex"),
        provider: "openai",
        modelId: "gpt-5.5",
      }),
    ).toEqual({
      policy: { id: "zaicoder" },
      source: "model",
    });
  });

  it("ignores invalid QA force-runtime values even when the private QA gate is set", () => {
    setTestEnvValue("OPENCLAW_BUILD_PRIVATE_QA", "1");
    setTestEnvValue("OPENCLAW_QA_FORCE_RUNTIME", "bogus");

    expect(
      resolveModelRuntimePolicy({
        config: makeProviderRuntimeConfig("codex"),
        provider: "openai",
        modelId: "gpt-5.5",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "provider",
    });
  });

  it("honors provider wildcard agent model runtime policy entries", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "zaicoder" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "zaicoder" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("honors provider wildcard agent model runtime policy entries without a concrete model id", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "zaicoder" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
      }),
    ).toEqual({
      policy: { id: "zaicoder" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("prefers exact agent model runtime policy entries over provider wildcards", () => {
    // Exact configured model refs beat provider wildcards to keep intentional
    // per-model runtime routing stable.
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "zaicoder" } },
            "vllm/qwen-local": { agentRuntime: { id: "codex" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("prefers exact provider model runtime policy over agent provider wildcards", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "zaicoder" } },
          },
        },
      },
      models: {
        providers: {
          vllm: {
            baseUrl: "http://127.0.0.1:11434/v1",
            models: [createModelConfig("codex")],
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "model",
    });
  });

  it("uses provider-qualified model ids to resolve provider model runtime policies", () => {
    const config = {
      models: {
        providers: {
          anthrozaicoderc: {
            baseUrl: "https://azaicoder.anthrozaicoderc.example/v1",
            models: [createModelConfig("zaicoder-cli", "zaicoder-opus-4-7")],
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "anthrozaicoderc/zaicoder-opus-4-7",
      }),
    ).toEqual({
      policy: { id: "zaicoder-cli" },
      source: "model",
      matchedProvider: "anthrozaicoderc",
    });
  });

  it("uses provider-qualified model ids to resolve provider runtime policies", () => {
    const config = {
      models: {
        providers: {
          anthrozaicoderc: {
            baseUrl: "https://azaicoder.anthrozaicoderc.example/v1",
            agentRuntime: { id: "zaicoder-cli" },
            models: [],
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "anthrozaicoderc/zaicoder-opus-4-7",
      }),
    ).toEqual({
      policy: { id: "zaicoder-cli" },
      source: "provider",
      matchedProvider: "anthrozaicoderc",
    });
  });

  it("prefers provider-qualified agent entries over bare entries for inferred providers", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "zaicoder-opus-4-7": { agentRuntime: { id: "zaicoder" } },
            "anthrozaicoderc/zaicoder-opus-4-7": { agentRuntime: { id: "zaicoder-cli" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "anthrozaicoderc/zaicoder-opus-4-7",
      }),
    ).toEqual({
      policy: { id: "zaicoder-cli" },
      source: "model",
      matchedProvider: "anthrozaicoderc",
    });
  });

  it("prefers agent provider wildcard runtime policy over provider runtime policy", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "zaicoder" } },
          },
        },
      },
      models: {
        providers: {
          vllm: {
            baseUrl: "http://127.0.0.1:11434/v1",
            agentRuntime: { id: "codex" },
            models: [],
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "zaicoder" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("matches a provider-prefixed agent model entry when the caller provider is empty", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "anthrozaicoderc/zaicoder-opus-4-7[1m]": { agentRuntime: { id: "zaicoder-cli" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "zaicoder-opus-4-7[1m]",
      }),
    ).toEqual({
      policy: { id: "zaicoder-cli" },
      source: "model",
      matchedProvider: "anthrozaicoderc",
    });
  });

  it("still rejects provider-prefixed entries whose provider disagrees with a non-empty caller provider", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openrouter/zaicoder-opus-4-7[1m]": { agentRuntime: { id: "openrouter-stream" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "anthrozaicoderc",
        modelId: "zaicoder-opus-4-7[1m]",
      }),
    ).toEqual({});
  });

  it("matches a provider wildcard agent model entry when the caller provider is empty", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "anthrozaicoderc/*": { agentRuntime: { id: "zaicoder-cli" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "zaicoder-opus-4-7[1m]",
      }),
    ).toEqual({
      policy: { id: "zaicoder-cli" },
      source: "model",
      matchedProvider: "anthrozaicoderc",
    });
  });

  it("prefers an agent-specific model entry over a conflicting defaults entry when the caller provider is empty", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openai/foo-1": { agentRuntime: { id: "codex" } },
          },
        },
        list: [
          {
            id: "main",
            models: {
              "anthrozaicoderc/foo-1": { agentRuntime: { id: "zaicoder-cli" } },
            },
          },
        ],
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "foo-1",
        agentId: "main",
      }),
    ).toEqual({
      policy: { id: "zaicoder-cli" },
      source: "model",
      matchedProvider: "anthrozaicoderc",
    });
  });

  it("fails closed for duplicate provider-prefixed bare-model policies", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openai/foo-1": { agentRuntime: { id: "codex" } },
            "anthrozaicoderc/foo-1": { agentRuntime: { id: "zaicoder-cli" } },
            "anthrozaicoderc/*": { agentRuntime: { id: "zaicoder-cli" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "foo-1",
      }),
    ).toEqual({});
  });
});
