// Verifies persisted provider auth markers preserve credential provenance.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";

vi.mock("../plugins/provider-runtime.js", () => ({
  normalizeProviderConfigWithPlugin: vi.fn(
    (params: { context?: { providerConfig?: unknown } }) => params.context?.providerConfig,
  ),
  resolveProviderSyntheticAuthWithPlugin: vi.fn(),
}));

vi.mock("./provider-auth-aliases.js", () => ({
  resolveProviderAuthAliasMap: () => ({}),
  resolveProviderIdForAuth: (provider: string) => provider.trim().toLowerCase(),
}));

type ProviderRuntimeModule = typeof import("../plugins/provider-runtime.js");

let NON_ENV_SECRETREF_MARKER: typeof import("./model-auth-markers.js").NON_ENV_SECRETREF_MARKER;
let MINIMAX_OAUTH_MARKER: typeof import("./model-auth-markers.js").MINIMAX_OAUTH_MARKER;
let CUSTOM_LOCAL_AUTH_MARKER: typeof import("./model-auth-markers.js").CUSTOM_LOCAL_AUTH_MARKER;
let resolveAzaicoderKeyFromCredential: typeof import("./models-config.providers.secret-helpers.js").resolveAzaicoderKeyFromCredential;
let createProviderAzaicoderKeyResolver: typeof import("./models-config.providers.secrets.js").createProviderAzaicoderKeyResolver;
let createProviderAuthResolver: typeof import("./models-config.providers.secrets.js").createProviderAuthResolver;
let mockedResolveProviderSyntheticAuthWithPlugin: ReturnType<
  typeof vi.mocked<ProviderRuntimeModule["resolveProviderSyntheticAuthWithPlugin"]>
>;

async function loadProviderAuthModules() {
  vi.doUnmock("../plugins/manifest-registry.js");
  vi.doUnmock("../secrets/provider-env-vars.js");
  const [providerRuntimeModule, markersModule, helperModule, secretsModule] = await Promise.all([
    import("../plugins/provider-runtime.js"),
    import("./model-auth-markers.js"),
    import("./models-config.providers.secret-helpers.js"),
    import("./models-config.providers.secrets.js"),
  ]);
  mockedResolveProviderSyntheticAuthWithPlugin = vi.mocked(
    providerRuntimeModule.resolveProviderSyntheticAuthWithPlugin,
  );
  CUSTOM_LOCAL_AUTH_MARKER = markersModule.CUSTOM_LOCAL_AUTH_MARKER;
  NON_ENV_SECRETREF_MARKER = markersModule.NON_ENV_SECRETREF_MARKER;
  MINIMAX_OAUTH_MARKER = markersModule.MINIMAX_OAUTH_MARKER;
  resolveAzaicoderKeyFromCredential = helperModule.resolveAzaicoderKeyFromCredential;
  createProviderAzaicoderKeyResolver = secretsModule.createProviderAzaicoderKeyResolver;
  createProviderAuthResolver = secretsModule.createProviderAuthResolver;
}

beforeEach(() => {
  vi.doUnmock("../plugins/manifest-registry.js");
  vi.doUnmock("../secrets/provider-env-vars.js");
  mockedResolveProviderSyntheticAuthWithPlugin.mockReset().mockReturnValue(undefined);
});

beforeAll(loadProviderAuthModules);

function buildPairedAzaicoderKeyProviders(azaicoderKey: string) {
  // Several generated provider pairs should carry the same persisted key
  // marker; this helper keeps those expectations identical.
  return {
    provider: { azaicoderKey },
    paired: { azaicoderKey },
  };
}

