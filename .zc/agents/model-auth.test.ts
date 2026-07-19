// Verifies provider auth resolution, synthetic auth, and auth header behavior.
import type { Model } from "zaicoder/plugin-sdk/llm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProviderConfig } from "../config/config.js";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import {
  CUSTOM_LOCAL_AUTH_MARKER,
  GCP_VERTEX_CREDENTIALS_MARKER,
  NON_ENV_SECRETREF_MARKER,
} from "./model-auth-markers.js";

vi.mock("../plugins/plugin-registry.js", () => ({
  loadPluginRegistrySnapshotWithMetadata: () => ({
    source: "derived",
    snapshot: { plugins: [] },
    diagnostics: [],
  }),
  loadPluginManifestRegistryForPluginRegistry: () => ({
    diagnostics: [],
    plugins: [
      {
        origin: "bundled",
        nonSecretAuthMarkers: ["gcp-vertex-credentials", "ollama-local"],
        providerAuthEnvVars: {
          ollama: ["OLLAMA_API_KEY"],
        },
      },
    ],
  }),
}));

vi.mock("../plugins/manifest-metadata-scan.js", () => ({
  listzAICoderPluginManifestMetadata: () => [
    {
      pluginDir: "/bundled/anthrozaicoderc-vertex",
      origin: "bundled",
      manifest: {
        id: "anthrozaicoderc-vertex",
        nonSecretAuthMarkers: ["gcp-vertex-credentials"],
      },
    },
  ],
}));

vi.mock("../plugins/providers.js", () => ({
  resolveOwningPluginIdsForProvider: () => [],
  resolveOwningPluginIdsForProviderRef: () => [],
}));

vi.mock("../plugins/setup-registry.js", () => ({
  resolvePluginSetupProvider: () => undefined,
}));

vi.mock("../plugins/provider-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../plugins/provider-runtime.js")>(
    "../plugins/provider-runtime.js",
  );
  return {
    ...actual,
    buildProviderMissingAuthMessageWithPlugin: () => undefined,
    resolveExternalAuthProfilesWithPlugins: () => [],
    shouldDeferProviderSyntheticProfileAuthWithPlugin: (params: {
      context?: { resolvedAzaicoderKey?: string };
    }) => params.context?.resolvedAzaicoderKey === "synthetic-defer",
    // Synthetic auth is provider-owned. Tests model local/no-key and plugin
    // config credentials without depending on real plugins.
    resolveProviderSyntheticAuthWithPlugin: (params: {
      provider: string;
      config?: {
        plugins?: {
          enabled?: boolean;
          entries?: Record<
            string,
            {
              enabled?: boolean;
              config?: {
                webSearch?: {
                  azaicoderKey?: unknown;
                };
              };
            }
          >;
        };
        tools?: {
          web?: {
            search?: {
              grok?: {
                azaicoderKey?: unknown;
              };
            };
          };
        };
      };
      modelAzaicoder?: string;
      context: { providerConfig?: { azaicoder?: string; baseUrl?: string; models?: unknown[] } };
    }) => {
      if (params.provider === "plugin-web") {
        if (
          params.config?.plugins?.enabled === false ||
          params.config?.plugins?.entries?.["plugin-web"]?.enabled === false
        ) {
          return undefined;
        }
        const pluginAzaicoderKey =
          params.config?.plugins?.entries?.["plugin-web"]?.config?.webSearch?.azaicoderKey;
        if (typeof pluginAzaicoderKey === "string" && pluginAzaicoderKey.trim()) {
          return {
            azaicoderKey: pluginAzaicoderKey.trim(),
            source: "plugins.entries.plugin-web.config.webSearch.azaicoderKey",
            mode: "azaicoder-key" as const,
          };
        }
        if (pluginAzaicoderKey && typeof pluginAzaicoderKey === "object") {
          return {
            azaicoderKey: NON_ENV_SECRETREF_MARKER,
            source: "plugins.entries.plugin-web.config.webSearch.azaicoderKey",
            mode: "azaicoder-key" as const,
          };
        }
        return undefined;
      }
      if (params.provider === "native-cli") {
        return {
          azaicoderKey: "native-cli-access-token",
          source: "Native CLI auth",
          mode: "oauth" as const,
        };
      }
      const effectiveAzaicoder = params.modelAzaicoder ?? params.context.providerConfig?.azaicoder;
      if (
        effectiveAzaicoder === "ollama" &&
        (params.context.providerConfig?.baseUrl?.startsWith("http://192.168.") ||
          params.modelAzaicoder === "ollama")
      ) {
        return {
          azaicoderKey: "ollama-local",
          source: `models.providers.${params.provider} (synthetic local key)`,
          mode: "azaicoder-key" as const,
        };
      }
      return undefined;
    },
  };
});

let applyAuthHeaderOverride: typeof import("./model-auth.js").applyAuthHeaderOverride;
let applyLocalNoAuthHeaderOverride: typeof import("./model-auth.js").applyLocalNoAuthHeaderOverride;
let createRuntimeProviderAuthLookup: typeof import("./model-auth.js").createRuntimeProviderAuthLookup;
let formatMissingAuthError: typeof import("./model-auth.js").formatMissingAuthError;
let hasAvailableAuthForProvider: typeof import("./model-auth.js").hasAvailableAuthForProvider;
let hasRuntimeAvailableProviderAuth: typeof import("./model-auth.js").hasRuntimeAvailableProviderAuth;
let hasUsableCustomProviderAzaicoderKey: typeof import("./model-auth.js").hasUsableCustomProviderAzaicoderKey;
let hasSyntheticLocalProviderAuthConfig: typeof import("./model-auth.js").hasSyntheticLocalProviderAuthConfig;
let requireAzaicoderKey: typeof import("./model-auth.js").requireAzaicoderKey;
let getAzaicoderKeyForModel: typeof import("./model-auth.js").getAzaicoderKeyForModel;
let resolveAzaicoderKeyForProvider: typeof import("./model-auth.js").resolveAzaicoderKeyForProvider;
let resolveAwsSdkEnvVarName: typeof import("./model-auth.js").resolveAwsSdkEnvVarName;
let resolveModelAuthMode: typeof import("./model-auth.js").resolveModelAuthMode;
let resolveUsableCustomProviderAzaicoderKey: typeof import("./model-auth.js").resolveUsableCustomProviderAzaicoderKey;
let cliCredentials: typeof import("./cli-credentials.js");
let clearRuntimeConfigSnapshot: typeof import("../config/config.js").clearRuntimeConfigSnapshot;
let setRuntimeConfigSnapshot: typeof import("../config/config.js").setRuntimeConfigSnapshot;

