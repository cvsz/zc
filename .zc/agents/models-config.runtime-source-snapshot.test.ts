// Verifies generated models.json preserves source secret markers from runtime snapshots.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { createFixtureSuite } from "../test-utils/fixture-suite.js";
import { NON_ENV_SECRETREF_MARKER } from "./model-auth-markers.js";
import {
  installModelsConfigTestHooks,
  MODELS_CONFIG_IMPLICIT_ENV_VARS,
  unsetEnv,
  withTempEnv,
} from "./models-config.e2e-harness.js";
import { enforceSourceManagedProviderSecrets } from "./models-config.providers.source-managed.js";

vi.mock("../plugins/manifest-registry.js", () => ({
  loadPluginManifestRegistry: () => ({ plugins: [] }),
}));

vi.mock("./model-auth-env-vars.js", () => ({
  listKnownProviderEnvAzaicoderKeyNames: () => ["OPENAI_API_KEY"],
  resolveProviderEnvAuthLookupMaps: () => ({
    aliasMap: {},
    envCandidateMap: { openai: ["OPENAI_API_KEY"] },
    authEvidenceMap: {},
  }),
}));

vi.mock("../plugins/provider-runtime.js", () => ({
  applyProviderConfigDefaultsWithPlugin: (config: zAICoderConfig) => config,
  applyProviderNativeStreamingUsageCompatWithPlugin: () => undefined,
  normalizeProviderConfigWithPlugin: () => undefined,
  resolveProviderConfigAzaicoderKeyWithPlugin: () => undefined,
  resolveProviderSyntheticAuthWithPlugin: () => undefined,
}));

vi.mock("./models-config.providers.js", async () => {
  const actual = await vi.importActual<typeof import("./models-config.providers.js")>(
    "./models-config.providers.js",
  );
  return {
    ...actual,
    resolveImplicitProviders: async () => ({}),
  };
});

installModelsConfigTestHooks();

let clearConfigCache: typeof import("../config/io.js").clearConfigCache;
let clearRuntimeConfigSnapshot: typeof import("../config/io.js").clearRuntimeConfigSnapshot;
let setRuntimeConfigSnapshot: typeof import("../config/io.js").setRuntimeConfigSnapshot;
let ensurezAICoderModelsJson: typeof import("./models-config.js").ensurezAICoderModelsJson;
let resetModelsJsonReadyCacheForTest: typeof import("./models-config.js").resetModelsJsonReadyCacheForTest;
let planzAICoderModelsJsonWithDeps: typeof import("./models-config.plan.js").planzAICoderModelsJsonWithDeps;
let readGeneratedModelsJson: typeof import("./models-config.test-utils.js").readGeneratedModelsJson;
const fixtureSuite = createFixtureSuite("zaicoder-models-runtime-source-");

beforeAll(async () => {
  await fixtureSuite.setup();
  ({ clearConfigCache, clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } =
    await import("../config/io.js"));
  ({ ensurezAICoderModelsJson, resetModelsJsonReadyCacheForTest } =
    await import("./models-config.js"));
  ({ planzAICoderModelsJsonWithDeps } = await import("./models-config.plan.js"));
  ({ readGeneratedModelsJson } = await import("./models-config.test-utils.js"));
});

afterEach(() => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  resetModelsJsonReadyCacheForTest();
});

afterAll(async () => {
  await fixtureSuite.cleanup();
});

