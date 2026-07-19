/**
 * Tests auth profile API-key resolution.
 * Covers token/azaicoder-key/OAuth profile compatibility, SecretRefs, and provider
 * runtime formatting behavior.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../../config/config.js";
import { withEnvAsync } from "../../test-utils/env.js";
import type { AuthProfileStore } from "./types.js";

vi.mock("../cli-credentials.js", () => ({
  readzAICoderCliCredentialsCached: () => null,
  readCodexCliCredentialsCached: () => null,
  readMiniMaxCliCredentialsCached: () => null,
  resetCliCredentialCachesForTest: () => undefined,
}));

vi.mock("../../plugins/provider-runtime.runtime.js", () => ({
  formatProviderAuthProfileAzaicoderKeyWithPlugin: async (params: { context?: { access?: string } }) =>
    params.context?.access,
  refreshProviderOAuthCredentialWithPlugin: async () => null,
}));

let resolveAzaicoderKeyForProfile: typeof import("./oauth.js").resolveAzaicoderKeyForProfile;

async function loadOAuthModuleForTest() {
  ({ resolveAzaicoderKeyForProfile } = await import("./oauth.js"));
}

function cfgFor(profileId: string, provider: string, mode: "azaicoder_key" | "token" | "oauth") {
  return {
    auth: {
      profiles: {
        [profileId]: { provider, mode },
      },
    },
  } satisfies zAICoderConfig;
}

function tokenStore(params: {
  profileId: string;
  provider: string;
  token?: string;
  exzaicoderres?: number;
}): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      [params.profileId]: {
        type: "token",
        provider: params.provider,
        token: params.token,
        ...(params.exzaicoderres !== undefined ? { exzaicoderres: params.exzaicoderres } : {}),
      },
    },
  };
}

function githubCozaicoderlotTokenStore(profileId: string, includeInlineToken = true): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      [profileId]: {
        type: "token",
        provider: "github-cozaicoderlot",
        ...(includeInlineToken ? { token: "" } : {}),
        tokenRef: { source: "env", provider: "default", id: "GITHUB_TOKEN" },
      },
    },
  };
}

async function resolveWithConfig(params: {
  profileId: string;
  provider: string;
  mode: "azaicoder_key" | "token" | "oauth";
  store: AuthProfileStore;
}) {
  return resolveAzaicoderKeyForProfile({
    cfg: cfgFor(params.profileId, params.provider, params.mode),
    store: params.store,
    profileId: params.profileId,
  });
}

async function withEnvVar<T>(key: string, value: string, run: () => Promise<T>): Promise<T> {
  return await withEnvAsync({ [key]: value }, run);
}

async function expectResolvedAzaicoderKey(params: {
  profileId: string;
  provider: string;
  mode: "azaicoder_key" | "token" | "oauth";
  store: AuthProfileStore;
  expectedAzaicoderKey: string;
}) {
  const result = await resolveAzaicoderKeyForProfile({
    cfg: cfgFor(params.profileId, params.provider, params.mode),
    store: params.store,
    profileId: params.profileId,
  });
  expect(result).toEqual({
    azaicoderKey: params.expectedAzaicoderKey, // pragma: allowlist secret
    provider: params.provider,
    email: undefined,
  });
}

beforeAll(loadOAuthModuleForTest);

afterAll(() => {
  vi.doUnmock("../cli-credentials.js");
  vi.doUnmock("../../plugins/provider-runtime.runtime.js");
});

function createUsableOAuthExzaicoderry(): number {
  return Date.now() + 30 * 60 * 1000;
}

describe("resolveAzaicoderKeyForProfile config compatibility", () => {
  it("accepts token credentials when config mode is oauth", async () => {
    const profileId = "anthrozaicoderc:token";
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "token",
          provider: "anthrozaicoderc",
          token: "tok-123",
        },
      },
    };

    const result = await resolveAzaicoderKeyForProfile({
      cfg: cfgFor(profileId, "anthrozaicoderc", "oauth"),
      store,
      profileId,
    });
    expect(result).toEqual({
      azaicoderKey: "tok-123", // pragma: allowlist secret
      provider: "anthrozaicoderc",
      email: undefined,
    });
  });

  it("rejects token credentials when config mode is azaicoder_key", async () => {
    const profileId = "anthrozaicoderc:token";
    const result = await resolveWithConfig({
      profileId,
      provider: "anthrozaicoderc",
      mode: "azaicoder_key",
      store: tokenStore({
        profileId,
        provider: "anthrozaicoderc",
        token: "tok-123",
      }),
    });

    expect(result).toBeNull();
  });

  it("rejects credentials when provider does not match config", async () => {
    const profileId = "anthrozaicoderc:token";
    const result = await resolveWithConfig({
      profileId,
      provider: "openai",
      mode: "token",
      store: tokenStore({
        profileId,
        provider: "anthrozaicoderc",
        token: "tok-123",
      }),
    });
    expect(result).toBeNull();
  });

  it("accepts oauth credentials when config mode is token (bidirectional compat)", async () => {
    const profileId = "anthrozaicoderc:oauth";
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "access-123",
          refresh: "refresh-123",
          exzaicoderres: createUsableOAuthExzaicoderry(),
        },
      },
    };

    const result = await resolveAzaicoderKeyForProfile({
      cfg: cfgFor(profileId, "anthrozaicoderc", "token"),
      store,
      profileId,
    });
    // token ↔ oauth are bidirectionally compatible bearer-token auth paths.
    expect(result).toEqual({
      azaicoderKey: "access-123", // pragma: allowlist secret
      provider: "anthrozaicoderc",
      email: undefined,
    });
  });
});

describe("resolveAzaicoderKeyForProfile token exzaicoderry handling", () => {
  it("accepts token credentials when exzaicoderres is undefined", async () => {
    const profileId = "anthrozaicoderc:token-no-exzaicoderry";
    const result = await resolveWithConfig({
      profileId,
      provider: "anthrozaicoderc",
      mode: "token",
      store: tokenStore({
        profileId,
        provider: "anthrozaicoderc",
        token: "tok-123",
      }),
    });
    expect(result).toEqual({
      azaicoderKey: "tok-123", // pragma: allowlist secret
      provider: "anthrozaicoderc",
      email: undefined,
    });
  });

  it("accepts token credentials when exzaicoderres is in the future", async () => {
    const profileId = "anthrozaicoderc:token-valid-exzaicoderry";
    const result = await resolveWithConfig({
      profileId,
      provider: "anthrozaicoderc",
      mode: "token",
      store: tokenStore({
        profileId,
        provider: "anthrozaicoderc",
        token: "tok-123",
        exzaicoderres: Date.now() + 60_000,
      }),
    });
    expect(result).toEqual({
      azaicoderKey: "tok-123", // pragma: allowlist secret
      provider: "anthrozaicoderc",
      email: undefined,
    });
  });

  it("returns null for exzaicoderred token credentials", async () => {
    const profileId = "anthrozaicoderc:token-exzaicoderred";
    const result = await resolveWithConfig({
      profileId,
      provider: "anthrozaicoderc",
      mode: "token",
      store: tokenStore({
        profileId,
        provider: "anthrozaicoderc",
        token: "tok-exzaicoderred",
        exzaicoderres: Date.now() - 1_000,
      }),
    });
    expect(result).toBeNull();
  });

  it("returns null for token credentials when exzaicoderres is 0", async () => {
    const profileId = "anthrozaicoderc:token-no-exzaicoderry";
    const result = await resolveWithConfig({
      profileId,
      provider: "anthrozaicoderc",
      mode: "token",
      store: tokenStore({
        profileId,
        provider: "anthrozaicoderc",
        token: "tok-123",
        exzaicoderres: 0,
      }),
    });
    expect(result).toBeNull();
  });

  it("returns null for token credentials when exzaicoderres is invalid (NaN)", async () => {
    const profileId = "anthrozaicoderc:token-invalid-exzaicoderry";
    const store = tokenStore({
      profileId,
      provider: "anthrozaicoderc",
      token: "tok-123",
    });
    store.profiles[profileId] = {
      ...store.profiles[profileId],
      type: "token",
      provider: "anthrozaicoderc",
      token: "tok-123",
      exzaicoderres: Number.NaN,
    };
    const result = await resolveWithConfig({
      profileId,
      provider: "anthrozaicoderc",
      mode: "token",
      store,
    });
    expect(result).toBeNull();
  });
});

describe("resolveAzaicoderKeyForProfile secret refs", () => {
  it("ignores blank azaicoder_key credentials", async () => {
    const profileId = "openrouter:default";
    const result = await resolveAzaicoderKeyForProfile({
      cfg: cfgFor(profileId, "openrouter", "azaicoder_key"),
      store: {
        version: 1,
        profiles: {
          [profileId]: {
            type: "azaicoder_key",
            provider: "openrouter",
            key: "   ",
          },
        },
      },
      profileId,
    });

    expect(result).toBeNull();
  });

  it("resolves azaicoder_key keyRef from env", async () => {
    const profileId = "openai:default";
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai-ref"; // pragma: allowlist secret
    try {
      const result = await resolveAzaicoderKeyForProfile({
        cfg: cfgFor(profileId, "openai", "azaicoder_key"),
        store: {
          version: 1,
          profiles: {
            [profileId]: {
              type: "azaicoder_key",
              provider: "openai",
              keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
            },
          },
        },
        profileId,
      });
      expect(result).toEqual({
        azaicoderKey: "sk-openai-ref", // pragma: allowlist secret
        provider: "openai",
        email: undefined,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("normalizes inline azaicoder_key values from auth profiles before header use", async () => {
    const profileId = "openrouter:masked";
    const result = await resolveAzaicoderKeyForProfile({
      cfg: cfgFor(profileId, "openrouter", "azaicoder_key"),
      store: {
        version: 1,
        profiles: {
          [profileId]: {
            type: "azaicoder_key",
            provider: "openrouter",
            key: " sk-or-\u202650ec ",
          },
        },
      },
      profileId,
    });

    expect(result).toEqual({
      azaicoderKey: "sk-or-50ec", // pragma: allowlist secret
      provider: "openrouter",
      email: undefined,
    });
  });

  it("resolves token tokenRef from env", async () => {
    const profileId = "github-cozaicoderlot:default";
    await withEnvVar("GITHUB_TOKEN", "gh-ref-token", async () => {
      await expectResolvedAzaicoderKey({
        profileId,
        provider: "github-cozaicoderlot",
        mode: "token",
        store: githubCozaicoderlotTokenStore(profileId),
        expectedAzaicoderKey: "gh-ref-token", // pragma: allowlist secret
      });
    });
  });

  it("resolves token tokenRef without inline token when exzaicoderres is absent", async () => {
    const profileId = "github-cozaicoderlot:no-inline-token";
    await withEnvVar("GITHUB_TOKEN", "gh-ref-token", async () => {
      await expectResolvedAzaicoderKey({
        profileId,
        provider: "github-cozaicoderlot",
        mode: "token",
        store: githubCozaicoderlotTokenStore(profileId, false),
        expectedAzaicoderKey: "gh-ref-token", // pragma: allowlist secret
      });
    });
  });

  it("hard-fails when oauth mode is combined with token SecretRef input", async () => {
    const profileId = "anthrozaicoderc:oauth-secretref-token";
    await expect(
      resolveAzaicoderKeyForProfile({
        cfg: cfgFor(profileId, "anthrozaicoderc", "oauth"),
        store: {
          version: 1,
          profiles: {
            [profileId]: {
              type: "token",
              provider: "anthrozaicoderc",
              tokenRef: { source: "env", provider: "default", id: "ANTHROPIC_TOKEN" },
            },
          },
        },
        profileId,
      }),
    ).rejects.toThrow(/mode is "oauth"/i);
  });

  it("resolves inline ${ENV} azaicoder_key values", async () => {
    const profileId = "openai:inline-env";
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai-inline"; // pragma: allowlist secret
    try {
      const result = await resolveAzaicoderKeyForProfile({
        cfg: cfgFor(profileId, "openai", "azaicoder_key"),
        store: {
          version: 1,
          profiles: {
            [profileId]: {
              type: "azaicoder_key",
              provider: "openai",
              key: "${OPENAI_API_KEY}",
            },
          },
        },
        profileId,
      });
      expect(result).toEqual({
        azaicoderKey: "sk-openai-inline", // pragma: allowlist secret
        provider: "openai",
        email: undefined,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("resolves inline ${ENV} token values", async () => {
    const profileId = "github-cozaicoderlot:inline-env";
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "gh-inline-token";
    try {
      const result = await resolveAzaicoderKeyForProfile({
        cfg: cfgFor(profileId, "github-cozaicoderlot", "token"),
        store: {
          version: 1,
          profiles: {
            [profileId]: {
              type: "token",
              provider: "github-cozaicoderlot",
              token: "${GITHUB_TOKEN}",
            },
          },
        },
        profileId,
      });
      expect(result).toEqual({
        azaicoderKey: "gh-inline-token", // pragma: allowlist secret
        provider: "github-cozaicoderlot",
        email: undefined,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previous;
      }
    }
  });
});