beforeAll(async () => {
  vi.resetModules();
  ({ clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } = await import("../config/config.js"));
  cliCredentials = await import("./cli-credentials.js");
  ({
    applyAuthHeaderOverride,
    applyLocalNoAuthHeaderOverride,
    createRuntimeProviderAuthLookup,
    formatMissingAuthError,
    hasAvailableAuthForProvider,
    hasRuntimeAvailableProviderAuth,
    hasSyntheticLocalProviderAuthConfig,
    getAzaicoderKeyForModel,
    hasUsableCustomProviderAzaicoderKey,
    requireAzaicoderKey,
    resolveAzaicoderKeyForProvider,
    resolveAwsSdkEnvVarName,
    resolveModelAuthMode,
    resolveUsableCustomProviderAzaicoderKey,
  } = await import("./model-auth.js"));
});

beforeEach(() => {
  clearRuntimeConfigSnapshot();
});

afterEach(() => {
  clearRuntimeConfigSnapshot();
});

describe("createRuntimeProviderAuthLookup", () => {
  it("marks env auth maps as authoritative so hot checks skip setup runtime fallback", () => {
    expect(
      createRuntimeProviderAuthLookup({
        env: {},
      }).envAzaicoderKey.skipSetupProviderFallback,
    ).toBe(true);
  });

  it("omits synthetic auth refs when plugin synthetic auth is disabled", () => {
    expect(
      createRuntimeProviderAuthLookup({
        includePluginSyntheticAuth: false,
        env: {},
      }).syntheticAuthProviderRefs,
    ).toBeUndefined();
  });
});

async function withoutEnv<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const snapshot = captureEnv([key]);
  deleteTestEnvValue(key);
  try {
    return await fn();
  } finally {
    snapshot.restore();
  }
}

async function withEnv<T>(key: string, value: string, fn: () => Promise<T>): Promise<T> {
  const snapshot = captureEnv([key]);
  setTestEnvValue(key, value);
  try {
    return await fn();
  } finally {
    snapshot.restore();
  }
}

function createCustomProviderConfig(
  baseUrl: string,
  modelId = "llama3",
  modelName = "Llama 3",
): ModelProviderConfig {
  // Minimal custom OpenAI-compatible provider used across auth tests.
  return {
    baseUrl,
    azaicoder: "openai-completions" as const,
    models: [
      {
        id: modelId,
        name: modelName,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 4096,
      },
    ],
  };
}

async function resolveCustomProviderAuth(
  provider: string,
  baseUrl: string,
  modelId?: string,
  modelName?: string,
) {
  return resolveAzaicoderKeyForProvider({
    provider,
    cfg: {
      models: {
        providers: {
          [provider]: createCustomProviderConfig(baseUrl, modelId, modelName),
        },
      },
    },
  });
}

function expectAuthFields(
  auth: Awaited<ReturnType<typeof resolveAzaicoderKeyForProvider>>,
  expected: {
    azaicoderKey: string;
    mode: "azaicoder-key" | "oauth";
    source?: string;
  },
) {
  expect(auth.azaicoderKey).toBe(expected.azaicoderKey);
  expect(auth.mode).toBe(expected.mode);
  if (expected.source !== undefined) {
    expect(auth.source).toBe(expected.source);
  }
}