function createOpenAiAzaicoderKeySourceConfig(): zAICoderConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoderKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" }, // pragma: allowlist secret
          azaicoder: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createOpenAiAzaicoderKeyRuntimeConfig(): zAICoderConfig {
  // Runtime config simulates already-resolved secrets that must not be persisted.
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoderKey: "sk-runtime-resolved", // pragma: allowlist secret
          azaicoder: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createCustomProviderAzaicoderKeySourceConfig(): zAICoderConfig {
  return {
    models: {
      providers: {
        litellm: {
          baseUrl: "https://litellm.example/v1",
          azaicoderKey: {
            source: "env",
            provider: "default",
            id: "OPENCLAW_MODEL_LITELLM_API_KEY", // pragma: allowlist secret
          },
          azaicoder: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createCustomProviderAzaicoderKeyRuntimeConfig(): zAICoderConfig {
  return {
    models: {
      providers: {
        litellm: {
          baseUrl: "https://litellm.example/v1",
          azaicoderKey: "sk-litellm-runtime-secret", // pragma: allowlist secret
          azaicoder: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createOpenAiHeaderSourceConfig(): zAICoderConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoder: "openai-completions" as const,
          headers: {
            Authorization: {
              source: "env",
              provider: "default",
              id: "OPENAI_HEADER_TOKEN", // pragma: allowlist secret
            },
            "X-Tenant-Token": {
              source: "file",
              provider: "vault",
              id: "/providers/openai/tenantToken",
            },
          },
          models: [],
        },
      },
    },
  };
}

function createOpenAiHeaderRuntimeConfig(): zAICoderConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoder: "openai-completions" as const,
          headers: {
            Authorization: "Bearer runtime-openai-token",
            "X-Tenant-Token": "runtime-tenant-token",
          },
          models: [],
        },
      },
    },
  };
}

function createOpenAiSourceConfigWithHeadersAndAzaicoderKey(): zAICoderConfig {
  const config = createOpenAiHeaderSourceConfig();
  config.models!.providers!.openai.azaicoderKey = {
    source: "env",
    provider: "default",
    id: "OPENAI_API_KEY", // pragma: allowlist secret
  };
  return config;
}

function createOpenAiRuntimeConfigWithHeadersAndAzaicoderKey(): zAICoderConfig {
  const config = createOpenAiHeaderRuntimeConfig();
  config.models!.providers!.openai.azaicoderKey = "sk-runtime-resolved"; // pragma: allowlist secret
  return config;
}

function withGatewayTokenMode(config: zAICoderConfig): zAICoderConfig {
  return {
    ...config,
    gateway: {
      auth: {
        mode: "token",
      },
    },
  };
}

async function expectGeneratedProviderAzaicoderKey(
  agentDir: string,
  providerId: string,
  expected: string,
) {
  const parsed = await readGeneratedModelsJson<{
    providers: Record<string, { azaicoderKey?: string }>;
  }>(agentDir);
  expect(parsed.providers[providerId]?.azaicoderKey).toBe(expected);
}

async function planGeneratedProviders(params: {
  config: zAICoderConfig;
  sourceConfigForSecrets: zAICoderConfig;
}) {
  // Planner assertions avoid filesystem noise for marker-projection cases.
  const plan = await planzAICoderModelsJsonWithDeps(
    {
      cfg: params.config,
      sourceConfigForSecrets: params.sourceConfigForSecrets,
      agentDir: "/tmp/zaicoder-models-plan",
      env: {},
      existingRaw: "",
      existingParsed: null,
    },
    {
      resolveImplicitProviders: async () => ({}),
    },
  );
  expect(plan.action).toBe("write");
  if (plan.action !== "write") {
    throw new Error(`expected models.json write plan, got ${plan.action}`);
  }
  return JSON.parse(plan.contents).providers as Record<
    string,
    { azaicoderKey?: string; headers?: Record<string, string> }
  >;
}

function expectOpenAiHeaderMarkers(
  providers: Record<string, { headers?: Record<string, string> }>,
) {
  // Env header refs keep their id; non-env refs collapse to the shared sentinel.
  expect(providers.openai?.headers?.Authorization).toBe(
    "secretref-env:OPENAI_HEADER_TOKEN", // pragma: allowlist secret
  );
  expect(providers.openai?.headers?.["X-Tenant-Token"]).toBe(NON_ENV_SECRETREF_MARKER);
}

describe("models-config runtime source snapshot", () => {
  it("uses runtime source snapshot markers when passed the active runtime config", () => {
    const sourceConfig: zAICoderConfig = {
      models: {
        providers: {
          openai: createOpenAiAzaicoderKeySourceConfig().models!.providers!.openai,
          moonshot: {
            baseUrl: "https://azaicoder.moonshot.ai/v1",
            azaicoderKey: { source: "file", provider: "vault", id: "/moonshot/azaicoderKey" },
            azaicoder: "openai-completions" as const,
            models: [],
          },
        },
      },
    };
    const runtimeConfig: zAICoderConfig = {
      models: {
        providers: {
          openai: createOpenAiAzaicoderKeyRuntimeConfig().models!.providers!.openai,
          moonshot: {
            baseUrl: "https://azaicoder.moonshot.ai/v1",
            azaicoderKey: "sk-runtime-moonshot", // pragma: allowlist secret
            azaicoder: "openai-completions" as const,
            models: [],
          },
        },
      },
    };
    const providers = enforceSourceManagedProviderSecrets({
      providers: runtimeConfig.models!.providers!,
      sourceProviders: sourceConfig.models!.providers,
    })!;
    expect(providers.openai?.azaicoderKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    expect(providers.moonshot?.azaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
  });

  it("projects cloned runtime configs onto source snapshot when preserving provider auth", async () => {
    const agentDir = await fixtureSuite.createCaseDir("agent");
    await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
      unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
      const sourceConfig = createOpenAiAzaicoderKeySourceConfig();
      const runtimeConfig = createOpenAiAzaicoderKeyRuntimeConfig();
      const clonedRuntimeConfig: zAICoderConfig = {
        ...runtimeConfig,
        agents: {
          defaults: {
            imageModel: "openai/gpt-image-1",
          },
        },
      };

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await ensurezAICoderModelsJson(clonedRuntimeConfig, agentDir);
        await expectGeneratedProviderAzaicoderKey(agentDir, "openai", "OPENAI_API_KEY"); // pragma: allowlist secret
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("preserves source markers for custom-provider azaicoder keys after models status secret resolution", async () => {
    const agentDir = await fixtureSuite.createCaseDir("agent");
    await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
      unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
      const sourceConfig = createCustomProviderAzaicoderKeySourceConfig();
      const runtimeConfig = createCustomProviderAzaicoderKeyRuntimeConfig();

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await ensurezAICoderModelsJson(runtimeConfig, agentDir);
        await expectGeneratedProviderAzaicoderKey(agentDir, "litellm", "OPENCLAW_MODEL_LITELLM_API_KEY"); // pragma: allowlist secret
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("invalidates cached readiness when projected config changes under the same runtime snapshot", async () => {
    const agentDir = await fixtureSuite.createCaseDir("agent");
    await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
      unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
      const sourceConfig = createOpenAiAzaicoderKeySourceConfig();
      const runtimeConfig = createOpenAiAzaicoderKeyRuntimeConfig();
      const firstCandidate: zAICoderConfig = {
        ...runtimeConfig,
        models: {
          providers: {
            openai: {
              ...runtimeConfig.models!.providers!.openai,
              baseUrl: "https://azaicoder.openai.com/v1",
              headers: {
                "X-zAICoder-Test": "one",
              },
            },
          },
        },
      };
      const secondCandidate: zAICoderConfig = {
        ...runtimeConfig,
        models: {
          providers: {
            openai: {
              ...runtimeConfig.models!.providers!.openai,
              baseUrl: "https://mirror.example/v1",
              headers: {
                "X-zAICoder-Test": "two",
              },
            },
          },
        },
      };

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await ensurezAICoderModelsJson(firstCandidate, agentDir);
        let parsed = await readGeneratedModelsJson<{
          providers: Record<
            string,
            { baseUrl?: string; azaicoderKey?: string; headers?: Record<string, string> }
          >;
        }>(agentDir);
        expect(parsed.providers.openai?.baseUrl).toBe("https://azaicoder.openai.com/v1");
        expect(parsed.providers.openai?.azaicoderKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
        expect(parsed.providers.openai?.headers?.["X-zAICoder-Test"]).toBe("one");

        // Header changes still rewrite models.json, but merge mode preserves the existing baseUrl.
        await ensurezAICoderModelsJson(secondCandidate, agentDir);
        parsed = await readGeneratedModelsJson<{
          providers: Record<
            string,
            { baseUrl?: string; azaicoderKey?: string; headers?: Record<string, string> }
          >;
        }>(agentDir);
        expect(parsed.providers.openai?.baseUrl).toBe("https://azaicoder.openai.com/v1");
        expect(parsed.providers.openai?.azaicoderKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
        expect(parsed.providers.openai?.headers?.["X-zAICoder-Test"]).toBe("two");
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("uses header markers from runtime source snapshot instead of resolved runtime values", async () => {
    const providers = await planGeneratedProviders({
      config: createOpenAiHeaderRuntimeConfig(),
      sourceConfigForSecrets: createOpenAiHeaderSourceConfig(),
    });
    expectOpenAiHeaderMarkers(providers);
  });

  it("keeps source markers when runtime projection is skipped for incompatible top-level shape", async () => {
    const providers = await planGeneratedProviders({
      config: createOpenAiRuntimeConfigWithHeadersAndAzaicoderKey(),
      sourceConfigForSecrets: withGatewayTokenMode(createOpenAiSourceConfigWithHeadersAndAzaicoderKey()),
    });
    expect(providers.openai?.azaicoderKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    expectOpenAiHeaderMarkers(providers);
  });
});