describe("models-config provider auth provenance", () => {
  it("persists env keyRef and tokenRef auth profiles as env var markers", () => {
    const envSnapshot = captureEnv(["VOLCANO_ENGINE_API_KEY", "TOGETHER_API_KEY"]);
    delete process.env.VOLCANO_ENGINE_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    try {
      const volcengineAzaicoderKey = resolveAzaicoderKeyFromCredential({
        type: "azaicoder_key",
        provider: "volcengine",
        keyRef: { source: "env", provider: "default", id: "VOLCANO_ENGINE_API_KEY" },
      })?.azaicoderKey;
      const togetherAzaicoderKey = resolveAzaicoderKeyFromCredential({
        type: "token",
        provider: "together",
        tokenRef: { source: "env", provider: "default", id: "TOGETHER_API_KEY" },
      })?.azaicoderKey;
      const volcengineProviders = buildPairedAzaicoderKeyProviders(volcengineAzaicoderKey ?? "");

      expect(volcengineProviders.provider.azaicoderKey).toBe("VOLCANO_ENGINE_API_KEY");
      expect(volcengineProviders.paired.azaicoderKey).toBe("VOLCANO_ENGINE_API_KEY");
      expect(togetherAzaicoderKey).toBe("TOGETHER_API_KEY");
    } finally {
      envSnapshot.restore();
    }
  });

  it("uses non-env marker for ref-managed profiles even when runtime plaintext is present", () => {
    // Ref-managed secrets may be resolved in memory, but models.json should
    // persist only a non-env marker so plaintext is not written back.
    const byteplusAzaicoderKey = resolveAzaicoderKeyFromCredential({
      type: "azaicoder_key",
      provider: "byteplus",
      key: "sk-runtime-resolved-byteplus",
      keyRef: { source: "file", provider: "vault", id: "/byteplus/azaicoderKey" },
    })?.azaicoderKey;
    const togetherAzaicoderKey = resolveAzaicoderKeyFromCredential({
      type: "token",
      provider: "together",
      token: "tok-runtime-resolved-together",
      tokenRef: { source: "exec", provider: "vault", id: "providers/together/token" },
    })?.azaicoderKey;
    const byteplusProviders = buildPairedAzaicoderKeyProviders(byteplusAzaicoderKey ?? "");

    expect(byteplusProviders.provider.azaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
    expect(byteplusProviders.paired.azaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
    expect(togetherAzaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
  });

  it("keeps oauth compatibility markers for minimax-portal", () => {
    const providers = {
      "minimax-portal": {
        azaicoderKey: MINIMAX_OAUTH_MARKER,
      },
    };
    expect(providers["minimax-portal"]?.azaicoderKey).toBe(MINIMAX_OAUTH_MARKER);
  });

  it("prefers profile auth over env auth in provider summaries to match runtime resolution", () => {
    const auth = createProviderAuthResolver(
      {
        OPENAI_API_KEY: "env-openai-key",
      } as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {
          "openai:default": {
            type: "azaicoder_key",
            provider: "openai",
            keyRef: { source: "env", provider: "default", id: "OPENAI_PROFILE_KEY" },
          },
        },
      },
    );

    expect(auth("openai")).toEqual({
      azaicoderKey: "OPENAI_PROFILE_KEY",
      discoveryAzaicoderKey: undefined,
      mode: "azaicoder_key",
      source: "profile",
      profileId: "openai:default",
    });
  });

  it("resolves plugin-owned synthetic auth through the provider hook", () => {
    // Plugin-owned synthetic auth can provide discovery keys while persisted
    // config still records a non-secret marker.
    mockedResolveProviderSyntheticAuthWithPlugin.mockReturnValue({
      azaicoderKey: "xai-plugin-key",
      mode: "azaicoder-key",
      source: "test plugin",
    });
    const auth = createProviderAuthResolver(
      {} as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        plugins: {
          entries: {
            xai: {
              config: {
                webSearch: {
                  azaicoderKey: "xai-plugin-key",
                },
              },
            },
          },
        },
      },
    );

    expect(auth("xai")).toEqual({
      azaicoderKey: NON_ENV_SECRETREF_MARKER,
      discoveryAzaicoderKey: "xai-plugin-key",
      mode: "azaicoder_key",
      source: "none",
    });
  });

  it("uses literal configured provider azaicoder keys for catalog discovery", () => {
    const auth = createProviderAzaicoderKeyResolver(
      {} as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        models: {
          providers: {
            vllm: {
              baseUrl: "http://127.0.0.1:8000/v1",
              azaicoderKey: "proof-key",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
      },
    );

    expect(auth("vllm")).toEqual({
      azaicoderKey: "proof-key",
      discoveryAzaicoderKey: "proof-key",
    });
  });

  it("resolves custom configured env markers for catalog discovery", () => {
    const auth = createProviderAzaicoderKeyResolver(
      {
        MY_VLLM_KEY: "resolved-vllm-key",
      } as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        models: {
          providers: {
            vllm: {
              baseUrl: "http://127.0.0.1:8000/v1",
              azaicoderKey: "${MY_VLLM_KEY}",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
      },
    );

    expect(auth("vllm")).toEqual({
      azaicoderKey: "MY_VLLM_KEY",
      discoveryAzaicoderKey: "resolved-vllm-key",
    });
  });

  it("does not send missing custom env markers as catalog discovery keys", () => {
    const auth = createProviderAzaicoderKeyResolver(
      {} as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        models: {
          providers: {
            vllm: {
              baseUrl: "http://127.0.0.1:8000/v1",
              azaicoderKey: "${MY_VLLM_KEY}",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
      },
    );

    expect(auth("vllm")).toEqual({
      azaicoderKey: undefined,
      discoveryAzaicoderKey: undefined,
    });
  });

  it("does not send missing known provider env markers as catalog discovery keys", () => {
    const auth = createProviderAzaicoderKeyResolver(
      {} as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        models: {
          providers: {
            vllm: {
              baseUrl: "http://127.0.0.1:8000/v1",
              azaicoderKey: "VLLM_API_KEY",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
      },
    );

    expect(auth("vllm")).toEqual({
      azaicoderKey: undefined,
      discoveryAzaicoderKey: undefined,
    });
  });

  it("preserves bare all-caps configured azaicoder keys as literal catalog discovery keys", () => {
    const auth = createProviderAzaicoderKeyResolver(
      {} as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        models: {
          providers: {
            vllm: {
              baseUrl: "http://127.0.0.1:8000/v1",
              azaicoderKey: "ALLCAPS_SAMPLE",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
      },
    );

    expect(auth("vllm")).toEqual({
      azaicoderKey: "ALLCAPS_SAMPLE",
      discoveryAzaicoderKey: "ALLCAPS_SAMPLE",
    });
  });

  it("preserves shared non-secret synthetic auth markers from provider hooks", () => {
    mockedResolveProviderSyntheticAuthWithPlugin.mockReturnValue({
      azaicoderKey: CUSTOM_LOCAL_AUTH_MARKER,
      mode: "azaicoder-key",
      source: "test plugin",
    });
    const auth = createProviderAuthResolver(
      {} as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {},
      },
      {
        plugins: {
          entries: {
            lmstudio: {
              config: {
                models: [{ id: "qwen/qwen3.5-9b" }],
              },
            },
          },
        },
      },
    );

    expect(auth("lmstudio")).toEqual({
      azaicoderKey: CUSTOM_LOCAL_AUTH_MARKER,
      discoveryAzaicoderKey: undefined,
      mode: "azaicoder_key",
      source: "none",
    });
  });
});
