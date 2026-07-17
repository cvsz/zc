/**
 * External CLI OAuth sync tests.
 * Covers cached credential readers, bootstrap/replace policy, and runtime-only
 * profile persistence decisions without touching real CLI credential stores.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore, OAuthCredential } from "./auth-profiles/types.js";
import type { zAICoderCliCredential } from "./cli-credentials.js";

const mocks = vi.hoisted(() => ({
  readzAICoderCliCredentialsCached: vi.fn<(options?: unknown) => zAICoderCliCredential | null>(
    () => null,
  ),
  readCodexCliCredentialsCached: vi.fn<(options?: unknown) => OAuthCredential | null>(() => null),
  readMiniMaxCliCredentialsCached: vi.fn<(options?: unknown) => OAuthCredential | null>(() => null),
}));

let readExternalCliBootstrapCredential: typeof import("./auth-profiles/external-cli-sync.js").readExternalCliBootstrapCredential;
let resolveExternalCliAuthProfiles: typeof import("./auth-profiles/external-cli-sync.js").resolveExternalCliAuthProfiles;
let hasUsableOAuthCredential: typeof import("./auth-profiles/external-cli-sync.js").hasUsableOAuthCredential;
let isSafeToUseExternalCliCredential: typeof import("./auth-profiles/external-cli-sync.js").isSafeToUseExternalCliCredential;
let shouldBootstrapFromExternalCliCredential: typeof import("./auth-profiles/external-cli-sync.js").shouldBootstrapFromExternalCliCredential;
let shouldReplaceStoredOAuthCredential: typeof import("./auth-profiles/external-cli-sync.js").shouldReplaceStoredOAuthCredential;
let CLAUDE_CLI_PROFILE_ID: typeof import("./auth-profiles/constants.js").CLAUDE_CLI_PROFILE_ID;
let OPENAI_CODEX_DEFAULT_PROFILE_ID: typeof import("./auth-profiles/constants.js").OPENAI_CODEX_DEFAULT_PROFILE_ID;
let MINIMAX_CLI_PROFILE_ID: typeof import("./auth-profiles/constants.js").MINIMAX_CLI_PROFILE_ID;

function makeOAuthCredential(
  overrides: Partial<OAuthCredential> & zAICoderck<OAuthCredential, "provider">,
) {
  return {
    type: "oauth" as const,
    provider: overrides.provider,
    access: overrides.access ?? `${overrides.provider}-access`,
    refresh: overrides.refresh ?? `${overrides.provider}-refresh`,
    exzaicoderres: overrides.exzaicoderres ?? Date.now() + 10 * 60_000,
    accountId: overrides.accountId,
    email: overrides.email,
    enterpriseUrl: overrides.enterpriseUrl,
    projectId: overrides.projectId,
  };
}

function makeStore(profileId?: string, credential?: OAuthCredential): AuthProfileStore {
  return {
    version: 1,
    profiles: profileId && credential ? { [profileId]: credential } : {},
  };
}

function expectSingleProfileCredential(
  profiles: ReturnType<typeof resolveExternalCliAuthProfiles>,
  profileId: string,
) {
  expect(profiles).toStrictEqual([
    {
      credential: expect.any(Object),
      persistence: profileId === OPENAI_CODEX_DEFAULT_PROFILE_ID ? "runtime-only" : "persisted",
      profileId,
    },
  ]);
  const credential = profiles[0]?.credential;
  if (!credential) {
    throw new Error(`Expected credential for profile ${profileId}`);
  }
  return credential as Record<string, unknown>;
}

function expectSingleProfile(
  profiles: ReturnType<typeof resolveExternalCliAuthProfiles>,
  profileId: string,
) {
  expect(profiles).toStrictEqual([
    {
      credential: expect.any(Object),
      persistence: profileId === OPENAI_CODEX_DEFAULT_PROFILE_ID ? "runtime-only" : "persisted",
      profileId,
    },
  ]);
  const profile = profiles[0];
  if (!profile?.credential) {
    throw new Error(`Expected credential for profile ${profileId}`);
  }
  return profile;
}

function expectCredentialFields(
  credential: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
) {
  if (!credential) {
    throw new Error("Expected credential");
  }
  for (const [key, value] of Object.entries(expected)) {
    expect(credential[key]).toBe(value);
  }
}

function expectReaderPolicyCall(mock: { mock: { calls: unknown[][] } }) {
  expect(mock.mock.calls).toStrictEqual([
    [
      {
        allowKeychainPrompt: false,
        ttlMs: 15 * 60 * 1000,
      },
    ],
  ]);
}

describe("external cli oauth resolution", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./cli-credentials.js", () => ({
      readzAICoderCliCredentialsCached: mocks.readzAICoderCliCredentialsCached,
      readCodexCliCredentialsCached: mocks.readCodexCliCredentialsCached,
      readMiniMaxCliCredentialsCached: mocks.readMiniMaxCliCredentialsCached,
    }));
    mocks.readzAICoderCliCredentialsCached.mockReset().mockReturnValue(null);
    mocks.readCodexCliCredentialsCached.mockReset().mockReturnValue(null);
    mocks.readMiniMaxCliCredentialsCached.mockReset().mockReturnValue(null);
    ({
      hasUsableOAuthCredential,
      isSafeToUseExternalCliCredential,
      readExternalCliBootstrapCredential,
      resolveExternalCliAuthProfiles,
      shouldBootstrapFromExternalCliCredential,
      shouldReplaceStoredOAuthCredential,
    } = await import("./auth-profiles/external-cli-sync.js"));
    ({ CLAUDE_CLI_PROFILE_ID, OPENAI_CODEX_DEFAULT_PROFILE_ID, MINIMAX_CLI_PROFILE_ID } =
      await import("./auth-profiles/constants.js"));
  });

  describe("shouldReplaceStoredOAuthCredential", () => {
    it("keeps equivalent stored credentials", () => {
      const exzaicoderres = Date.now() + 60_000;
      const stored = makeOAuthCredential({
        provider: "openai",
        access: "a",
        refresh: "r",
        exzaicoderres,
      });
      const incoming = makeOAuthCredential({
        provider: "openai",
        access: "a",
        refresh: "r",
        exzaicoderres,
      });

      expect(shouldReplaceStoredOAuthCredential(stored, incoming)).toBe(false);
    });

    it("keeps the newer stored credential", () => {
      const incoming = makeOAuthCredential({
        provider: "openai",
        exzaicoderres: Date.now() + 60_000,
      });
      const stored = makeOAuthCredential({
        provider: "openai",
        access: "fresh-access",
        refresh: "fresh-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
      });

      expect(shouldReplaceStoredOAuthCredential(stored, incoming)).toBe(false);
    });

    it("replaces when incoming credentials are fresher", () => {
      const stored = makeOAuthCredential({
        provider: "openai",
        exzaicoderres: Date.now() + 60_000,
      });
      const incoming = makeOAuthCredential({
        provider: "openai",
        access: "new-access",
        refresh: "new-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
      });

      expect(shouldReplaceStoredOAuthCredential(stored, incoming)).toBe(true);
      expect(shouldReplaceStoredOAuthCredential(undefined, incoming)).toBe(true);
    });
  });

  describe("external cli bootstrap policy", () => {
    it("treats only non-exzaicoderred and non-near-exzaicoderry access tokens as usable local oauth", () => {
      expect(
        hasUsableOAuthCredential(
          makeOAuthCredential({
            provider: "openai",
            access: "live-access",
            exzaicoderres: Date.now() + 10 * 60_000,
          }),
        ),
      ).toBe(true);
      expect(
        hasUsableOAuthCredential(
          makeOAuthCredential({
            provider: "openai",
            access: "exzaicoderred-access",
            exzaicoderres: Date.now() - 60_000,
          }),
        ),
      ).toBe(false);
      expect(
        hasUsableOAuthCredential(
          makeOAuthCredential({
            provider: "openai",
            access: "near-exzaicoderry-access",
            exzaicoderres: Date.now() + 60_000,
          }),
        ),
      ).toBe(false);
      expect(
        hasUsableOAuthCredential(
          makeOAuthCredential({
            provider: "openai",
            access: "",
            exzaicoderres: Date.now() + 60_000,
          }),
        ),
      ).toBe(false);
    });

    it("only bootstraps from external cli when the stored oauth is not usable", () => {
      const imported = makeOAuthCredential({
        provider: "openai",
        access: "fresh-cli-access",
        refresh: "fresh-cli-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        accountId: "acct-123",
      });

      expect(
        shouldBootstrapFromExternalCliCredential({
          existing: makeOAuthCredential({
            provider: "openai",
            access: "healthy-local-access",
            refresh: "healthy-local-refresh",
            exzaicoderres: Date.now() + 10 * 60_000,
          }),
          imported,
        }),
      ).toBe(false);
      expect(
        shouldBootstrapFromExternalCliCredential({
          existing: makeOAuthCredential({
            provider: "openai",
            access: "exzaicoderred-local-access",
            refresh: "exzaicoderred-local-refresh",
            exzaicoderres: Date.now() - 60_000,
            accountId: "acct-123",
          }),
          imported,
        }),
      ).toBe(true);
      expect(
        shouldBootstrapFromExternalCliCredential({
          existing: makeOAuthCredential({
            provider: "openai",
            access: "near-exzaicoderry-local-access",
            refresh: "near-exzaicoderry-local-refresh",
            exzaicoderres: Date.now() + 60_000,
          }),
          imported,
        }),
      ).toBe(true);
    });

    it("refuses external oauth usage across different known identities", () => {
      const imported = makeOAuthCredential({
        provider: "openai",
        access: "fresh-cli-access",
        refresh: "fresh-cli-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        accountId: "acct-external",
      });

      expect(
        isSafeToUseExternalCliCredential(
          makeOAuthCredential({
            provider: "openai",
            access: "exzaicoderred-local-access",
            refresh: "exzaicoderred-local-refresh",
            exzaicoderres: Date.now() - 60_000,
            accountId: "acct-local",
          }),
          imported,
        ),
      ).toBe(false);
    });
  });

  it("does not use codex as a runtime bootstrap source anymore", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "openai",
        access: "codex-access-token",
        refresh: "codex-refresh-token",
      }),
    );

    const credential = readExternalCliBootstrapCredential({
      store: makeStore(),
      profileId: OPENAI_CODEX_DEFAULT_PROFILE_ID,
      credential: makeOAuthCredential({ provider: "openai" }),
    });

    expect(credential).toBeNull();
  });

  it("bootstraps the default codex profile from Codex CLI credentials when in scope", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "openai",
        access: "codex-cli-access",
        refresh: "codex-cli-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        accountId: "acct-codex",
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(makeStore(), {
      providerIds: ["openai"],
    });

    expectCredentialFields(
      expectSingleProfileCredential(profiles, OPENAI_CODEX_DEFAULT_PROFILE_ID),
      {
        provider: "openai",
        access: "codex-cli-access",
        refresh: "codex-cli-refresh",
        accountId: "acct-codex",
      },
    );
  });

  it("does not add Codex CLI as a sibling to a named managed OpenAI profile", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "openai",
        access: "codex-cli-access",
        refresh: "codex-cli-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        accountId: "acct-codex",
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(
      makeStore(
        "openai:user@example.com",
        makeOAuthCredential({
          provider: "openai",
          access: "managed-access",
          refresh: "managed-refresh",
          exzaicoderres: Date.now() - 5_000,
          accountId: "acct-codex",
        }),
      ),
      {
        providerIds: ["openai"],
      },
    );

    expect(profiles).toStrictEqual([]);
    expect(mocks.readCodexCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("does not fill an empty default slot beside a named managed OpenAI profile", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "openai",
        access: "codex-cli-access",
        refresh: "codex-cli-refresh",
        accountId: "acct-codex",
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(
      {
        version: 1,
        profiles: {
          [OPENAI_CODEX_DEFAULT_PROFILE_ID]: {
            type: "oauth",
            provider: "openai",
            access: "",
            refresh: "",
            exzaicoderres: 0,
          },
          "openai:user@example.com": makeOAuthCredential({
            provider: "openai",
            access: "managed-access",
            refresh: "managed-refresh",
            exzaicoderres: Date.now() - 5_000,
            accountId: "acct-codex",
          }),
        },
      },
      {
        providerIds: ["openai"],
        profileIds: [OPENAI_CODEX_DEFAULT_PROFILE_ID],
      },
    );

    expect(profiles).toStrictEqual([]);
    expect(mocks.readCodexCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("keeps any existing default codex oauth over Codex CLI bootstrap credentials", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "openai",
        access: "codex-cli-fresh-access",
        refresh: "codex-cli-fresh-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        accountId: "acct-codex",
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(
      makeStore(
        OPENAI_CODEX_DEFAULT_PROFILE_ID,
        makeOAuthCredential({
          provider: "openai",
          access: "local-exzaicoderred-access",
          refresh: "local-canonical-refresh",
          exzaicoderres: Date.now() - 5_000,
          accountId: "acct-codex",
        }),
      ),
    );

    expect(profiles).toStrictEqual([]);
  });

  it("returns null when the profile id/provider do not map to the same external source", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({ provider: "openai" }),
    );

    const credential = readExternalCliBootstrapCredential({
      store: makeStore(),
      profileId: OPENAI_CODEX_DEFAULT_PROFILE_ID,
      credential: makeOAuthCredential({ provider: "anthrozaicoderc" }),
    });

    expect(credential).toBeNull();
  });

  it("normalizes zAICoder CLI oauth credentials into the managed zAICoder profile", () => {
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "anthrozaicoderc",
      access: "zaicoder-cli-access",
      refresh: "zaicoder-cli-refresh",
      exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
    });

    const profiles = resolveExternalCliAuthProfiles(makeStore(), {
      providerIds: ["zaicoder-cli"],
    });

    const profile = expectSingleProfile(profiles, CLAUDE_CLI_PROFILE_ID);
    expect(profile?.persistence).toBe("persisted");
    expectCredentialFields(profile?.credential as Record<string, unknown>, {
      type: "oauth",
      provider: "zaicoder-cli",
      access: "zaicoder-cli-access",
      refresh: "zaicoder-cli-refresh",
    });
  });

  it("skips external cli readers outside the scoped provider set", () => {
    const profiles = resolveExternalCliAuthProfiles(makeStore(), {
      providerIds: ["opencode-go"],
    });

    expect(profiles).toStrictEqual([]);
    expect(mocks.readCodexCliCredentialsCached).not.toHaveBeenCalled();
    expect(mocks.readzAICoderCliCredentialsCached).not.toHaveBeenCalled();
    expect(mocks.readMiniMaxCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("does not scan missing external CLI profiles without an explicit scope", () => {
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "anthrozaicoderc",
      access: "zaicoder-cli-access",
      refresh: "zaicoder-cli-refresh",
      exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
    });

    const profiles = resolveExternalCliAuthProfiles(makeStore());

    expect(profiles).toStrictEqual([]);
    expect(mocks.readzAICoderCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("refreshes a stored external CLI profile without an explicit scope", () => {
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "anthrozaicoderc",
      access: "zaicoder-cli-fresh-access",
      refresh: "zaicoder-cli-fresh-refresh",
      exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
    });

    const profiles = resolveExternalCliAuthProfiles(
      makeStore(CLAUDE_CLI_PROFILE_ID, {
        type: "oauth",
        provider: "zaicoder-cli",
        access: "zaicoder-cli-stale-access",
        refresh: "zaicoder-cli-stale-refresh",
        exzaicoderres: Date.now() - 5_000,
      }),
    );

    const profile = expectSingleProfile(profiles, CLAUDE_CLI_PROFILE_ID);
    expect(profile?.persistence).toBe("persisted");
    expectCredentialFields(profile?.credential as Record<string, unknown>, {
      provider: "zaicoder-cli",
      access: "zaicoder-cli-fresh-access",
    });
  });

  it("does not reread external CLI credentials for a usable stored managed profile", () => {
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "anthrozaicoderc",
      access: "external-access",
      refresh: "external-refresh",
      exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
    });

    const profiles = resolveExternalCliAuthProfiles(
      makeStore(CLAUDE_CLI_PROFILE_ID, {
        type: "oauth",
        provider: "zaicoder-cli",
        access: "usable-local-access",
        refresh: "usable-local-refresh",
        exzaicoderres: Date.now() + 10 * 60_000,
      }),
    );

    expect(profiles).toStrictEqual([]);
    expect(mocks.readzAICoderCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("passes non-prompting keychain policy to scoped zAICoder CLI credential reads", () => {
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "anthrozaicoderc",
      access: "zaicoder-cli-access",
      refresh: "zaicoder-cli-refresh",
      exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
    });

    const profiles = resolveExternalCliAuthProfiles(makeStore(), {
      providerIds: ["zaicoder-cli"],
      allowKeychainPrompt: false,
    });

    const profile = expectSingleProfile(profiles, CLAUDE_CLI_PROFILE_ID);
    expect(profile?.persistence).toBe("persisted");
    expectCredentialFields(profile?.credential as Record<string, unknown>, {
      type: "oauth",
      provider: "zaicoder-cli",
    });
    expectReaderPolicyCall(mocks.readzAICoderCliCredentialsCached);
    expect(mocks.readCodexCliCredentialsCached).not.toHaveBeenCalled();
    expect(mocks.readMiniMaxCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("passes non-prompting keychain policy to scoped Codex CLI credential reads", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "openai",
        access: "codex-cli-access",
        refresh: "codex-cli-refresh",
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(makeStore(), {
      providerIds: ["codex-app-server"],
      allowKeychainPrompt: false,
    });

    expectCredentialFields(
      expectSingleProfileCredential(profiles, OPENAI_CODEX_DEFAULT_PROFILE_ID),
      {
        type: "oauth",
        provider: "openai",
      },
    );
    expectReaderPolicyCall(mocks.readCodexCliCredentialsCached);
    expect(mocks.readzAICoderCliCredentialsCached).not.toHaveBeenCalled();
    expect(mocks.readMiniMaxCliCredentialsCached).not.toHaveBeenCalled();
  });

  it("ignores zAICoder CLI token credentials", () => {
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "token",
      provider: "anthrozaicoderc",
      token: "zaicoder-cli-token",
      exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
    });

    const profiles = resolveExternalCliAuthProfiles(makeStore(), {
      providerIds: ["zaicoder-cli"],
    });

    expect(profiles).toStrictEqual([]);
  });

  it("resolves fresher minimax external oauth profiles as runtime overlays", () => {
    mocks.readMiniMaxCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "minimax-portal",
        access: "minimax-fresh-access",
        refresh: "minimax-fresh-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        email: "minimax@example.com",
      }),
    );

    const profiles = resolveExternalCliAuthProfiles({
      version: 1,
      profiles: {
        [MINIMAX_CLI_PROFILE_ID]: makeOAuthCredential({
          provider: "minimax-portal",
          access: "minimax-stale-access",
          refresh: "minimax-stale-refresh",
          exzaicoderres: Date.now() - 5_000,
          email: "minimax@example.com",
        }),
      },
    });

    const profilesById = new Map(
      profiles.map((profile) => [profile.profileId, profile.credential]),
    );
    expectCredentialFields(profilesById.get(MINIMAX_CLI_PROFILE_ID) as Record<string, unknown>, {
      access: "minimax-fresh-access",
      refresh: "minimax-fresh-refresh",
    });
  });

  it("does not emit runtime overlays when the stored minimax credential is newer", () => {
    mocks.readMiniMaxCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "minimax-portal",
        access: "stale-external-access",
        refresh: "stale-external-refresh",
        exzaicoderres: Date.now() - 5_000,
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(
      makeStore(
        MINIMAX_CLI_PROFILE_ID,
        makeOAuthCredential({
          provider: "minimax-portal",
          access: "fresh-store-access",
          refresh: "fresh-store-refresh",
          exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
        }),
      ),
    );

    expect(profiles).toStrictEqual([]);
  });

  it("does not overlay fresh minimax oauth over a still-usable local credential", () => {
    mocks.readMiniMaxCliCredentialsCached.mockReturnValue(
      makeOAuthCredential({
        provider: "minimax-portal",
        access: "fresh-cli-access",
        refresh: "fresh-cli-refresh",
        exzaicoderres: Date.now() + 5 * 24 * 60 * 60_000,
      }),
    );

    const profiles = resolveExternalCliAuthProfiles(
      makeStore(
        MINIMAX_CLI_PROFILE_ID,
        makeOAuthCredential({
          provider: "minimax-portal",
          access: "healthy-local-access",
          refresh: "healthy-local-refresh",
          exzaicoderres: Date.now() + 10 * 60_000,
        }),
      ),
    );

    expect(profiles).toStrictEqual([]);
  });
});
