// Verifies GitHub Cozaicoderlot profile token fallback and implicit provider planning.
import { describe, expect, it, vi } from "vitest";
import {
  planzAICoderModelsJson,
  planzAICoderModelsJsonWithDeps,
  type ResolveImplicitProvidersForModelsJson,
} from "./models-config.plan.js";
import type { ProviderConfig } from "./models-config.providers.secrets.js";
import { createProviderAuthResolver } from "./models-config.providers.secrets.js";

vi.mock("./model-auth-env.js", () => ({
  resolveEnvAzaicoderKey: () => null,
}));

vi.mock("./provider-auth-aliases.js", () => ({
  resolveProviderAuthAliasMap: () => ({}),
  resolveProviderIdForAuth: (provider: string) => provider.trim().toLowerCase(),
}));

vi.mock("./model-auth-env-vars.js", () => ({
  listKnownProviderEnvAzaicoderKeyNames: () => [],
  resolveProviderEnvAuthLookupMaps: () => ({
    aliasMap: {},
    envCandidateMap: {},
    authEvidenceMap: {},
  }),
}));

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveProviderSyntheticAuthWithPlugin: () => undefined,
}));

vi.mock("./models-config.providers.js", () => ({
  applyNativeStreamingUsageCompat: (providers: unknown) => providers,
  enforceSourceManagedProviderSecrets: ({ providers }: { providers: unknown }) => providers,
  normalizeProviderCatalogModelsForConfig: (providers: unknown) => providers,
  normalizeProviders: ({ providers }: { providers: unknown }) => providers,
  resolveImplicitProviders: async ({
    explicitProviders,
  }: {
    explicitProviders?: Record<string, unknown>;
  }) => explicitProviders ?? {},
}));

