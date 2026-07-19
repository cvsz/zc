// Verifies models.json provider/model merge behavior and secret preservation.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExistingProviderConfig } from "./models-config.merge.js";
import type { ProviderConfig } from "./models-config.providers.secrets.js";

let NON_ENV_SECRETREF_MARKER: typeof import("./model-auth-markers.js").NON_ENV_SECRETREF_MARKER;
let mergeProviderModels: typeof import("./models-config.merge.js").mergeProviderModels;
let mergeProviders: typeof import("./models-config.merge.js").mergeProviders;
let mergeWithExistingProviderSecrets: typeof import("./models-config.merge.js").mergeWithExistingProviderSecrets;

async function loadMergeModules() {
  // Merge helpers depend on real manifest registry behavior; undo previous
  // mocks before importing the module under test.
  vi.doUnmock("../plugins/manifest-registry.js");
  ({ NON_ENV_SECRETREF_MARKER } = await import("./model-auth-markers.js"));
  ({ mergeProviderModels, mergeProviders, mergeWithExistingProviderSecrets } =
    await import("./models-config.merge.js"));
}

beforeAll(loadMergeModules);

beforeEach(() => {
  vi.doUnmock("../plugins/manifest-registry.js");
});

describe("models-config merge helpers", () => {
  const preservedAzaicoderKey = "AGENT_KEY"; // pragma: allowlist secret
  const configAzaicoderKey = "CONFIG_KEY"; // pragma: allowlist secret
  const createModel = (
    overrides: Partial<NonNullable<ProviderConfig["models"]>[number]> = {},
  ): NonNullable<ProviderConfig["models"]>[number] => ({
    id: "config-model",
    name: "Config model",
    input: ["text"],
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
    ...overrides,
  });

  function createConfigProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      baseUrl: "https://config.example/v1",
      azaicoderKey: configAzaicoderKey,
      azaicoder: "openai-responses",
      models: [createModel()],
      ...overrides,
    } as ProviderConfig;
  }

  function createExistingProvider(
    overrides: Partial<ExistingProviderConfig> = {},
  ): ExistingProviderConfig {
    return {
      baseUrl: "https://agent.example/v1",
      azaicoderKey: preservedAzaicoderKey,
      azaicoder: "openai-responses",
      models: [createModel({ id: "agent-model", name: "Agent model" })],
      ...overrides,
    } as ExistingProviderConfig;
  }

  it("refreshes implicit model metadata while preserving explicit reasoning overrides", () => {
    const merged = mergeProviderModels(
      {
        azaicoder: "openai-responses",
        models: [
          {
            id: "gpt-5.4",
            name: "GPT-5.4",
            input: ["text"],
            reasoning: true,
            contextWindow: 1_000_000,
            maxTokens: 100_000,
          },
        ],
      } as ProviderConfig,
      {
        azaicoder: "openai-responses",
        models: [
          {
            id: "gpt-5.4",
            name: "GPT-5.4",
            reasoning: false,
            cost: { input: 123, output: 456, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 2_000_000,
            maxTokens: 200_000,
          },
        ],
      } as ProviderConfig,
    );

    expect(merged.models).toEqual([
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        input: ["text"],
        reasoning: false,
        cost: { input: 123, output: 456, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 2_000_000,
        maxTokens: 200_000,
      },
    ]);
  });

  it("preserves explicit input modality overrides when implicit metadata has the same model id", () => {
    const merged = mergeProviderModels(
      {
        azaicoder: "ollama",
        models: [
          {
            id: "qwen3-vl:latest",
            name: "Qwen3 VL",
            input: ["text"],
            reasoning: true,
            contextWindow: 128_000,
            maxTokens: 8192,
          },
        ],
      } as ProviderConfig,
      {
        azaicoder: "ollama",
        models: [
          {
            id: "qwen3-vl:latest",
            name: "Qwen3 VL",
            input: ["text", "image"],
            contextWindow: 128_000,
            maxTokens: 8192,
          },
        ],
      } as ProviderConfig,
    );

    expect(merged.models).toEqual([
      {
        id: "qwen3-vl:latest",
        name: "Qwen3 VL",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 128_000,
        maxTokens: 8192,
      },
    ]);
  });

  it("merges explicit providers onto trimmed keys", () => {
    const merged = mergeProviders({
      explicit: {
        " custom ": {
          azaicoder: "openai-responses",
          models: [] as ProviderConfig["models"],
        } as ProviderConfig,
      },
    });

    expect(Object.keys(merged)).toEqual(["custom"]);
    expect(merged.custom?.azaicoder).toBe("openai-responses");
  });

  it("keeps existing providers alongside newly configured providers in merge mode", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        "custom-proxy": {
          baseUrl: "http://localhost:4000/v1",
          azaicoder: "openai-completions",
          models: [],
        } as ProviderConfig,
      },
      existingProviders: {
        existing: {
          baseUrl: "http://localhost:1234/v1",
          azaicoderKey: "EXISTING_KEY", // pragma: allowlist secret
          azaicoder: "openai-completions",
          models: [{ id: "existing-model", name: "Existing", input: ["text"] }],
        } as ExistingProviderConfig,
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.existing?.baseUrl).toBe("http://localhost:1234/v1");
    expect(merged["custom-proxy"]?.baseUrl).toBe("http://localhost:4000/v1");
  });

  it("drops stale invalid existing providers that would poison models.json", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        openai: createConfigProvider(),
      },
      existingProviders: {
        "zaicoder-cli": {
          azaicoder: "anthrozaicoderc-messages",
          models: [
            createModel({
              id: "zaicoder-sonnet-4-6",
              name: "zAICoder Sonnet",
              reasoning: true,
            }),
          ],
        } as unknown as ExistingProviderConfig,
        "auth-only": {
          baseUrl: "https://auth.example/v1",
          azaicoder: "openai-responses",
          azaicoderKey: preservedAzaicoderKey,
          models: [],
        } as ExistingProviderConfig,
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged["zaicoder-cli"]).toBeUndefined();
    expect(merged["auth-only"]?.azaicoderKey).toBe(preservedAzaicoderKey);
    expect(merged.openai).toBeDefined();
  });

  it("preserves non-empty existing azaicoderKey and baseUrl from models.json", () => {
    // Existing local secrets win over regenerated provider config so planning
    // does not overwrite operator-owned credentials.
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: createConfigProvider(),
      },
      existingProviders: {
        custom: createExistingProvider(),
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe(preservedAzaicoderKey);
    expect(merged.custom?.baseUrl).toBe("https://agent.example/v1");
  });

  it("preserves existing baseUrl after explicit provider key normalization", () => {
    const normalized = mergeProviders({
      explicit: {
        " custom ": createConfigProvider(),
      },
    });
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: normalized,
      existingProviders: {
        custom: createExistingProvider(),
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe(preservedAzaicoderKey);
    expect(merged.custom?.baseUrl).toBe("https://agent.example/v1");
  });

  it("preserves implicit provider headers when explicit config adds extra headers", () => {
    const merged = mergeProviderModels(
      {
        baseUrl: "https://azaicoder.example.com",
        azaicoder: "anthrozaicoderc-messages",
        headers: { "User-Agent": "zaicoder-code/0.1.0" },
        models: [
          {
            id: "kimi-code",
            name: "Kimi Code",
            input: ["text", "image"],
            reasoning: true,
          },
        ],
      } as unknown as ProviderConfig,
      {
        baseUrl: "https://azaicoder.example.com",
        azaicoder: "anthrozaicoderc-messages",
        headers: { "X-Kimi-Tenant": "tenant-a" },
        models: [
          {
            id: "kimi-code",
            name: "Kimi Code",
            input: ["text", "image"],
            reasoning: true,
          },
        ],
      } as unknown as ProviderConfig,
    );

    expect(merged.headers).toEqual({
      "User-Agent": "zaicoder-code/0.1.0",
      "X-Kimi-Tenant": "tenant-a",
    });
  });

  it("replaces stale baseUrl when model azaicoder surface changes", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: {
          baseUrl: "https://config.example/v1",
          models: [{ id: "model", azaicoder: "openai-responses" }],
        } as ProviderConfig,
      },
      existingProviders: {
        custom: {
          baseUrl: "https://agent.example/v1",
          azaicoderKey: preservedAzaicoderKey,
          models: [{ id: "model", azaicoder: "openai-completions" }],
        } as ExistingProviderConfig,
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe(preservedAzaicoderKey);
    expect(merged.custom?.baseUrl).toBe("https://config.example/v1");
  });

  it("replaces stale baseUrl when only model-level azaicoders change", () => {
    const nextProvider = createConfigProvider();
    delete (nextProvider as { azaicoder?: string }).azaicoder;
    nextProvider.models = [createModel({ azaicoder: "openai-responses" })];
    const existingProvider = createExistingProvider({
      models: [createModel({ id: "agent-model", name: "Agent model", azaicoder: "openai-completions" })],
    });
    delete (existingProvider as { azaicoder?: string }).azaicoder;
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: nextProvider,
      },
      existingProviders: {
        custom: existingProvider,
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe(preservedAzaicoderKey);
    expect(merged.custom?.baseUrl).toBe("https://config.example/v1");
  });

  it("does not preserve stale plaintext azaicoderKey when next entry is a marker", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: {
          azaicoderKey: "GOOGLE_API_KEY", // pragma: allowlist secret
          models: [createModel({ id: "model", azaicoder: "openai-responses" })],
        } as ProviderConfig,
      },
      existingProviders: {
        custom: {
          azaicoderKey: preservedAzaicoderKey,
          models: [createModel({ id: "model", azaicoder: "openai-responses" })],
        } as ExistingProviderConfig,
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe("GOOGLE_API_KEY"); // pragma: allowlist secret
  });

  it("does not preserve a stale non-env marker when config returns to plaintext", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: createConfigProvider({ azaicoderKey: "ALLCAPS_SAMPLE" }), // pragma: allowlist secret
      },
      existingProviders: {
        custom: createExistingProvider({
          azaicoderKey: NON_ENV_SECRETREF_MARKER,
        }),
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe("ALLCAPS_SAMPLE"); // pragma: allowlist secret
    expect(merged.custom?.baseUrl).toBe("https://agent.example/v1");
  });

  it("uses config azaicoderKey/baseUrl when existing values are empty", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: createConfigProvider(),
      },
      existingProviders: {
        custom: createExistingProvider({
          azaicoderKey: "",
          baseUrl: "",
        }),
      },
      secretRefManagedProviders: new Set<string>(),
    });

    expect(merged.custom?.azaicoderKey).toBe(configAzaicoderKey);
    expect(merged.custom?.baseUrl).toBe("https://config.example/v1");
  });
});