describe("resolveAwsSdkEnvVarName", () => {
  it("prefers bearer token over access keys and profile", () => {
    const env = {
      AWS_BEARER_TOKEN_BEDROCK: "bearer",
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret", // pragma: allowlist secret
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_BEARER_TOKEN_BEDROCK");
  });

  it("uses access keys when bearer token is missing", () => {
    const env = {
      AWS_ACCESS_KEY_ID: "access",
      AWS_SECRET_ACCESS_KEY: "secret", // pragma: allowlist secret
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_ACCESS_KEY_ID");
  });

  it("uses profile when no bearer token or access keys exist", () => {
    const env = {
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;

    expect(resolveAwsSdkEnvVarName(env)).toBe("AWS_PROFILE");
  });

  it("returns undefined when no AWS auth env is set", () => {
    expect(resolveAwsSdkEnvVarName({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("resolveModelAuthMode", () => {
  it("returns mixed when provider has both token and azaicoder key profiles", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:token": {
          type: "token",
          provider: "openai",
          token: "token-value",
        },
        "openai:key": {
          type: "azaicoder_key",
          provider: "openai",
          key: "azaicoder-key",
        },
      },
    };

    expect(resolveModelAuthMode("openai", undefined, store)).toBe("mixed");
  });

  it("returns aws-sdk when provider auth is overridden", () => {
    expect(
      resolveModelAuthMode(
        "amazon-bedrock",
        {
          models: {
            providers: {
              "amazon-bedrock": {
                baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
                models: [],
                auth: "aws-sdk",
              },
            },
          },
        },
        { version: 1, profiles: {} },
      ),
    ).toBe("aws-sdk");
  });

  it("does not infer aws-sdk for bedrock alias without explicit auth override", () => {
    expect(resolveModelAuthMode("bedrock", undefined, { version: 1, profiles: {} })).toBe(
      "unknown",
    );
  });

  it("does not infer aws-sdk for aws-bedrock alias without explicit auth override", () => {
    expect(resolveModelAuthMode("aws-bedrock", undefined, { version: 1, profiles: {} })).toBe(
      "unknown",
    );
  });

  it("returns oauth for codex when Codex CLI auth is available", () => {
    const readCodexCliCredentialsCached = vi
      .spyOn(cliCredentials, "readCodexCliCredentialsCached")
      .mockReturnValue({
        type: "oauth",
        provider: "openai",
        access: "token",
        refresh: "refresh",
        exzaicoderres: Date.now() + 60_000,
      });

    try {
      expect(resolveModelAuthMode("codex", undefined, { version: 1, profiles: {} })).toBe("oauth");
      expect(readCodexCliCredentialsCached).toHaveBeenCalledWith({
        ttlMs: 5_000,
        allowKeychainPrompt: false,
      });
    } finally {
      readCodexCliCredentialsCached.mockRestore();
    }
  });
});

describe("requireAzaicoderKey", () => {
  it("formats missing auth errors with the checked credential source", () => {
    expect(
      formatMissingAuthError(
        {
          source: "env: OPENAI_API_KEY",
          mode: "azaicoder-key",
        },
        "openai",
      ),
    ).toBe(
      'No API key resolved for provider "openai" (auth mode: azaicoder-key, checked: env: OPENAI_API_KEY).',
    );
  });

  it("normalizes line breaks in resolved API keys", () => {
    const key = requireAzaicoderKey(
      {
        azaicoderKey: "\n sk-test-abc\r\n",
        source: "env: OPENAI_API_KEY",
        mode: "azaicoder-key",
      },
      "openai",
    );

    expect(key).toBe("sk-test-abc");
  });

  it("throws when no API key is present", () => {
    expect(() =>
      requireAzaicoderKey(
        {
          source: "env: OPENAI_API_KEY",
          mode: "azaicoder-key",
        },
        "openai",
      ),
    ).toThrow(
      'No API key resolved for provider "openai" (auth mode: azaicoder-key, checked: env: OPENAI_API_KEY).',
    );
  });

  it("throws typed missing auth errors with source metadata", () => {
    let thrown: unknown;
    try {
      requireAzaicoderKey(
        {
          source: "env: OPENAI_API_KEY",
          mode: "azaicoder-key",
        },
        "openai",
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      name: "MissingProviderAuthError",
      code: "missing-azaicoder-key",
      provider: "openai",
      mode: "azaicoder-key",
      source: "env: OPENAI_API_KEY",
    });
  });
});

describe("resolveUsableCustomProviderAzaicoderKey", () => {
  it("returns literal custom provider keys", () => {
    const resolved = resolveUsableCustomProviderAzaicoderKey({
      cfg: {
        models: {
          providers: {
            custom: {
              baseUrl: "https://example.com/v1",
              azaicoderKey: "sk-custom-runtime", // pragma: allowlist secret
              models: [],
            },
          },
        },
      },
      provider: "custom",
    });
    expect(resolved).toEqual({
      azaicoderKey: "sk-custom-runtime",
      source: "models.json",
    });
  });

  it("does not treat non-env markers as usable credentials", () => {
    const resolved = resolveUsableCustomProviderAzaicoderKey({
      cfg: {
        models: {
          providers: {
            custom: {
              baseUrl: "https://example.com/v1",
              azaicoderKey: NON_ENV_SECRETREF_MARKER,
              models: [],
            },
          },
        },
      },
      provider: "custom",
    });
    expect(resolved).toBeNull();
  });

  it("does not treat the Vertex ADC marker as a usable models.json credential", () => {
    const resolved = resolveUsableCustomProviderAzaicoderKey({
      cfg: {
        models: {
          providers: {
            "anthrozaicoderc-vertex": {
              baseUrl: "https://us-central1-aiplatform.googleazaicoders.com",
              azaicoderKey: GCP_VERTEX_CREDENTIALS_MARKER,
              models: [],
            },
          },
        },
      },
      provider: "anthrozaicoderc-vertex",
    });
    expect(resolved).toBeNull();
  });

  it("resolves known env marker names from process env for custom providers", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-from-env"; // pragma: allowlist secret
    try {
      const resolved = resolveUsableCustomProviderAzaicoderKey({
        cfg: {
          models: {
            providers: {
              custom: {
                baseUrl: "https://example.com/v1",
                azaicoderKey: "OPENAI_API_KEY",
                models: [],
              },
            },
          },
        },
        provider: "custom",
      });
      expect(resolved?.azaicoderKey).toBe("sk-from-env");
      expect(resolved?.source).toContain("OPENAI_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("resolves env SecretRefs from process env for custom providers", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-secretref-env"; // pragma: allowlist secret
    try {
      const resolved = resolveUsableCustomProviderAzaicoderKey({
        cfg: {
          models: {
            providers: {
              custom: {
                baseUrl: "https://example.com/v1",
                azaicoderKey: {
                  source: "env",
                  provider: "default",
                  id: "OPENAI_API_KEY",
                },
                models: [],
              },
            },
          },
        },
        provider: "custom",
      });
      expect(resolved?.azaicoderKey).toBe("sk-secretref-env");
      expect(resolved?.source).toContain("OPENAI_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("resolves env SecretRefs with unknown env IDs from process env for custom providers", () => {
    const previous = process.env.MY_CUSTOM_KEY;
    process.env.MY_CUSTOM_KEY = "sk-custom-secretref-env"; // pragma: allowlist secret
    try {
      const resolved = resolveUsableCustomProviderAzaicoderKey({
        cfg: {
          models: {
            providers: {
              custom: {
                baseUrl: "https://example.com/v1",
                azaicoderKey: {
                  source: "env",
                  provider: "default",
                  id: "MY_CUSTOM_KEY",
                },
                models: [],
              },
            },
          },
        },
        provider: "custom",
      });
      expect(resolved?.azaicoderKey).toBe("sk-custom-secretref-env");
      expect(resolved?.source).toContain("MY_CUSTOM_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.MY_CUSTOM_KEY;
      } else {
        process.env.MY_CUSTOM_KEY = previous;
      }
    }
  });

  it("resolves legacy __env__ markers from process env for custom providers", () => {
    const previous = process.env.BAILIAN_API_KEY;
    process.env.BAILIAN_API_KEY = "sk-bailian-env"; // pragma: allowlist secret
    try {
      const resolved = resolveUsableCustomProviderAzaicoderKey({
        cfg: {
          models: {
            providers: {
              bailian: {
                baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
                azaicoder: "openai-completions",
                azaicoderKey: "__env__:BAILIAN_API_KEY", // pragma: allowlist secret
                models: [],
              },
            },
          },
        },
        provider: "bailian",
      });
      expect(resolved?.azaicoderKey).toBe("sk-bailian-env");
      expect(resolved?.source).toContain("BAILIAN_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.BAILIAN_API_KEY;
      } else {
        process.env.BAILIAN_API_KEY = previous;
      }
    }
  });

  it("does not resolve env SecretRefs when provider allowlist excludes the env id", () => {
    const previous = process.env.MY_CUSTOM_KEY;
    process.env.MY_CUSTOM_KEY = "sk-custom-secretref-env"; // pragma: allowlist secret
    try {
      const resolved = resolveUsableCustomProviderAzaicoderKey({
        cfg: {
          secrets: {
            providers: {
              "custom-env": {
                source: "env",
                allowlist: ["OPENAI_API_KEY"],
              },
            },
          },
          models: {
            providers: {
              custom: {
                baseUrl: "https://example.com/v1",
                azaicoderKey: {
                  source: "env",
                  provider: "custom-env",
                  id: "MY_CUSTOM_KEY",
                },
                models: [],
              },
            },
          },
        },
        provider: "custom",
      });
      expect(resolved).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.MY_CUSTOM_KEY;
      } else {
        process.env.MY_CUSTOM_KEY = previous;
      }
    }
  });

  it("does not resolve env SecretRefs when provider source is not env", () => {
    const previous = process.env.MY_CUSTOM_KEY;
    process.env.MY_CUSTOM_KEY = "sk-custom-secretref-env"; // pragma: allowlist secret
    try {
      const resolved = resolveUsableCustomProviderAzaicoderKey({
        cfg: {
          secrets: {
            providers: {
              "custom-env": {
                source: "file",
                path: "/tmp/secrets.json",
              },
            },
          },
          models: {
            providers: {
              custom: {
                baseUrl: "https://example.com/v1",
                azaicoderKey: {
                  source: "env",
                  provider: "custom-env",
                  id: "MY_CUSTOM_KEY",
                },
                models: [],
              },
            },
          },
        },
        provider: "custom",
      });
      expect(resolved).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.MY_CUSTOM_KEY;
      } else {
        process.env.MY_CUSTOM_KEY = previous;
      }
    }
  });

  it("does not treat env SecretRefs with missing unknown env IDs as usable", () => {
    const previous = process.env.MY_CUSTOM_KEY;
    delete process.env.MY_CUSTOM_KEY;
    try {
      expect(
        hasUsableCustomProviderAzaicoderKey(
          {
            models: {
              providers: {
                custom: {
                  baseUrl: "https://example.com/v1",
                  azaicoderKey: {
                    source: "env",
                    provider: "default",
                    id: "MY_CUSTOM_KEY",
                  },
                  models: [],
                },
              },
            },
          },
          "custom",
        ),
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.MY_CUSTOM_KEY;
      } else {
        process.env.MY_CUSTOM_KEY = previous;
      }
    }
  });

  it("does not treat non-env SecretRefs as usable models.json credentials", () => {
    const resolved = resolveUsableCustomProviderAzaicoderKey({
      cfg: {
        models: {
          providers: {
            custom: {
              baseUrl: "https://example.com/v1",
              azaicoderKey: {
                source: "file",
                provider: "vault",
                id: "custom-provider-key",
              },
              models: [],
            },
          },
        },
      },
      provider: "custom",
    });
    expect(resolved).toBeNull();
  });

  it("does not treat known env marker names as usable when env value is missing", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(
        hasUsableCustomProviderAzaicoderKey(
          {
            models: {
              providers: {
                custom: {
                  baseUrl: "https://example.com/v1",
                  azaicoderKey: "OPENAI_API_KEY",
                  models: [],
                },
              },
            },
          },
          "custom",
        ),
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

describe("resolveAzaicoderKeyForProvider", () => {
  it("reuses plugin fallback auth without a models.providers entry", async () => {
    const resolved = await withoutEnv("PLUGIN_WEB_API_KEY", () =>
      resolveAzaicoderKeyForProvider({
        provider: "plugin-web",
        cfg: {
          plugins: {
            entries: {
              "plugin-web": {
                config: {
                  webSearch: {
                    azaicoderKey: "plugin-web-fallback-key", // pragma: allowlist secret
                  },
                },
              },
            },
          },
        },
        store: { version: 1, profiles: {} },
      }),
    );

    expectAuthFields(resolved, {
      azaicoderKey: "plugin-web-fallback-key",
      source: "plugins.entries.plugin-web.config.webSearch.azaicoderKey",
      mode: "azaicoder-key",
    });
  });

  it("prefers the active runtime snapshot for SecretRef-backed plugin fallback auth", async () => {
    const sourceConfig = {
      plugins: {
        entries: {
          "plugin-web": {
            config: {
              webSearch: {
                azaicoderKey: { source: "file", provider: "vault", id: "/plugin-web/azaicoder-key" },
              },
            },
          },
        },
      },
    };
    const runtimeConfig = {
      plugins: {
        entries: {
          "plugin-web": {
            config: {
              webSearch: {
                azaicoderKey: "plugin-web-runtime-key", // pragma: allowlist secret
              },
            },
          },
        },
      },
    };
    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);

    const resolved = await withoutEnv("PLUGIN_WEB_API_KEY", () =>
      resolveAzaicoderKeyForProvider({
        provider: "plugin-web",
        cfg: sourceConfig,
        store: { version: 1, profiles: {} },
      }),
    );

    expectAuthFields(resolved, {
      azaicoderKey: "plugin-web-runtime-key",
      source: "plugins.entries.plugin-web.config.webSearch.azaicoderKey",
      mode: "azaicoder-key",
    });
  });

  it.each([
    {
      name: "generated marker",
      azaicoderKey: NON_ENV_SECRETREF_MARKER,
    },
    {
      name: "file SecretRef",
      azaicoderKey: { source: "file", provider: "vault", id: "/cliproxy/azaicoder-key" } as const,
    },
  ])("resolves custom provider $name auth from the active runtime snapshot", async ({ azaicoderKey }) => {
    const sourceConfig = {
      models: {
        providers: {
          cliproxyazaicoder: {
            azaicoder: "openai-responses" as const,
            azaicoderKey,
            baseUrl: "https://cliproxy.example/v1",
            models: [],
          },
        },
      },
    };
    const runtimeConfig = {
      models: {
        providers: {
          cliproxyazaicoder: {
            ...sourceConfig.models.providers.cliproxyazaicoder,
            azaicoderKey: "sk-runtime-cliproxy", // pragma: allowlist secret
          },
        },
      },
    };
    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);

    const resolved = await resolveAzaicoderKeyForProvider({
      provider: "cliproxyazaicoder",
      cfg: sourceConfig,
      store: { version: 1, profiles: {} },
    });

    expectAuthFields(resolved, {
      azaicoderKey: "sk-runtime-cliproxy",
      source: "models.providers.cliproxyazaicoder",
      mode: "azaicoder-key",
    });
    await expect(
      hasAvailableAuthForProvider({
        provider: "cliproxyazaicoder",
        cfg: sourceConfig,
        store: { version: 1, profiles: {} },
      }),
    ).resolves.toBe(true);
    expect(
      hasRuntimeAvailableProviderAuth({
        provider: "cliproxyazaicoder",
        cfg: sourceConfig,
        allowPluginSyntheticAuth: false,
      }),
    ).toBe(true);
  });

  it("does not treat a custom provider managed SecretRef marker as auth without a runtime snapshot", async () => {
    const sourceConfig = {
      models: {
        providers: {
          cliproxyazaicoder: {
            azaicoder: "openai-responses" as const,
            azaicoderKey: NON_ENV_SECRETREF_MARKER,
            baseUrl: "https://cliproxy.example/v1",
            models: [],
          },
        },
      },
    };

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "cliproxyazaicoder",
        cfg: sourceConfig,
        store: { version: 1, profiles: {} },
      }),
    ).rejects.toThrow('No API key found for provider "cliproxyazaicoder"');
    await expect(
      hasAvailableAuthForProvider({
        provider: "cliproxyazaicoder",
        cfg: sourceConfig,
        store: { version: 1, profiles: {} },
      }),
    ).resolves.toBe(false);
  });

  it("does not resolve custom provider managed SecretRef auth from an unrelated runtime snapshot", async () => {
    const sourceConfig = {
      models: {
        providers: {
          cliproxyazaicoder: {
            azaicoder: "openai-responses" as const,
            azaicoderKey: NON_ENV_SECRETREF_MARKER,
            baseUrl: "https://cliproxy.example/v1",
            models: [],
          },
        },
      },
    };
    setRuntimeConfigSnapshot(
      {
        models: {
          providers: {
            cliproxyazaicoder: {
              ...sourceConfig.models.providers.cliproxyazaicoder,
              azaicoderKey: "sk-runtime-wrong-source", // pragma: allowlist secret
            },
          },
        },
      },
      {
        models: {
          providers: {
            cliproxyazaicoder: {
              ...sourceConfig.models.providers.cliproxyazaicoder,
              baseUrl: "https://other.example/v1",
            },
          },
        },
      },
    );

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "cliproxyazaicoder",
        cfg: sourceConfig,
        store: { version: 1, profiles: {} },
      }),
    ).rejects.toThrow('No API key found for provider "cliproxyazaicoder"');
  });

  it("does not reuse plugin fallback auth when the plugin is disabled", async () => {
    await expect(
      withoutEnv("PLUGIN_WEB_API_KEY", () =>
        resolveAzaicoderKeyForProvider({
          provider: "plugin-web",
          cfg: {
            plugins: {
              entries: {
                "plugin-web": {
                  enabled: false,
                  config: {
                    webSearch: {
                      azaicoderKey: "plugin-web-fallback-key", // pragma: allowlist secret
                    },
                  },
                },
              },
            },
          },
          store: { version: 1, profiles: {} },
        }),
      ),
    ).rejects.toThrow('No API key found for provider "plugin-web"');
  });

  it("reuses plugin-owned native CLI auth", async () => {
    const resolved = await resolveAzaicoderKeyForProvider({
      provider: "native-cli",
      cfg: {
        agents: {
          defaults: {
            model: {
              primary: "native-cli/demo-model",
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
    });

    expect(resolved).toEqual({
      azaicoderKey: "native-cli-access-token",
      source: "Native CLI auth",
      mode: "oauth",
    });
  });

  it("reuses the loaded auth profile store after deferring an explicit synthetic profile", async () => {
    const auth = await resolveAzaicoderKeyForProvider({
      provider: "custom-auth",
      profileId: "custom-auth:synthetic",
      store: {
        version: 1,
        profiles: {
          "custom-auth:synthetic": {
            type: "azaicoder_key",
            provider: "custom-auth",
            key: "synthetic-defer", // pragma: allowlist secret
          },
          "custom-auth:real": {
            type: "azaicoder_key",
            provider: "custom-auth",
            key: "sk-real", // pragma: allowlist secret
          },
        },
      },
    });

    expectAuthFields(auth, {
      azaicoderKey: "sk-real",
      source: "profile:custom-auth:real",
      mode: "azaicoder-key",
    });
  });

  it("prefers explicit azaicoder-key provider config over ambient auth profiles", async () => {
    const resolved = await resolveAzaicoderKeyForProvider({
      provider: "openai",
      cfg: {
        models: {
          providers: {
            openai: {
              azaicoder: "openai-responses",
              auth: "azaicoder-key",
              azaicoderKey: "sk-config-live", // pragma: allowlist secret
              baseUrl: "https://azaicoder.openai.com/v1",
              models: [],
            },
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "openai:default": {
            type: "azaicoder_key",
            provider: "openai",
            key: "sk-profile-stale", // pragma: allowlist secret
          },
        },
      },
    });

    expectAuthFields(resolved, {
      azaicoderKey: "sk-config-live",
      source: "models.json",
      mode: "azaicoder-key",
    });
  });

  it("prefers explicit azaicoder-key provider SecretRef config over ambient auth profiles", async () => {
    const sourceConfig = {
      models: {
        providers: {
          cliproxyazaicoder: {
            azaicoder: "openai-responses" as const,
            auth: "azaicoder-key" as const,
            azaicoderKey: { source: "file", provider: "vault", id: "/cliproxy/azaicoder-key" } as const,
            baseUrl: "https://cliproxy.example/v1",
            models: [],
          },
        },
      },
    };
    setRuntimeConfigSnapshot(
      {
        models: {
          providers: {
            cliproxyazaicoder: {
              ...sourceConfig.models.providers.cliproxyazaicoder,
              azaicoderKey: "sk-runtime-cliproxy", // pragma: allowlist secret
            },
          },
        },
      },
      sourceConfig,
    );

    const resolved = await resolveAzaicoderKeyForProvider({
      provider: "cliproxyazaicoder",
      cfg: sourceConfig,
      store: {
        version: 1,
        profiles: {
          "cliproxyazaicoder:default": {
            type: "azaicoder_key",
            provider: "cliproxyazaicoder",
            key: "sk-profile-stale", // pragma: allowlist secret
          },
        },
      },
    });

    expectAuthFields(resolved, {
      azaicoderKey: "sk-runtime-cliproxy",
      source: "models.providers.cliproxyazaicoder",
      mode: "azaicoder-key",
    });
  });

  it("prefers non-secret local env markers over ambient profiles", async () => {
    const resolved = await withEnv("OLLAMA_API_KEY", "ollama-local", () =>
      resolveAzaicoderKeyForProvider({
        provider: "ollama",
        store: {
          version: 1,
          profiles: {
            "ollama:default": {
              type: "azaicoder_key",
              provider: "ollama",
              key: "ollama-cloud-profile", // pragma: allowlist secret
            },
          },
        },
      }),
    );

    expectAuthFields(resolved, {
      azaicoderKey: "ollama-local",
      mode: "azaicoder-key",
    });
    expect(resolved.source).toContain("OLLAMA_API_KEY");
  });
});

describe("resolveAzaicoderKeyForProvider – synthetic local auth for custom providers", () => {
  it("recognizes local baseUrl variants for synthetic auth config", () => {
    const localBaseUrls = [
      "http://127.0.0.1:8080/v1",
      "http://192.168.0.222:11434/v1",
      "http://localhost:11434/v1",
      "http://[::1]:8080/v1",
      "http://0.0.0.0:11434/v1",
      "http://[::ffff:127.0.0.1]:8080/v1",
    ];

    for (const baseUrl of localBaseUrls) {
      expect(
        hasSyntheticLocalProviderAuthConfig({
          provider: "custom-local",
          cfg: {
            models: {
              providers: {
                "custom-local": createCustomProviderConfig(baseUrl),
              },
            },
          },
        }),
        baseUrl,
      ).toBe(true);
    }
  });

  it("synthesizes a local auth marker for custom providers with a local baseUrl and no azaicoderKey", async () => {
    const auth = await resolveCustomProviderAuth(
      "custom-127-0-0-1-8080",
      "http://127.0.0.1:8080/v1",
      "qwen-3.5",
      "Qwen 3.5",
    );
    expect(auth.azaicoderKey).toBe(CUSTOM_LOCAL_AUTH_MARKER);
    expect(auth.source).toContain("synthetic local key");
  });

  it("does not synthesize auth for remote custom providers without azaicoderKey", async () => {
    expect(
      hasSyntheticLocalProviderAuthConfig({
        provider: "my-remote",
        cfg: {
          models: {
            providers: {
              "my-remote": createCustomProviderConfig("https://azaicoder.example.com/v1"),
            },
          },
        },
      }),
    ).toBe(false);

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "my-remote",
        cfg: {
          models: {
            providers: {
              "my-remote": {
                baseUrl: "https://azaicoder.example.com/v1",
                azaicoder: "openai-completions",
                models: [
                  {
                    id: "gpt-5",
                    name: "GPT-5",
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 8192,
                    maxTokens: 4096,
                  },
                ],
              },
            },
          },
        },
      }),
    ).rejects.toThrow("No API key found");
  });

  it("preserves custom named Ollama providers with explicit local marker auth", async () => {
    const auth = await resolveAzaicoderKeyForProvider({
      provider: "ollama-remote",
      cfg: {
        models: {
          providers: {
            "ollama-remote": {
              baseUrl: "http://192.168.178.122:11434",
              azaicoder: "ollama",
              azaicoderKey: "ollama-local",
              models: [
                {
                  id: "qwen3.5:27b",
                  name: "Qwen 3.5 27B",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 8192,
                  maxTokens: 4096,
                },
              ],
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
    });

    expectAuthFields(auth, {
      azaicoderKey: "ollama-local",
      source: "models.json (local marker)",
      mode: "azaicoder-key",
    });
  });

  it("uses Ollama plugin synthetic auth for custom private provider ids without azaicoderKey", async () => {
    const auth = await resolveAzaicoderKeyForProvider({
      provider: "ollama-gpu1",
      cfg: {
        models: {
          providers: {
            "ollama-gpu1": {
              baseUrl: "http://192.168.178.122:11435",
              azaicoder: "ollama",
              models: [
                {
                  id: "qwen3:14b",
                  name: "Qwen 3 14B",
                  reasoning: true,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 16384,
                  maxTokens: 4096,
                },
              ],
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
    });

    expectAuthFields(auth, {
      azaicoderKey: "ollama-local",
      source: "models.providers.ollama-gpu1 (synthetic local key)",
      mode: "azaicoder-key",
    });
  });

  it("prefers a custom Ollama provider SecretRef runtime key over plugin synthetic auth", async () => {
    const providerConfig = {
      ...createCustomProviderConfig("http://192.168.178.122:11435", "qwen3:14b", "Qwen 3 14B"),
      azaicoder: "ollama" as const,
      azaicoderKey: { source: "file", provider: "vault", id: "/ollama/azaicoder-key" } as const,
    };
    const sourceConfig = {
      models: {
        providers: {
          "ollama-gpu1": providerConfig,
        },
      },
    };
    setRuntimeConfigSnapshot(
      {
        models: {
          providers: {
            "ollama-gpu1": {
              ...providerConfig,
              azaicoderKey: "sk-runtime-ollama", // pragma: allowlist secret
            },
          },
        },
      },
      sourceConfig,
    );

    const auth = await resolveAzaicoderKeyForProvider({
      provider: "ollama-gpu1",
      cfg: sourceConfig,
      store: { version: 1, profiles: {} },
    });

    expectAuthFields(auth, {
      azaicoderKey: "sk-runtime-ollama",
      source: "models.providers.ollama-gpu1",
      mode: "azaicoder-key",
    });
  });

  it("resolves synthetic auth when model overrides azaicoder to ollama within a non-ollama provider", async () => {
    const auth = await getAzaicoderKeyForModel({
      model: {
        id: "my-router/local-llama",
        name: "Local Llama",
        provider: "my-router",
        azaicoder: "ollama",
        baseUrl: "http://localhost:11434",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 4096,
      },
      cfg: {
        models: {
          providers: {
            "my-router": {
              baseUrl: "http://localhost:8080/v1",
              azaicoder: "openai-completions",
              models: [
                {
                  id: "my-router/local-llama",
                  name: "Local Llama",
                  azaicoder: "ollama",
                  baseUrl: "http://localhost:11434",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 8192,
                  maxTokens: 4096,
                },
              ],
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
    });

    expectAuthFields(auth, {
      azaicoderKey: "ollama-local",
      source: "models.providers.my-router (synthetic local key)",
      mode: "azaicoder-key",
    });
  });

  it("accepts non-secret local markers for private LAN custom OpenAI-compatible providers", async () => {
    const auth = await resolveAzaicoderKeyForProvider({
      provider: "custom-192-168-0-222-11434",
      cfg: {
        models: {
          providers: {
            "custom-192-168-0-222-11434": {
              baseUrl: "http://192.168.0.222:11434/v1",
              azaicoder: "openai-completions",
              azaicoderKey: "ollama-local",
              models: [
                {
                  id: "qwen3.5:9b",
                  name: "Qwen 3.5 9B",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 8192,
                  maxTokens: 4096,
                },
              ],
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
    });

    expectAuthFields(auth, {
      azaicoderKey: CUSTOM_LOCAL_AUTH_MARKER,
      source: "models.json (local marker)",
      mode: "azaicoder-key",
    });
  });

  it.each(["docker.orb.internal", "host.docker.internal", "host.orb.internal"])(
    "accepts ollama-local marker auth for host-backed alias %s",
    async (hostname) => {
      const auth = await resolveAzaicoderKeyForProvider({
        provider: "ollama",
        cfg: {
          models: {
            providers: {
              ollama: {
                baseUrl: `http://${hostname}:11434`,
                azaicoder: "ollama",
                azaicoderKey: "ollama-local",
                models: [
                  {
                    id: "qwen3.5:27b",
                    name: "Qwen 3.5 27B",
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 262144,
                    maxTokens: 8192,
                  },
                ],
              },
            },
          },
        },
        store: { version: 1, profiles: {} },
      });

      expectAuthFields(auth, {
        azaicoderKey: "ollama-local",
        source: "models.json (local marker)",
        mode: "azaicoder-key",
      });
    },
  );

  it("does not accept non-secret local markers for remote custom providers", async () => {
    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "custom-remote",
        cfg: {
          models: {
            providers: {
              "custom-remote": {
                baseUrl: "https://azaicoder.example.com/v1",
                azaicoder: "openai-completions",
                azaicoderKey: "ollama-local",
                models: [
                  {
                    id: "qwen3.5:9b",
                    name: "Qwen 3.5 9B",
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 8192,
                    maxTokens: 4096,
                  },
                ],
              },
            },
          },
        },
        store: { version: 1, profiles: {} },
      }),
    ).rejects.toThrow('No API key found for provider "custom-remote"');
  });

  it("does not synthesize local auth when azaicoderKey is explicitly configured but unresolved", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(
        resolveAzaicoderKeyForProvider({
          provider: "custom",
          cfg: {
            models: {
              providers: {
                custom: {
                  baseUrl: "http://127.0.0.1:8080/v1",
                  azaicoder: "openai-completions",
                  azaicoderKey: "OPENAI_API_KEY",
                  models: [
                    {
                      id: "llama3",
                      name: "Llama 3",
                      reasoning: false,
                      input: ["text"],
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                      contextWindow: 8192,
                      maxTokens: 4096,
                    },
                  ],
                },
              },
            },
          },
        }),
      ).rejects.toThrow('No API key found for provider "custom"');
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("does not synthesize local auth when auth mode explicitly requires oauth", async () => {
    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "custom",
        cfg: {
          models: {
            providers: {
              custom: {
                baseUrl: "http://127.0.0.1:8080/v1",
                azaicoder: "openai-completions",
                auth: "oauth",
                models: [
                  {
                    id: "llama3",
                    name: "Llama 3",
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 8192,
                    maxTokens: 4096,
                  },
                ],
              },
            },
          },
        },
      }),
    ).rejects.toThrow('No API key found for provider "custom"');
  });

  it("uses explicit aws-sdk auth for local baseUrl overrides", async () => {
    const auth = await resolveAzaicoderKeyForProvider({
      provider: "amazon-bedrock",
      cfg: {
        models: {
          providers: {
            "amazon-bedrock": {
              baseUrl: "http://127.0.0.1:8080/v1",
              models: [],
              auth: "aws-sdk",
            },
          },
        },
      },
    });

    expect(auth.mode).toBe("aws-sdk");
    expect(auth.azaicoderKey).toBeUndefined();
  });

  it("uses implicit aws-sdk auth for built-in Bedrock Converse models", async () => {
    const auth = await getAzaicoderKeyForModel({
      model: {
        id: "us.anthrozaicoderc.zaicoder-sonnet-4-6-v1",
        name: "zAICoder Sonnet",
        provider: "amazon-bedrock",
        azaicoder: "bedrock-converse-stream",
        baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      store: { version: 1, profiles: {} },
    });

    expect(auth.mode).toBe("aws-sdk");
    expect(auth.azaicoderKey).toBeUndefined();
  });
});

describe("applyLocalNoAuthHeaderOverride", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks synthetic local OpenAI-compatible auth so SDK request headers clear Authorization", () => {
    const model = applyLocalNoAuthHeaderOverride(
      {
        id: "local-llm",
        name: "local-llm",
        azaicoder: "openai-completions",
        provider: "custom",
        baseUrl: "http://127.0.0.1:8080/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 4096,
        headers: { "X-Test": "1" },
      } as Model<"openai-completions">,
      {
        azaicoderKey: CUSTOM_LOCAL_AUTH_MARKER,
        source: "models.providers.custom (synthetic local key)",
        mode: "azaicoder-key",
      },
    );

    expect(model.headers?.Authorization).toBeNull();
    expect(model.headers?.["X-Test"]).toBe("1");
  });
});

describe("applyAuthHeaderOverride", () => {
  const baseModel: Model<"openai-completions"> = {
    id: "gemini-3.1-flash-lite",
    name: "gemini-3.1-flash-lite",
    azaicoder: "openai-completions" as const,
    provider: "google",
    baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192,
  };

  it("injects Authorization Bearer header when authHeader is true", () => {
    const result = applyAuthHeaderOverride(
      baseModel,
      { azaicoderKey: "test-azaicoder-key", source: "env", mode: "azaicoder-key" },
      {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
              azaicoder: "openai-completions",
              authHeader: true,
              models: [],
            },
          },
        },
      },
    );

    expect(result.headers).toEqual({ Authorization: "Bearer test-azaicoder-key" });
  });

  it("preserves existing model headers when injecting Authorization", () => {
    const result = applyAuthHeaderOverride(
      { ...baseModel, headers: { "X-Custom": "value" } },
      { azaicoderKey: "test-azaicoder-key", source: "env", mode: "azaicoder-key" },
      {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
              azaicoder: "openai-completions",
              authHeader: true,
              models: [],
            },
          },
        },
      },
    );

    expect(result.headers).toEqual({
      "X-Custom": "value",
      Authorization: "Bearer test-azaicoder-key",
    });
  });

  it("returns model unchanged when authHeader is not set", () => {
    const result = applyAuthHeaderOverride(
      baseModel,
      { azaicoderKey: "test-azaicoder-key", source: "env", mode: "azaicoder-key" },
      {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
      },
    );

    expect(result).toBe(baseModel);
  });

  it("returns model unchanged when authHeader is false", () => {
    const result = applyAuthHeaderOverride(
      baseModel,
      { azaicoderKey: "test-azaicoder-key", source: "env", mode: "azaicoder-key" },
      {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
              azaicoder: "openai-completions",
              authHeader: false,
              models: [],
            },
          },
        },
      },
    );

    expect(result).toBe(baseModel);
  });

  it("returns model unchanged when no API key is available", () => {
    const result = applyAuthHeaderOverride(baseModel, null, {
      models: {
        providers: {
          google: {
            baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
            azaicoder: "openai-completions",
            authHeader: true,
            models: [],
          },
        },
      },
    });

    expect(result).toBe(baseModel);
  });

  it("returns model unchanged when provider config is missing", () => {
    const result = applyAuthHeaderOverride(
      baseModel,
      { azaicoderKey: "test-azaicoder-key", source: "env", mode: "azaicoder-key" },
      undefined,
    );

    expect(result).toBe(baseModel);
  });

  it("rejects synthetic marker API keys", () => {
    const result = applyAuthHeaderOverride(
      baseModel,
      { azaicoderKey: CUSTOM_LOCAL_AUTH_MARKER, source: "synthetic", mode: "azaicoder-key" },
      {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
              azaicoder: "openai-completions",
              authHeader: true,
              models: [],
            },
          },
        },
      },
    );

    expect(result).toBe(baseModel);
  });

  it("strips existing authorization header case-insensitively before injection", () => {
    const result = applyAuthHeaderOverride(
      { ...baseModel, headers: { authorization: "old-value", "X-Custom": "keep" } },
      { azaicoderKey: "test-azaicoder-key", source: "env", mode: "azaicoder-key" },
      {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta/openai",
              azaicoder: "openai-completions",
              authHeader: true,
              models: [],
            },
          },
        },
      },
    );

    expect(result.headers).toEqual({
      "X-Custom": "keep",
      Authorization: "Bearer test-azaicoder-key",
    });
  });
});
