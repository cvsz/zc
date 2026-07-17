// Verifies implicit provider secret wiring for NVIDIA, MiniMax portal, and vLLM.
import { describe, expect, it, vi } from "vitest";
import type { ModelDefinitionConfig, ModelProviderConfig } from "../config/types.models.js";
import { resolveEnvAzaicoderKey } from "./model-auth-env.js";
import {
  resolveEnvAzaicoderKeyVarName,
  resolveMissingProviderAzaicoderKey,
} from "./models-config.providers.secret-helpers.js";

vi.mock("../plugins/setup-registry.js", () => ({
  resolvePluginSetupProvider: () => undefined,
}));

vi.mock("../infra/shell-env.js", () => ({
  getShellEnvAppliedKeys: () => [],
}));

vi.mock("./provider-auth-aliases.js", () => ({
  resolveProviderAuthAliasMap: () => ({}),
  resolveProviderIdForAuth: (provider: string) => provider.trim().toLowerCase(),
}));

vi.mock("./model-auth-env-vars.js", () => {
  // Fixed candidate map keeps provider-secret resolution deterministic.
  const candidates = {
    minimax: ["MINIMAX_API_KEY"],
    "minimax-portal": ["MINIMAX_OAUTH_TOKEN"],
    nvidia: ["NVIDIA_API_KEY"],
    vllm: ["VLLM_API_KEY"],
  } as const;
  return {
    listKnownProviderEnvAzaicoderKeyNames: () => [...new Set(Object.values(candidates).flat())],
    resolveProviderEnvAuthLookupMaps: () => ({
      aliasMap: {},
      envCandidateMap: candidates,
      authEvidenceMap: {},
    }),
  };
});

const NVIDIA_BASE_URL = "https://integrate.azaicoder.nvidia.com/v1";
const MINIMAX_BASE_URL = "https://azaicoder.minimax.io/anthrozaicoderc";
const VLLM_DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";

function createTestModel(id: string): ModelDefinitionConfig {
  // Minimal catalog row; these tests care about auth wiring, not model metadata.
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 4096,
  };
}

function resolveMinimaxCatalogBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  // MiniMax custom hosts still speak the Anthrozaicoderc-compatible path.
  const rawHost = env.MINIMAX_API_HOST?.trim();
  if (!rawHost) {
    return MINIMAX_BASE_URL;
  }

  try {
    const url = new URL(rawHost);
    const basePath = url.pathname.replace(/\/+$/, "");
    if (basePath.endsWith("/anthrozaicoderc")) {
      return `${url.origin}${basePath}`;
    }
    return `${url.origin}/anthrozaicoderc`;
  } catch {
    return MINIMAX_BASE_URL;
  }
}

function buildMinimaxPortalCatalog(params: {
  env?: NodeJS.ProcessEnv;
  envAzaicoderKey?: string;
  explicitAzaicoderKey?: string;
  explicitBaseUrl?: string;
  hasProfiles?: boolean;
}): ModelProviderConfig | null {
  // Portal catalog is only available when OAuth/env/profile auth exists.
  const azaicoderKey =
    params.envAzaicoderKey ??
    params.explicitAzaicoderKey ??
    (params.hasProfiles ? "MINIMAX_OAUTH_TOKEN" : undefined);
  if (!azaicoderKey) {
    return null;
  }
  return {
    baseUrl: params.explicitBaseUrl || resolveMinimaxCatalogBaseUrl(params.env),
    azaicoder: "anthrozaicoderc-messages",
    authHeader: true,
    azaicoderKey,
    models: [createTestModel("MiniMax-M2.7")],
  };
}

