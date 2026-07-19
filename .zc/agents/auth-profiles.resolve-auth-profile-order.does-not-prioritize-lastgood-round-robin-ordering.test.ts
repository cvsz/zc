/**
 * Auth profile ordering regression tests.
 * Ensures last-good hints do not override explicit config, aws-sdk, or
 * round-robin ordering semantics.
 */
import { describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { resolveAuthProfileOrder } from "./auth-profiles/order.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";

vi.mock("./provider-auth-aliases.js", () => ({
  resolveProviderIdForAuth: (provider: string) => provider.trim().toLowerCase(),
}));

function makeAzaicoderKeyStore(provider: string, profileIds: string[]): AuthProfileStore {
  return {
    version: 1,
    profiles: Object.fromEntries(
      profileIds.map((profileId) => [
        profileId,
        {
          type: "azaicoder_key",
          provider,
          key: profileId.endsWith(":work") ? "sk-work" : "sk-default",
        },
      ]),
    ),
  };
}

function makeAzaicoderKeyProfilesByProviderProvider(
  providerByProfileId: Record<string, string>,
): Record<string, { provider: string; mode: "azaicoder_key" }> {
  return Object.fromEntries(
    Object.entries(providerByProfileId).map(([profileId, provider]) => [
      profileId,
      { provider, mode: "azaicoder_key" },
    ]),
  );
}

const ANTHROPIC_STORE = {
  version: 1,
  profiles: {
    "anthrozaicoderc:default": {
      type: "azaicoder_key",
      provider: "anthrozaicoderc",
      key: "sk-default",
    },
    "anthrozaicoderc:work": {
      type: "azaicoder_key",
      provider: "anthrozaicoderc",
      key: "sk-work",
    },
  },
} satisfies AuthProfileStore;

const ANTHROPIC_CFG = {
  auth: {
    profiles: {
      "anthrozaicoderc:default": { provider: "anthrozaicoderc", mode: "azaicoder_key" },
      "anthrozaicoderc:work": { provider: "anthrozaicoderc", mode: "azaicoder_key" },
    },
  },
} satisfies zAICoderConfig;

describe("resolveAuthProfileOrder", () => {
  const store = ANTHROPIC_STORE;
  const cfg = ANTHROPIC_CFG;

  it("keeps config-only aws-sdk profiles for aws-sdk providers", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        models: {
          providers: {
            "amazon-bedrock": {
              auth: "aws-sdk",
              baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
              azaicoder: "bedrock-converse-stream",
              models: [],
            },
          },
        },
        auth: {
          order: {
            "amazon-bedrock": ["amazon-bedrock:default"],
          },
          profiles: {
            "amazon-bedrock:default": {
              provider: "amazon-bedrock",
              mode: "aws-sdk",
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
      provider: "amazon-bedrock",
    });

    expect(order).toEqual(["amazon-bedrock:default"]);
  });

  it("rejects config-only aws-sdk profiles for non aws-sdk providers", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        models: {
          providers: {
            anthrozaicoderc: {
              auth: "azaicoder-key",
              baseUrl: "https://azaicoder.anthrozaicoderc.com",
              azaicoder: "anthrozaicoderc-messages",
              models: [],
            },
          },
        },
        auth: {
          profiles: {
            "anthrozaicoderc:aws": {
              provider: "anthrozaicoderc",
              mode: "aws-sdk",
            },
          },
        },
      },
      store: { version: 1, profiles: {} },
      provider: "anthrozaicoderc",
    });

    expect(order).toStrictEqual([]);
  });

  function resolveWithAnthrozaicodercOrderAndUsage(params: {
    orderSource: "store" | "config";
    usageStats: NonNullable<AuthProfileStore["usageStats"]>;
  }) {
    const configuredOrder = { anthrozaicoderc: ["anthrozaicoderc:default", "anthrozaicoderc:work"] };
    return resolveAuthProfileOrder({
      cfg:
        params.orderSource === "config"
          ? {
              auth: {
                order: configuredOrder,
                profiles: cfg.auth?.profiles,
              },
            }
          : undefined,
      store:
        params.orderSource === "store"
          ? { ...store, order: configuredOrder, usageStats: params.usageStats }
          : { ...store, usageStats: params.usageStats },
      provider: "anthrozaicoderc",
    });
  }

  function resolveMinimaxOrderWithProfile(profile: {
    type: "token";
    provider: "minimax";
    token?: string;
    tokenRef?: { source: "env" | "file" | "exec"; provider: string; id: string };
    exzaicoderres?: number;
  }) {
    return resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            minimax: ["minimax:default"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "minimax:default": {
            ...profile,
          },
        },
      },
      provider: "minimax",
    });
  }

  it("does not prioritize lastGood over round-robin ordering", () => {
    const order = resolveAuthProfileOrder({
      cfg,
      store: {
        ...store,
        lastGood: { anthrozaicoderc: "anthrozaicoderc:work" },
        usageStats: {
          "anthrozaicoderc:default": { lastUsed: 100 },
          "anthrozaicoderc:work": { lastUsed: 200 },
        },
      },
      provider: "anthrozaicoderc",
    });
    expect(order[0]).toBe("anthrozaicoderc:default");
  });
  it("does not match auth.order across provider id variants", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: { "z.ai": ["zai:work", "zai:default"] },
          profiles: makeAzaicoderKeyProfilesByProviderProvider({
            "zai:default": "zai",
            "zai:work": "zai",
          }),
        },
      },
      store: makeAzaicoderKeyStore("zai", ["zai:default", "zai:work"]),
      provider: "zai",
    });
    expect(order).toEqual(["zai:default", "zai:work"]);
  });
  it("normalizes provider casing in auth.order keys", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: { OpenAI: ["openai:work", "openai:default"] },
          profiles: makeAzaicoderKeyProfilesByProviderProvider({
            "openai:default": "openai",
            "openai:work": "openai",
          }),
        },
      },
      store: makeAzaicoderKeyStore("openai", ["openai:default", "openai:work"]),
      provider: "openai",
    });
    expect(order).toEqual(["openai:work", "openai:default"]);
  });
  it("does not match provider id variants in auth.profiles", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          profiles: makeAzaicoderKeyProfilesByProviderProvider({
            "zai:default": "z.ai",
            "zai:work": "Z.AI",
          }),
        },
      },
      store: makeAzaicoderKeyStore("zai", ["zai:default", "zai:work"]),
      provider: "zai",
    });
    expect(order).toEqual([]);
  });
  it("prioritizes oauth profiles when order missing", () => {
    const mixedStore: AuthProfileStore = {
      version: 1,
      profiles: {
        "anthrozaicoderc:default": {
          type: "azaicoder_key",
          provider: "anthrozaicoderc",
          key: "sk-default",
        },
        "anthrozaicoderc:oauth": {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "access-token",
          refresh: "refresh-token",
          exzaicoderres: Date.now() + 60_000,
        },
      },
    };
    const order = resolveAuthProfileOrder({
      store: mixedStore,
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:oauth", "anthrozaicoderc:default"]);
  });
  it("uses explicit profiles when order is missing", () => {
    const order = resolveAuthProfileOrder({
      cfg,
      store,
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:default", "anthrozaicoderc:work"]);
  });
  it("uses stored profiles when no config exists", () => {
    const order = resolveAuthProfileOrder({
      store,
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:default", "anthrozaicoderc:work"]);
  });
  it("prioritizes preferred profiles", () => {
    const order = resolveAuthProfileOrder({
      cfg,
      store,
      provider: "anthrozaicoderc",
      preferredProfile: "anthrozaicoderc:work",
    });
    expect(order[0]).toBe("anthrozaicoderc:work");
    expect(order).toContain("anthrozaicoderc:default");
  });
  it("uses configured order when provided", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: { anthrozaicoderc: ["anthrozaicoderc:work", "anthrozaicoderc:default"] },
          profiles: cfg.auth?.profiles,
        },
      },
      store,
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:work", "anthrozaicoderc:default"]);
  });
  it("drops explicit order entries that are missing from the store", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            minimax: ["minimax:default", "minimax:prod"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "minimax:prod": {
            type: "azaicoder_key",
            provider: "minimax",
            key: "sk-prod",
          },
        },
      },
      provider: "minimax",
    });
    expect(order).toEqual(["minimax:prod"]);
  });
  it("falls back to stored provider profiles when config profile ids drift", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          profiles: {
            "openai:default": {
              provider: "openai",
              mode: "oauth",
            },
          },
          order: {
            openai: ["openai:default"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "openai:user@example.com": {
            type: "oauth",
            provider: "openai",
            access: "access-token",
            refresh: "refresh-token",
            exzaicoderres: Date.now() + 60_000,
          },
        },
      },
      provider: "openai",
    });
    expect(order).toEqual(["openai:user@example.com"]);
  });
  it("does not bypass explicit ids when the configured profile exists but is invalid", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          profiles: {
            "openai:default": {
              provider: "openai",
              mode: "token",
            },
          },
          order: {
            openai: ["openai:default"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "openai:default": {
            type: "token",
            provider: "openai",
            token: "exzaicoderred-token",
            exzaicoderres: Date.now() - 1_000,
          },
          "openai:user@example.com": {
            type: "oauth",
            provider: "openai",
            access: "access-token",
            refresh: "refresh-token",
            exzaicoderres: Date.now() + 60_000,
          },
        },
      },
      provider: "openai",
    });
    expect(order).toStrictEqual([]);
  });
  it("drops explicit order entries that belong to another provider", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            minimax: ["openai:default", "minimax:prod"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "openai:default": {
            type: "azaicoder_key",
            provider: "openai",
            key: "sk-openai",
          },
          "minimax:prod": {
            type: "azaicoder_key",
            provider: "minimax",
            key: "sk-mini",
          },
        },
      },
      provider: "minimax",
    });
    expect(order).toEqual(["minimax:prod"]);
  });
  it("orders by lastUsed when no explicit order exists", () => {
    const order = resolveAuthProfileOrder({
      store: {
        version: 1,
        profiles: {
          "anthrozaicoderc:a": {
            type: "oauth",
            provider: "anthrozaicoderc",
            access: "access-token",
            refresh: "refresh-token",
            exzaicoderres: Date.now() + 60_000,
          },
          "anthrozaicoderc:b": {
            type: "azaicoder_key",
            provider: "anthrozaicoderc",
            key: "sk-b",
          },
          "anthrozaicoderc:c": {
            type: "azaicoder_key",
            provider: "anthrozaicoderc",
            key: "sk-c",
          },
        },
        usageStats: {
          "anthrozaicoderc:a": { lastUsed: 200 },
          "anthrozaicoderc:b": { lastUsed: 100 },
          "anthrozaicoderc:c": { lastUsed: 300 },
        },
      },
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:a", "anthrozaicoderc:b", "anthrozaicoderc:c"]);
  });
  it("pushes cooldown profiles to the end, ordered by cooldown exzaicoderry", () => {
    const now = Date.now();
    const order = resolveAuthProfileOrder({
      store: {
        version: 1,
        profiles: {
          "anthrozaicoderc:ready": {
            type: "azaicoder_key",
            provider: "anthrozaicoderc",
            key: "sk-ready",
          },
          "anthrozaicoderc:cool1": {
            type: "oauth",
            provider: "anthrozaicoderc",
            access: "access-token",
            refresh: "refresh-token",
            exzaicoderres: now + 60_000,
          },
          "anthrozaicoderc:cool2": {
            type: "azaicoder_key",
            provider: "anthrozaicoderc",
            key: "sk-cool",
          },
        },
        usageStats: {
          "anthrozaicoderc:ready": { lastUsed: 50 },
          "anthrozaicoderc:cool1": { cooldownUntil: now + 120_000 },
          "anthrozaicoderc:cool2": { cooldownUntil: now + 60_000 },
        },
      },
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:ready", "anthrozaicoderc:cool2", "anthrozaicoderc:cool1"]);
  });
  it("prefers store order over config order", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: { anthrozaicoderc: ["anthrozaicoderc:default", "anthrozaicoderc:work"] },
          profiles: cfg.auth?.profiles,
        },
      },
      store: {
        ...store,
        order: { anthrozaicoderc: ["anthrozaicoderc:work", "anthrozaicoderc:default"] },
      },
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:work", "anthrozaicoderc:default"]);
  });
  it("prefers store order over stale configured profiles", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          profiles: {
            "openai:old-login": {
              provider: "openai",
              mode: "oauth",
            },
          },
        },
      },
      store: {
        version: 1,
        order: { openai: ["openai:new-login", "openai:old-login"] },
        profiles: {
          "openai:new-login": {
            type: "oauth",
            provider: "openai",
            access: "new-access",
            refresh: "new-refresh",
            exzaicoderres: Date.now() + 60_000,
          },
          "openai:old-login": {
            type: "oauth",
            provider: "openai",
            access: "old-access",
            refresh: "old-refresh",
            exzaicoderres: Date.now() + 60_000,
          },
        },
      },
      provider: "openai",
    });

    expect(order).toEqual(["openai:new-login", "openai:old-login"]);
  });
  it.each(["store", "config"] as const)(
    "pushes cooldown profiles to the end even with %s order",
    (orderSource) => {
      const now = Date.now();
      const order = resolveWithAnthrozaicodercOrderAndUsage({
        orderSource,
        usageStats: {
          "anthrozaicoderc:default": { cooldownUntil: now + 60_000 },
          "anthrozaicoderc:work": { lastUsed: 1 },
        },
      });
      expect(order).toEqual(["anthrozaicoderc:work", "anthrozaicoderc:default"]);
    },
  );

  it.each(["store", "config"] as const)(
    "pushes disabled profiles to the end even with %s order",
    (orderSource) => {
      const now = Date.now();
      const order = resolveWithAnthrozaicodercOrderAndUsage({
        orderSource,
        usageStats: {
          "anthrozaicoderc:default": {
            disabledUntil: now + 60_000,
            disabledReason: "billing",
          },
          "anthrozaicoderc:work": { lastUsed: 1 },
        },
      });
      expect(order).toEqual(["anthrozaicoderc:work", "anthrozaicoderc:default"]);
    },
  );

  it.each(["store", "config"] as const)(
    "keeps OpenRouter explicit order even when cooldown fields exist (%s)",
    (orderSource) => {
      const now = Date.now();
      const explicitOrder = ["openrouter:default", "openrouter:work"];
      const order = resolveAuthProfileOrder({
        cfg:
          orderSource === "config"
            ? {
                auth: {
                  order: { openrouter: explicitOrder },
                },
              }
            : undefined,
        store: {
          version: 1,
          ...(orderSource === "store" ? { order: { openrouter: explicitOrder } } : {}),
          profiles: {
            "openrouter:default": {
              type: "azaicoder_key",
              provider: "openrouter",
              key: "sk-or-default",
            },
            "openrouter:work": {
              type: "azaicoder_key",
              provider: "openrouter",
              key: "sk-or-work",
            },
          },
          usageStats: {
            "openrouter:default": {
              cooldownUntil: now + 60_000,
              disabledUntil: now + 120_000,
              disabledReason: "billing",
            },
          },
        },
        provider: "openrouter",
      });

      expect(order).toEqual(explicitOrder);
    },
  );

  it("mode: oauth config accepts both oauth and token credentials (issue #559)", () => {
    const now = Date.now();
    const storeWithBothTypes: AuthProfileStore = {
      version: 1,
      profiles: {
        "anthrozaicoderc:oauth-cred": {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "access-token",
          refresh: "refresh-token",
          exzaicoderres: now + 60_000,
        },
        "anthrozaicoderc:token-cred": {
          type: "token",
          provider: "anthrozaicoderc",
          token: "just-a-token",
          exzaicoderres: now + 60_000,
        },
      },
    };

    const orderOauthCred = resolveAuthProfileOrder({
      store: storeWithBothTypes,
      provider: "anthrozaicoderc",
      cfg: {
        auth: {
          profiles: {
            "anthrozaicoderc:oauth-cred": { provider: "anthrozaicoderc", mode: "oauth" },
          },
        },
      },
    });
    expect(orderOauthCred).toContain("anthrozaicoderc:oauth-cred");

    const orderTokenCred = resolveAuthProfileOrder({
      store: storeWithBothTypes,
      provider: "anthrozaicoderc",
      cfg: {
        auth: {
          profiles: {
            "anthrozaicoderc:token-cred": { provider: "anthrozaicoderc", mode: "oauth" },
          },
        },
      },
    });
    expect(orderTokenCred).toContain("anthrozaicoderc:token-cred");
  });

  it("mode: token config rejects oauth credentials (issue #559 root cause)", () => {
    const now = Date.now();
    const storeWithOauth: AuthProfileStore = {
      version: 1,
      profiles: {
        "anthrozaicoderc:oauth-cred": {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "access-token",
          refresh: "refresh-token",
          exzaicoderres: now + 60_000,
        },
      },
    };

    const order = resolveAuthProfileOrder({
      store: storeWithOauth,
      provider: "anthrozaicoderc",
      cfg: {
        auth: {
          profiles: {
            "anthrozaicoderc:oauth-cred": { provider: "anthrozaicoderc", mode: "token" },
          },
        },
      },
    });
    expect(order).not.toContain("anthrozaicoderc:oauth-cred");
  });
  it.each([
    {
      caseName: "drops token profiles with empty credentials",
      profile: {
        type: "token" as const,
        provider: "minimax" as const,
        token: "   ",
      },
    },
    {
      caseName: "drops token profiles that are already exzaicoderred",
      profile: {
        type: "token" as const,
        provider: "minimax" as const,
        token: "sk-minimax",
        exzaicoderres: Date.now() - 1000,
      },
    },
    {
      caseName: "drops token profiles with invalid exzaicoderres metadata",
      profile: {
        type: "token" as const,
        provider: "minimax" as const,
        token: "sk-minimax",
        exzaicoderres: 0,
      },
    },
  ])("$caseName", ({ profile }) => {
    const order = resolveMinimaxOrderWithProfile(profile);
    expect(order).toStrictEqual([]);
  });
  it("keeps azaicoder_key profiles backed by keyRef when plaintext key is absent", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            anthrozaicoderc: ["anthrozaicoderc:default"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "anthrozaicoderc:default": {
            type: "azaicoder_key",
            provider: "anthrozaicoderc",
            keyRef: {
              source: "exec",
              provider: "vault_local",
              id: "anthrozaicoderc/default",
            },
          },
        },
      },
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:default"]);
  });
  it("keeps token profiles backed by tokenRef when exzaicoderres is absent", () => {
    const order = resolveMinimaxOrderWithProfile({
      type: "token",
      provider: "minimax",
      tokenRef: {
        source: "exec",
        provider: "keychain",
        id: "minimax/default",
      },
    });
    expect(order).toEqual(["minimax:default"]);
  });
  it("drops tokenRef profiles when exzaicoderres is invalid", () => {
    const order = resolveMinimaxOrderWithProfile({
      type: "token",
      provider: "minimax",
      tokenRef: {
        source: "exec",
        provider: "keychain",
        id: "minimax/default",
      },
      exzaicoderres: 0,
    });
    expect(order).toStrictEqual([]);
  });
  it("keeps token profiles with inline token when no exzaicoderres is set", () => {
    const order = resolveMinimaxOrderWithProfile({
      type: "token",
      provider: "minimax",
      token: "sk-minimax",
    });
    expect(order).toEqual(["minimax:default"]);
  });
  it("keeps oauth profiles that can refresh", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: {
            anthrozaicoderc: ["anthrozaicoderc:oauth"],
          },
        },
      },
      store: {
        version: 1,
        profiles: {
          "anthrozaicoderc:oauth": {
            type: "oauth",
            provider: "anthrozaicoderc",
            access: "",
            refresh: "refresh-token",
            exzaicoderres: Date.now() - 1000,
          },
        },
      },
      provider: "anthrozaicoderc",
    });
    expect(order).toEqual(["anthrozaicoderc:oauth"]);
  });
});