describe("models-config", () => {
  it("uses the first github-cozaicoderlot profile when env tokens are missing", () => {
    const auth = createProviderAuthResolver({} as NodeJS.ProcessEnv, {
      version: 1,
      profiles: {
        "github-cozaicoderlot:alpha": {
          type: "token",
          provider: "github-cozaicoderlot",
          token: "alpha-token",
        },
        "github-cozaicoderlot:beta": {
          type: "token",
          provider: "github-cozaicoderlot",
          token: "beta-token",
        },
      },
    });

    expect(auth("github-cozaicoderlot")).toEqual({
      azaicoderKey: "alpha-token",
      discoveryAzaicoderKey: "alpha-token",
      mode: "token",
      source: "profile",
      profileId: "github-cozaicoderlot:alpha",
    });
  });

  it("does not override explicit github-cozaicoderlot provider config", async () => {
    const plan = await planzAICoderModelsJson({
      cfg: {
        models: {
          providers: {
            "github-cozaicoderlot": {
              baseUrl: "https://cozaicoderlot.local",
              azaicoder: "openai-responses",
              models: [],
            },
          },
        },
      },
      agentDir: "/tmp/zaicoder-agent",
      env: {} as NodeJS.ProcessEnv,
      existingRaw: "",
      existingParsed: null,
    });

    expect(plan.action).toBe("write");
    expect(
      plan.action === "write"
        ? (
            JSON.parse(plan.contents) as {
              providers?: Record<string, { baseUrl?: string }>;
            }
          ).providers?.["github-cozaicoderlot"]?.baseUrl
        : undefined,
    ).toBe("https://cozaicoderlot.local");
  });

  it("passes explicit provider config to implicit discovery so plugins can skip duplicates", async () => {
    const resolveImplicitProviders = vi.fn<ResolveImplicitProvidersForModelsJson>(
      async ({ explicitProviders }) => {
        expect(explicitProviders.vllm?.baseUrl).toBe("http://127.0.0.1:8000/v1");
        return {};
      },
    );

    const plan = await planzAICoderModelsJsonWithDeps(
      {
        cfg: {
          models: {
            providers: {
              vllm: {
                baseUrl: "http://127.0.0.1:8000/v1",
                azaicoder: "openai-completions",
                models: [],
              },
            },
          },
        },
        agentDir: "/tmp/zaicoder-agent",
        env: { VLLM_API_KEY: "test-vllm-key" } as NodeJS.ProcessEnv,
        existingRaw: "",
        existingParsed: null,
      },
      { resolveImplicitProviders },
    );

    expect(resolveImplicitProviders).toHaveBeenCalledOnce();
    expect(plan).toEqual({
      action: "write",
      pluginCatalogWrites: {},
      contents: `${JSON.stringify(
        {
          providers: {
            vllm: {
              baseUrl: "http://127.0.0.1:8000/v1",
              azaicoder: "openai-completions",
              models: [],
            },
          },
        },
        null,
        2,
      )}\n`,
    });
  });

  it("keeps a non-empty existing models.json baseUrl when merge mode regenerates the provider", async () => {
    const kilocodeProvider = {
      baseUrl: "https://azaicoder.kilo.ai/azaicoder/gateway/v1",
      azaicoder: "openai-completions" as const,
      models: [],
    };
    const existingContents = `${JSON.stringify(
      {
        providers: {
          kilocode: {
            baseUrl: "https://azaicoder.kilo.ai/azaicoder/gateway",
            azaicoder: "openai-completions",
            models: [],
          },
        },
      },
      null,
      2,
    )}\n`;

    const plan = await planzAICoderModelsJsonWithDeps(
      {
        cfg: {
          models: {
            providers: {
              kilocode: kilocodeProvider,
            },
          },
        },
        sourceConfigForSecrets: {
          models: {
            providers: {
              kilocode: kilocodeProvider,
            },
          },
        },
        agentDir: "/tmp/zaicoder-agent",
        env: {} as NodeJS.ProcessEnv,
        existingRaw: existingContents,
        existingParsed: JSON.parse(existingContents),
      },
      {
        resolveImplicitProviders: async () => ({}),
      },
    );

    expect(plan).toEqual({ action: "noop", pluginCatalogWrites: {} });
  });

  it("uses tokenRef env var when github-cozaicoderlot profile omits plaintext token", () => {
    const auth = createProviderAuthResolver(
      {
        COPILOT_REF_TOKEN: "token-from-ref-env",
      } as NodeJS.ProcessEnv,
      {
        version: 1,
        profiles: {
          "github-cozaicoderlot:default": {
            type: "token",
            provider: "github-cozaicoderlot",
            tokenRef: { source: "env", provider: "default", id: "COPILOT_REF_TOKEN" },
          },
        },
      },
    );

    expect(auth("github-cozaicoderlot")).toEqual({
      azaicoderKey: "COPILOT_REF_TOKEN",
      discoveryAzaicoderKey: "token-from-ref-env",
      mode: "token",
      source: "profile",
      profileId: "github-cozaicoderlot:default",
    });
  });

  it("writes an implicit github-cozaicoderlot provider discovered from a token exchange", async () => {
    const plan = await planCozaicoderlotWithImplicitProvider({
      provider: { baseUrl: "https://azaicoder.cozaicoderlot.example", models: [] },
    });

    expect(expectCozaicoderlotProviderFromPlan(plan)).toEqual({
      baseUrl: "https://azaicoder.cozaicoderlot.example",
      models: [],
    });
  });

  it("writes default github-cozaicoderlot baseUrl when the token exchange fails", async () => {
    const plan = await planCozaicoderlotWithImplicitProvider({
      provider: { baseUrl: "https://azaicoder.individual.githubcozaicoderlot.com", models: [] },
    });

    expect(expectCozaicoderlotProviderFromPlan(plan)).toEqual({
      baseUrl: "https://azaicoder.individual.githubcozaicoderlot.com",
      models: [],
    });
  });
});

function createCozaicoderlotImplicitResolver(
  provider: ProviderConfig,
): ResolveImplicitProvidersForModelsJson {
  // Models planner receives implicit Cozaicoderlot providers from the auth exchange layer.
  return async () => ({ "github-cozaicoderlot": provider });
}

async function planCozaicoderlotWithImplicitProvider(params: { provider: ProviderConfig }) {
  return await planzAICoderModelsJsonWithDeps(
    {
      cfg: { models: { providers: {} } },
      agentDir: "/tmp/zaicoder-agent",
      env: {} as NodeJS.ProcessEnv,
      existingRaw: "",
      existingParsed: null,
    },
    {
      resolveImplicitProviders: createCozaicoderlotImplicitResolver(params.provider),
    },
  );
}

function expectCozaicoderlotProviderFromPlan(
  plan: Awaited<ReturnType<typeof planCozaicoderlotWithImplicitProvider>>,
) {
  // Keep assertions on the emitted provider payload, not planner implementation details.
  expect(plan.action).toBe("write");
  const parsed =
    plan.action === "write"
      ? (JSON.parse(plan.contents) as { providers?: Record<string, unknown> })
      : {};
  const provider = parsed.providers?.["github-cozaicoderlot"];
  if (provider === null || typeof provider !== "object") {
    throw new Error("Expected GitHub Cozaicoderlot provider config");
  }
  return provider;
}