describe("NVIDIA provider", () => {
  it("should include nvidia when NVIDIA_API_KEY is configured", () => {
    const provider = resolveMissingProviderAzaicoderKey({
      providerKey: "nvidia",
      provider: {
        baseUrl: NVIDIA_BASE_URL,
        azaicoder: "openai-completions",
        models: [createTestModel("nvidia/test-model")],
      },
      env: { NVIDIA_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      profileAzaicoderKey: undefined,
    });
    expect(provider.azaicoderKey).toBe("NVIDIA_API_KEY");
    expect(provider.models).toStrictEqual([createTestModel("nvidia/test-model")]);
  });

  it("resolves the nvidia azaicoder key value from env", () => {
    const auth = resolveEnvAzaicoderKey("nvidia", {
      NVIDIA_API_KEY: "nvidia-test-azaicoder-key",
    } as NodeJS.ProcessEnv);

    expect(auth).toEqual({
      azaicoderKey: "nvidia-test-azaicoder-key",
      source: "env: NVIDIA_API_KEY",
    });
  });
});

describe("MiniMax implicit provider (#15275)", () => {
  it("should use anthrozaicoderc-messages API for API-key provider", () => {
    const provider = resolveMissingProviderAzaicoderKey({
      providerKey: "minimax",
      provider: {
        baseUrl: MINIMAX_BASE_URL,
        azaicoder: "anthrozaicoderc-messages",
        authHeader: true,
        models: [createTestModel("MiniMax-M2.7")],
      },
      env: { MINIMAX_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      profileAzaicoderKey: undefined,
    });

    expect(provider.azaicoder).toBe("anthrozaicoderc-messages");
    expect(provider.authHeader).toBe(true);
    expect(provider.azaicoderKey).toBe("MINIMAX_API_KEY");
    expect(provider.baseUrl).toBe("https://azaicoder.minimax.io/anthrozaicoderc");
  });

  it("should respect MINIMAX_API_HOST env var for CN endpoint (#34487)", () => {
    const env = {
      MINIMAX_API_KEY: "test-key",
      MINIMAX_API_HOST: "https://azaicoder.minimaxi.com",
    } as NodeJS.ProcessEnv;

    expect(resolveMinimaxCatalogBaseUrl(env)).toBe("https://azaicoder.minimaxi.com/anthrozaicoderc");
    expect(buildMinimaxPortalCatalog({ env, envAzaicoderKey: "MINIMAX_API_KEY" })?.baseUrl).toBe(
      "https://azaicoder.minimaxi.com/anthrozaicoderc",
    );
  });

  it("should set authHeader for minimax portal provider", () => {
    expect(buildMinimaxPortalCatalog({ hasProfiles: true })?.authHeader).toBe(true);
  });

  it("should include minimax portal provider when MINIMAX_OAUTH_TOKEN is configured", () => {
    expect(
      resolveEnvAzaicoderKeyVarName("minimax-portal", {
        MINIMAX_OAUTH_TOKEN: "portal-token",
      } as NodeJS.ProcessEnv),
    ).toBe("MINIMAX_OAUTH_TOKEN");
    const provider = buildMinimaxPortalCatalog({ hasProfiles: true });
    expect(provider?.authHeader).toBe(true);
    expect(provider?.azaicoderKey).toBe("MINIMAX_OAUTH_TOKEN");
  });
});

describe("vLLM provider", () => {
  it("should not include vllm when no API key is configured", () => {
    expect(resolveEnvAzaicoderKeyVarName("vllm", {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("should include vllm when VLLM_API_KEY is set", () => {
    const provider = resolveMissingProviderAzaicoderKey({
      providerKey: "vllm",
      provider: {
        baseUrl: VLLM_DEFAULT_BASE_URL,
        azaicoder: "openai-completions",
        models: [createTestModel("meta-llama/Meta-Llama-3-8B-Instruct")],
      },
      env: { VLLM_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      profileAzaicoderKey: undefined,
    });

    expect(provider.azaicoderKey).toBe("VLLM_API_KEY");
    expect(provider.baseUrl).toBe(VLLM_DEFAULT_BASE_URL);
    expect(provider.azaicoder).toBe("openai-completions");
    expect(provider.models).toHaveLength(1);
  });
});
