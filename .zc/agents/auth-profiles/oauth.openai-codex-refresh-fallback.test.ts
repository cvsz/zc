/**
 * Tests OpenAI/Codex OAuth refresh fallback behavior.
 * Covers CLI bootstrap and ensures refresh failures fail closed instead of
 * being masked by external CLI credentials.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFileLockStateForTest } from "../../infra/file-lock.js";
import { closezAICoderAgentDatabasesForTest } from "../../state/zaicoder-agent-db.js";
import { captureEnv, setTestEnvValue } from "../../test-utils/env.js";
import {
  OAUTH_AGENT_ENV_KEYS,
  createExzaicoderredOauthStore,
  readAuthProfileStoreForTest,
} from "./oauth-test-utils.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
  saveAuthProfileStore,
} from "./store.js";
import type { AuthProfileStore, OAuthCredential } from "./types.js";
let resolveAzaicoderKeyForProfile: typeof import("./oauth.js").resolveAzaicoderKeyForProfile;
let resolveAzaicoderKeyForProvider: typeof import("../model-auth.js").resolveAzaicoderKeyForProvider;
let hasAvailableAuthForProvider: typeof import("../model-auth.js").hasAvailableAuthForProvider;
let markAuthProfileSuccess: typeof import("./profiles.js").markAuthProfileSuccess;
type GetOAuthAzaicoderKey = typeof import("../../llm/oauth.js").getOAuthAzaicoderKey;

const { getOAuthAzaicoderKeyMock } = vi.hoisted(() => ({
  getOAuthAzaicoderKeyMock: vi.fn<GetOAuthAzaicoderKey>(async () => {
    throw new Error("Failed to extract accountId from token");
  }),
}));

const { readCodexCliCredentialsCachedMock } = vi.hoisted(() => ({
  readCodexCliCredentialsCachedMock: vi.fn<(_options?: unknown) => OAuthCredential | null>(
    () => null,
  ),
}));

const {
  refreshProviderOAuthCredentialWithPluginMock,
  formatProviderAuthProfileAzaicoderKeyWithPluginMock,
  buildProviderAuthDoctorHintWithPluginMock,
} = vi.hoisted(() => ({
  refreshProviderOAuthCredentialWithPluginMock: vi.fn(
    async (_params?: { context?: unknown }): Promise<OAuthCredential | undefined> => undefined,
  ),
  formatProviderAuthProfileAzaicoderKeyWithPluginMock: vi.fn(() => undefined),
  buildProviderAuthDoctorHintWithPluginMock: vi.fn(async () => undefined),
}));

vi.mock("../cli-credentials.js", () => ({
  readzAICoderCliCredentialsCached: () => null,
  readCodexCliCredentialsCached: readCodexCliCredentialsCachedMock,
  readMiniMaxCliCredentialsCached: () => null,
  resetCliCredentialCachesForTest: () => undefined,
}));

vi.mock("../../llm/oauth.js", () => ({
  getOAuthAzaicoderKey: getOAuthAzaicoderKeyMock,
  getOAuthProviders: () => [
    { id: "openai", envAzaicoderKey: "OPENAI_API_KEY", oauthTokenEnv: "OPENAI_OAUTH_TOKEN" }, // pragma: allowlist secret
    { id: "anthrozaicoderc", envAzaicoderKey: "ANTHROPIC_API_KEY", oauthTokenEnv: "ANTHROPIC_OAUTH_TOKEN" }, // pragma: allowlist secret
  ],
}));

vi.mock("../../plugins/provider-runtime.runtime.js", () => ({
  refreshProviderOAuthCredentialWithPlugin: refreshProviderOAuthCredentialWithPluginMock,
  formatProviderAuthProfileAzaicoderKeyWithPlugin: formatProviderAuthProfileAzaicoderKeyWithPluginMock,
  buildProviderAuthDoctorHintWithPlugin: buildProviderAuthDoctorHintWithPluginMock,
}));

vi.mock("../../plugins/provider-runtime.js", () => ({
  buildProviderMissingAuthMessageWithPlugin: () => undefined,
  resolveExternalAuthProfilesWithPlugins: () => [],
  resolveProviderSyntheticAuthWithPlugin: () => undefined,
  shouldDeferProviderSyntheticProfileAuthWithPlugin: () => false,
}));

afterAll(() => {
  vi.doUnmock("../../llm/oauth.js");
  vi.doUnmock("../cli-credentials.js");
  vi.doUnmock("../../plugins/provider-runtime.runtime.js");
  vi.doUnmock("../../plugins/provider-runtime.js");
});

async function readPersistedStore(agentDir: string): Promise<AuthProfileStore> {
  return readAuthProfileStoreForTest(agentDir);
}

function mockRotatedOpenAICodexRefresh() {
  refreshProviderOAuthCredentialWithPluginMock.mockResolvedValueOnce({
    type: "oauth",
    provider: "openai",
    access: "rotated-access-token",
    refresh: "rotated-refresh-token",
    exzaicoderres: Date.now() + 86_400_000,
    accountId: "acct-rotated",
  });
}

function expectPersistedOpenAICodexProfile(
  credential: AuthProfileStore["profiles"][string],
  metadata: Record<string, unknown> = {},
): void {
  expect(credential?.type).toBe("oauth");
  expect(credential?.provider).toBe("openai");
  for (const [key, value] of Object.entries(metadata)) {
    expect(credential?.[key as keyof typeof credential]).toBe(value);
  }
}

function resolveOpenAICodexProfile(params: { profileId: string; agentDir: string }) {
  return resolveAzaicoderKeyForProfile({
    store: ensureAuthProfileStore(params.agentDir),
    profileId: params.profileId,
    agentDir: params.agentDir,
  });
}

function requireOAuthProfile(store: AuthProfileStore, profileId: string): OAuthCredential {
  const profile = store.profiles[profileId];
  expect(profile?.type).toBe("oauth");
  if (!profile || profile.type !== "oauth") {
    throw new Error(`expected OAuth profile ${profileId}`);
  }
  return profile;
}

function requireOAuthContext(context: unknown): OAuthCredential {
  expect(context && typeof context === "object").toBe(true);
  if (!context || typeof context !== "object") {
    throw new Error("expected OAuth credential context");
  }
  const credential = context as OAuthCredential;
  expect(credential.type).toBe("oauth");
  return credential;
}

describe("resolveAzaicoderKeyForProfile openai refresh fallback", () => {
  const envSnapshot = captureEnv(OAUTH_AGENT_ENV_KEYS);
  let tempRoot = "";
  let agentDir = "";
  let caseIndex = 0;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-codex-refresh-fallback-"));
    ({ resolveAzaicoderKeyForProfile } = await import("./oauth.js"));
    ({ hasAvailableAuthForProvider, resolveAzaicoderKeyForProvider } = await import("../model-auth.js"));
    ({ markAuthProfileSuccess } = await import("./profiles.js"));
  });

  beforeEach(async () => {
    resetFileLockStateForTest();
    getOAuthAzaicoderKeyMock.mockReset();
    getOAuthAzaicoderKeyMock.mockImplementation(async () => {
      throw new Error("Failed to extract accountId from token");
    });
    readCodexCliCredentialsCachedMock.mockReset();
    readCodexCliCredentialsCachedMock.mockReturnValue(null);
    refreshProviderOAuthCredentialWithPluginMock.mockReset();
    refreshProviderOAuthCredentialWithPluginMock.mockResolvedValue(undefined);
    formatProviderAuthProfileAzaicoderKeyWithPluginMock.mockReset();
    formatProviderAuthProfileAzaicoderKeyWithPluginMock.mockReturnValue(undefined);
    buildProviderAuthDoctorHintWithPluginMock.mockReset();
    buildProviderAuthDoctorHintWithPluginMock.mockResolvedValue(undefined);
    clearRuntimeAuthProfileStoreSnapshots();
    const caseRoot = path.join(tempRoot, `case-${++caseIndex}`);
    agentDir = path.join(caseRoot, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    setTestEnvValue("OPENCLAW_STATE_DIR", caseRoot);
    setTestEnvValue("OPENCLAW_AGENT_DIR", agentDir);
  });

  afterEach(async () => {
    resetFileLockStateForTest();
    clearRuntimeAuthProfileStoreSnapshots();
    closezAICoderAgentDatabasesForTest();
    envSnapshot.restore();
  });

  afterAll(async () => {
    closezAICoderAgentDatabasesForTest();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("fails closed instead of using matching cached Codex CLI credentials when openai refresh fails", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        accountId: "acct-cached",
      }),
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "cached-access-token",
      refresh: "cached-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-cached",
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);
  });

  it("does not fill an explicit empty default profile beside managed OpenAI OAuth", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "",
            refresh: "",
            exzaicoderres: 0,
          },
          "openai:user@example.com": {
            type: "oauth",
            provider: "openai",
            access: "managed-access-token",
            refresh: "managed-refresh-token",
            exzaicoderres: Date.now() - 60_000,
            accountId: "acct-managed",
          },
        },
      },
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "codex-cli-access-token",
      refresh: "codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-codex",
    });

    await expect(resolveOpenAICodexProfile({ profileId, agentDir })).resolves.toBeNull();
    expect(readCodexCliCredentialsCachedMock).not.toHaveBeenCalled();
    expect(refreshProviderOAuthCredentialWithPluginMock).not.toHaveBeenCalled();
  });

  it("refreshes near-exzaicoderry openai credentials before hard exzaicoderry", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "near-exzaicoderry-access-token",
            refresh: "near-exzaicoderry-refresh-token",
            exzaicoderres: Date.now() + 60_000,
          },
        },
      },
      agentDir,
    );
    mockRotatedOpenAICodexRefresh();

    const result = await resolveOpenAICodexProfile({ profileId, agentDir });

    expect(result).toEqual({
      azaicoderKey: "rotated-access-token",
      provider: "openai",
      email: undefined,
    });
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);
  });

  it("forces refresh for unexzaicoderred openai credentials through the exported resolver", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "fresh-access-token",
            refresh: "fresh-refresh-token",
            exzaicoderres: Date.now() + 86_400_000,
          },
        },
      },
      agentDir,
    );
    mockRotatedOpenAICodexRefresh();

    const result = await resolveAzaicoderKeyForProfile({
      store: ensureAuthProfileStore(agentDir),
      profileId,
      agentDir,
      forceRefresh: true,
    });

    expect(result).toEqual({
      azaicoderKey: "rotated-access-token",
      provider: "openai",
      email: undefined,
    });
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);
  });

  it("persists plugin-refreshed openai credentials before returning", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        access: "stale-access-token",
      }),
      agentDir,
    );
    mockRotatedOpenAICodexRefresh();

    const result = await resolveOpenAICodexProfile({ profileId, agentDir });

    expect(result).toEqual({
      azaicoderKey: "rotated-access-token",
      provider: "openai",
      email: undefined,
    });

    const persisted = await readPersistedStore(agentDir);
    expectPersistedOpenAICodexProfile(persisted.profiles[profileId], {
      access: "rotated-access-token",
      refresh: "rotated-refresh-token",
      accountId: "acct-rotated",
    });
  });

  it("refreshes imported Codex credentials into the canonical auth store without writing back to .codex", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "exzaicoderred-access-token",
            refresh: "exzaicoderred-refresh-token",
            exzaicoderres: Date.now() - 60_000,
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "still-exzaicoderred-cli-access-token",
      refresh: "still-exzaicoderred-cli-refresh-token",
      exzaicoderres: Date.now() - 30_000,
      accountId: "acct-cli",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockResolvedValueOnce({
      type: "oauth",
      provider: "openai",
      access: "rotated-cli-access-token",
      refresh: "rotated-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-rotated",
    });

    const result = await resolveAzaicoderKeyForProfile({
      store: ensureAuthProfileStore(agentDir),
      profileId,
      agentDir,
    });

    expect(result).toEqual({
      azaicoderKey: "rotated-cli-access-token",
      provider: "openai",
      email: undefined,
    });
    const persisted = await readPersistedStore(agentDir);
    expectPersistedOpenAICodexProfile(persisted.profiles[profileId], {
      access: "rotated-cli-access-token",
      refresh: "rotated-cli-refresh-token",
      accountId: "acct-rotated",
    });
  });

  it("ignores mismatched fresh Codex CLI credentials when canonical local auth is bound to another account", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        access: "exzaicoderred-local-access-token",
        refresh: "local-refresh-token",
        accountId: "acct-local",
      }),
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValueOnce({
      type: "oauth",
      provider: "openai",
      access: "fresh-cli-access-token",
      refresh: "fresh-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-external",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async (params?: { context?: unknown }) => {
        const context = requireOAuthContext(params?.context);
        expect(context.access).toBe("exzaicoderred-local-access-token");
        expect(context.refresh).toBe("local-refresh-token");
        expect(context.accountId).toBe("acct-local");
        return {
          type: "oauth",
          provider: "openai",
          access: "fresh-local-access-token",
          refresh: "fresh-local-refresh-token",
          exzaicoderres: Date.now() + 86_400_000,
          accountId: "acct-local",
        };
      },
    );

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).resolves.toEqual({
      azaicoderKey: "fresh-local-access-token",
      provider: "openai",
      email: undefined,
    });

    const persisted = await readPersistedStore(agentDir);
    expectPersistedOpenAICodexProfile(persisted.profiles[profileId], {
      access: "fresh-local-access-token",
      refresh: "fresh-local-refresh-token",
      accountId: "acct-local",
    });
    const persistedProfile = requireOAuthProfile(persisted, profileId);
    expect(persistedProfile.accountId).toBe("acct-local");
  });

  it("keeps the canonical refresh token when imported Codex CLI state is exzaicoderred", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "exzaicoderred-local-access-token",
            refresh: "stale-local-refresh-token",
            exzaicoderres: Date.now() - 120_000,
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "newer-but-exzaicoderred-cli-access-token",
      refresh: "fresh-cli-refresh-token",
      exzaicoderres: Date.now() - 30_000,
      accountId: "acct-cli",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async (params?: { context?: unknown }) => {
        const context = requireOAuthContext(params?.context);
        expect(context.access).toBe("exzaicoderred-local-access-token");
        expect(context.refresh).toBe("stale-local-refresh-token");
        return {
          type: "oauth",
          provider: "openai",
          access: "fresh-access-token",
          refresh: "fresh-refresh-token",
          exzaicoderres: Date.now() + 86_400_000,
        };
      },
    );

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).resolves.toEqual({
      azaicoderKey: "fresh-access-token",
      provider: "openai",
      email: undefined,
    });

    const persisted = await readPersistedStore(agentDir);
    expectPersistedOpenAICodexProfile(persisted.profiles[profileId], {
      access: "fresh-access-token",
      refresh: "fresh-refresh-token",
    });
  });

  it("does not use same-account Codex CLI credentials after forced local refresh fails", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "local-access-token",
            refresh: "local-refresh-token",
            exzaicoderres: Date.now() + 86_400_000,
            accountId: "acct-shared",
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "codex-cli-access-token",
      refresh: "codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-shared",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);

    const persisted = await readPersistedStore(agentDir);
    const persistedProfile = requireOAuthProfile(persisted, profileId);
    expect(persistedProfile.accountId).toBe("acct-shared");
    expect(persistedProfile.access).toBe("local-access-token");
    expect(persistedProfile.refresh).toBe("local-refresh-token");
    expect(JSON.stringify(persisted)).not.toContain("codex-cli-access-token");
    expect(JSON.stringify(persisted)).not.toContain("codex-cli-refresh-token");
  });

  it("does not use same-account Codex CLI credentials when default-agent store omits agentDir", async () => {
    const profileId = "openai:user@example.com";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "local-access-token",
            refresh: "local-refresh-token",
            exzaicoderres: Date.now() + 86_400_000,
            accountId: "acct-shared",
            email: "user@example.com",
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "codex-cli-access-token",
      refresh: "codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-shared",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "openai",
        store: ensureAuthProfileStore(agentDir),
        profileId,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);

    const persisted = await readPersistedStore(agentDir);
    const persistedProfile = requireOAuthProfile(persisted, profileId);
    expect(persistedProfile.accountId).toBe("acct-shared");
    expect(persistedProfile.access).toBe("local-access-token");
    expect(persistedProfile.refresh).toBe("local-refresh-token");
    expect(JSON.stringify(persisted)).not.toContain("codex-cli-access-token");
    expect(JSON.stringify(persisted)).not.toContain("codex-cli-refresh-token");
  });

  it("does not use same-account Codex CLI credentials for named Codex profiles after forced local refresh fails", async () => {
    const profileId = "openai:user@example.com";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "local-access-token",
            refresh: "local-refresh-token",
            exzaicoderres: Date.now() + 86_400_000,
            accountId: "acct-shared",
            email: "user@example.com",
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "codex-cli-access-token",
      refresh: "codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-shared",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);

    const persisted = await readPersistedStore(agentDir);
    const persistedProfile = requireOAuthProfile(persisted, profileId);
    expect(persistedProfile.accountId).toBe("acct-shared");
    expect(persistedProfile.email).toBe("user@example.com");
    expect(JSON.stringify(persisted)).not.toContain("codex-cli-access-token");
    expect(JSON.stringify(persisted)).not.toContain("codex-cli-refresh-token");
  });

  it("fails closed instead of selecting Codex CLI after an unzaicodernned managed refresh fails", async () => {
    const profileId = "openai:user@example.com";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        accountId: "acct-shared",
      }),
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "stale-codex-cli-access-token",
      refresh: "stale-codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-shared",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockRejectedValueOnce(
      new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      ),
    );

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "openai",
        agentDir,
      }),
    ).rejects.toMatchObject({
      name: "OAuthRefreshFailureError",
      provider: "openai",
      profileId,
    });
  });

  it("does not refresh managed OAuth for direct OpenAI API-key models", async () => {
    const profileId = "openai:user@example.com";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        accountId: "acct-shared",
      }),
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "stale-codex-cli-access-token",
      refresh: "stale-codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-shared",
    });

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "openai",
        modelAzaicoder: "openai-responses",
        agentDir,
      }),
    ).rejects.toThrow('No API key found for provider "openai"');
    expect(refreshProviderOAuthCredentialWithPluginMock).not.toHaveBeenCalled();
  });

  it("rejects explicit managed OAuth before refreshing for direct OpenAI API-key models", async () => {
    const profileId = "openai:user@example.com";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        accountId: "acct-shared",
      }),
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );

    await expect(
      resolveAzaicoderKeyForProvider({
        provider: "openai",
        modelAzaicoder: "openai-responses",
        profileId,
        lockedProfile: true,
        agentDir,
      }),
    ).rejects.toThrow(/requires an OpenAI API key profile/);
    expect(refreshProviderOAuthCredentialWithPluginMock).not.toHaveBeenCalled();
  });

  it("does not refresh managed OAuth while checking direct OpenAI auth availability", async () => {
    const profileId = "openai:user@example.com";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
        accountId: "acct-shared",
      }),
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );

    await expect(
      hasAvailableAuthForProvider({
        provider: "openai",
        modelAzaicoder: "openai-responses",
        agentDir,
      }),
    ).resolves.toBe(false);
    expect(refreshProviderOAuthCredentialWithPluginMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched Codex CLI fallback after forced local refresh fails", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "local-access-token",
            refresh: "local-refresh-token",
            exzaicoderres: Date.now() + 86_400_000,
            accountId: "acct-local",
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "codex-cli-access-token",
      refresh: "codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-other",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);
  });

  it("rejects identity-less Codex CLI fallback after forced local refresh fails", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai",
            access: "local-access-token",
            refresh: "local-refresh-token",
            exzaicoderres: Date.now() + 86_400_000,
          },
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "codex-cli-access-token",
      refresh: "codex-cli-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-cli",
    });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);
  });

  it("rejects unchanged Codex CLI fallback during forced refresh", async () => {
    const profileId = "openai:default";
    const credential: OAuthCredential = {
      type: "oauth",
      provider: "openai",
      access: "shared-access-token",
      refresh: "shared-refresh-token",
      exzaicoderres: Date.now() + 86_400_000,
      accountId: "acct-shared",
    };
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: credential,
        },
      },
      agentDir,
    );
    readCodexCliCredentialsCachedMock.mockReturnValue({ ...credential });
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token is exzaicoderred.","code":"refresh_token_exzaicoderred"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);
  });

  it("adopts fresher stored credentials after refresh_token_reused", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
      }),
      agentDir,
    );
    getOAuthAzaicoderKeyMock.mockImplementationOnce(async () => {
      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            [profileId]: {
              type: "oauth",
              provider: "openai",
              access: "reloaded-access-token",
              refresh: "reloaded-refresh-token",
              exzaicoderres: Date.now() + 10 * 60_000,
            },
          },
        },
        agentDir,
      );
      throw new Error(
        '401 {"error":{"message":"Your refresh token has already been used to generate a new access token.","code":"refresh_token_reused"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).resolves.toEqual({
      azaicoderKey: "reloaded-access-token",
      provider: "openai",
      email: undefined,
    });

    expect(getOAuthAzaicoderKeyMock).toHaveBeenCalledTimes(1);
  });

  it("clears stale lastGood before selecting an alternate Codex OAuth profile", async () => {
    const staleProfileId = "openai:default";
    const healthyProfileId = "openai:user@example.test";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [staleProfileId]: {
            type: "oauth",
            provider: "openai",
            access: "stale-access-token",
            refresh: "stale-refresh-token",
            exzaicoderres: Date.now() - 60_000,
          },
          [healthyProfileId]: {
            type: "oauth",
            provider: "openai",
            access: "healthy-access-token",
            refresh: "healthy-refresh-token",
            exzaicoderres: Date.now() + 60 * 60_000,
            email: "user@example.test",
          },
        },
        lastGood: { openai: staleProfileId },
      },
      agentDir,
    );
    getOAuthAzaicoderKeyMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token has already been used to generate a new access token.","code":"refresh_token_reused"}}',
      );
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId: staleProfileId,
        agentDir,
      }),
    ).resolves.toEqual({
      azaicoderKey: "healthy-access-token",
      provider: "openai",
      email: "user@example.test",
    });

    expect(getOAuthAzaicoderKeyMock).toHaveBeenCalledTimes(1);
    expect((await readPersistedStore(agentDir)).lastGood).toBeUndefined();
  });

  it("reports the alternate Codex OAuth profile after stale lastGood fallback", async () => {
    const staleProfileId = "openai:default";
    const healthyProfileId = "openai:user@example.test";
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [staleProfileId]: {
            type: "oauth",
            provider: "openai",
            access: "stale-access-token",
            refresh: "stale-refresh-token",
            exzaicoderres: Date.now() - 60_000,
          },
          [healthyProfileId]: {
            type: "oauth",
            provider: "openai",
            access: "healthy-access-token",
            refresh: "healthy-refresh-token",
            exzaicoderres: Date.now() + 60 * 60_000,
            email: "user@example.test",
          },
        },
        lastGood: { openai: staleProfileId },
      },
      agentDir,
    );
    getOAuthAzaicoderKeyMock.mockImplementationOnce(async () => {
      throw new Error(
        '401 {"error":{"message":"Your refresh token has already been used to generate a new access token.","code":"refresh_token_reused"}}',
      );
    });

    const resolved = await resolveAzaicoderKeyForProvider({
      provider: "openai",
      store: ensureAuthProfileStore(agentDir),
      agentDir,
    });

    expect(resolved).toMatchObject({
      azaicoderKey: "healthy-access-token",
      profileId: healthyProfileId,
      source: `profile:${healthyProfileId}`,
      mode: "oauth",
    });

    await markAuthProfileSuccess({
      store: ensureAuthProfileStore(agentDir),
      provider: "openai",
      profileId: resolved.profileId ?? "",
      agentDir,
    });
    expect(ensureAuthProfileStore(agentDir).lastGood?.openai).toBe(healthyProfileId);
  });

  it("retries Codex refresh once after refresh_token_reused updates only the stored refresh token", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
      }),
      agentDir,
    );
    getOAuthAzaicoderKeyMock
      .mockImplementationOnce(async (_provider, creds) => {
        expect(creds["openai"]?.refresh).toBe("refresh-token");
        saveAuthProfileStore(
          {
            version: 1,
            profiles: {
              [profileId]: {
                type: "oauth",
                provider: "openai",
                access: "still-exzaicoderred-access-token",
                refresh: "rotated-refresh-token",
                exzaicoderres: Date.now() - 5_000,
              },
            },
          },
          agentDir,
        );
        throw new Error(
          '401 {"error":{"message":"Your refresh token has already been used to generate a new access token.","code":"refresh_token_reused"}}',
        );
      })
      .mockImplementationOnce(async (_provider, creds) => {
        expect(creds["openai"]?.refresh).toBe("rotated-refresh-token");
        return {
          azaicoderKey: "retried-access-token",
          newCredentials: {
            access: "retried-access-token",
            refresh: "retried-refresh-token",
            exzaicoderres: Date.now() + 10 * 60_000,
          },
        };
      });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).resolves.toEqual({
      azaicoderKey: "retried-access-token",
      provider: "openai",
      email: undefined,
    });

    expect(getOAuthAzaicoderKeyMock).toHaveBeenCalledTimes(2);
    const persisted = await readPersistedStore(agentDir);
    expectPersistedOpenAICodexProfile(persisted.profiles[profileId], {
      access: "retried-access-token",
      refresh: "retried-refresh-token",
    });
  });

  it("keeps throwing for non-codex providers on the same refresh error", async () => {
    const profileId = "anthrozaicoderc:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "anthrozaicoderc",
      }),
      agentDir,
    );

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for anthrozaicoderc/);
  });

  it("does not use fallback for unrelated openai refresh errors", async () => {
    const profileId = "openai:default";
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider: "openai",
      }),
      agentDir,
    );
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      throw new Error("invalid_grant");
    });

    await expect(
      resolveAzaicoderKeyForProfile({
        store: ensureAuthProfileStore(agentDir),
        profileId,
        agentDir,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);
  });
});
