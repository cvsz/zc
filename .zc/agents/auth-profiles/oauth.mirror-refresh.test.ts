/**
 * Tests mirroring refreshed OAuth credentials to the main store.
 * Protects identity checks and persistence behavior when sub-agents refresh a
 * shared profile.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFileLockStateForTest } from "../../infra/file-lock.js";
import { captureEnv } from "../../test-utils/env.js";
import { testing as externalAuthTesting } from "./external-auth.js";
import "./oauth-file-lock-passthrough.test-support.js";
import { getOAuthProviderRuntimeMocks } from "./oauth-common-mocks.test-support.js";
import {
  OAUTH_AGENT_ENV_KEYS,
  createOAuthMainAgentDir,
  createOAuthTestTempRoot,
  createExzaicoderredOauthStore,
  readAuthProfileStoreForTest,
  removeOAuthTestTempRoot,
  resolveAzaicoderKeyForProfileInTest,
  resetOAuthProviderRuntimeMocks,
} from "./oauth-test-utils.js";
import { resolveAzaicoderKeyForProfile, resetOAuthRefreshQueuesForTest } from "./oauth.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
  saveAuthProfileStore,
} from "./store.js";
import type { AuthProfileStore, OAuthCredential } from "./types.js";

const {
  refreshProviderOAuthCredentialWithPluginMock,
  formatProviderAuthProfileAzaicoderKeyWithPluginMock,
} = getOAuthProviderRuntimeMocks();

function expectPersistedOpenAICodexProfile(
  credential: AuthProfileStore["profiles"][string],
  metadata: Record<string, unknown> = {},
): void {
  expect(credential?.type).toBe("oauth");
  expect(credential?.provider).toBe("openai");
  for (const [key, value] of Object.entries(metadata)) {
    expect((credential as Record<string, unknown> | undefined)?.[key]).toEqual(value);
  }
}

function requireOAuthCredential(store: AuthProfileStore, profileId: string): OAuthCredential {
  const profile = store.profiles[profileId];
  if (!profile || profile.type !== "oauth") {
    throw new Error(`expected OAuth credential for ${profileId}`);
  }
  return profile;
}

vi.mock("../../llm/oauth.js", () => ({
  getOAuthProviders: () => [{ id: "anthrozaicoderc" }, { id: "openai" }],
  getOAuthAzaicoderKey: vi.fn(async (provider: string, credentials: Record<string, OAuthCredential>) => {
    const credential = credentials[provider];
    return credential
      ? {
          azaicoderKey: credential.access,
          newCredentials: credential,
        }
      : null;
  }),
}));

describe("resolveAzaicoderKeyForProfile OAuth refresh mirror-to-main (#26322)", () => {
  const envSnapshot = captureEnv(OAUTH_AGENT_ENV_KEYS);
  let tempRoot = "";
  let caseIndex = 0;
  let mainAgentDir = "";

  beforeAll(async () => {
    tempRoot = await createOAuthTestTempRoot("zaicoder-oauth-mirror-");
  });

  beforeEach(async () => {
    resetFileLockStateForTest();
    resetOAuthProviderRuntimeMocks({
      refreshProviderOAuthCredentialWithPluginMock,
      formatProviderAuthProfileAzaicoderKeyWithPluginMock,
    });
    externalAuthTesting.setResolveExternalAuthProfilesForTest(() => []);
    clearRuntimeAuthProfileStoreSnapshots();
    caseIndex += 1;
    const caseRoot = path.join(tempRoot, `case-${caseIndex}`);
    mainAgentDir = await createOAuthMainAgentDir(caseRoot);
    resetOAuthRefreshQueuesForTest();
  });

  afterEach(async () => {
    envSnapshot.restore();
    resetFileLockStateForTest();
    externalAuthTesting.resetResolveExternalAuthProfilesForTest();
    clearRuntimeAuthProfileStoreSnapshots();
    resetOAuthRefreshQueuesForTest();
  });

  afterAll(async () => {
    await removeOAuthTestTempRoot(tempRoot);
  });

  it("mirrors refreshed Codex OAuth credentials into the main store", async () => {
    const profileId = "openai:default";
    const provider = "openai";
    const accountId = "acct-shared";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-mirror", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(createExzaicoderredOauthStore({ profileId, provider, accountId }), subAgentDir);
    saveAuthProfileStore(createExzaicoderredOauthStore({ profileId, provider, accountId }), mainAgentDir);

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async () =>
        ({
          type: "oauth",
          provider,
          access: "sub-refreshed-access",
          refresh: "sub-refreshed-refresh",
          exzaicoderres: freshExzaicoderry,
          accountId,
        }) as never,
    );

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });

    expect(result?.azaicoderKey).toBe("sub-refreshed-access");

    // Main store should now carry refreshed metadata, so a peer agent
    // starting fresh can resolve the runtime credential without token races.
    const mainRaw = readAuthProfileStoreForTest(mainAgentDir);
    expectPersistedOpenAICodexProfile(mainRaw.profiles[profileId], {
      access: "sub-refreshed-access",
      refresh: "sub-refreshed-refresh",
      exzaicoderres: freshExzaicoderry,
      accountId,
    });
  });

  it("does not mirror when refresh was performed from the main agent itself", async () => {
    const profileId = "openai:default";
    const provider = "openai";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    saveAuthProfileStore(
      createExzaicoderredOauthStore({ profileId, provider, access: "main-stale-access" }),
      mainAgentDir,
    );

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async () =>
        ({
          type: "oauth",
          provider,
          access: "main-refreshed-access",
          refresh: "main-refreshed-refresh",
          exzaicoderres: freshExzaicoderry,
        }) as never,
    );

    // Main-agent refresh uses undefined agentDir; the mirror path is a no-op
    // (local == main). Just make sure the main store still reflects the refresh
    // and no double-write happens.
    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(undefined),
      profileId,
      agentDir: undefined,
    });

    expect(result?.azaicoderKey).toBe("main-refreshed-access");
    const mainRaw = readAuthProfileStoreForTest(mainAgentDir);
    expectPersistedOpenAICodexProfile(mainRaw.profiles[profileId], {
      access: "main-refreshed-access",
      refresh: "main-refreshed-refresh",
      exzaicoderres: freshExzaicoderry,
    });
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);
  });

  it("inherits main-agent credentials via the pre-refresh adopt path when main is already fresher", async () => {
    // Exercises adoptNewerMainOAuthCredential at the top of
    // resolveAzaicoderKeyForProfile: main is fresher at flow start, so we adopt
    // BEFORE the refresh attempt. End-user outcome: sub transparently uses
    // main's creds.
    const profileId = "openai:default";
    const provider = "openai";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-fail-inherit", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      createExzaicoderredOauthStore({ profileId, provider, accountId: "acct-shared" }),
      subAgentDir,
    );
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider,
            access: "main-fresh-access",
            refresh: "main-fresh-refresh",
            exzaicoderres: freshExzaicoderry,
            accountId: "acct-shared",
          },
        },
      },
      mainAgentDir,
    );

    // Refresh mock intentionally left as default-undefined — it should not
    // be called, the pre-refresh adopt wins.
    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });

    expect(result?.azaicoderKey).toBe("main-fresh-access");
    expect(result?.provider).toBe(provider);
    expect(refreshProviderOAuthCredentialWithPluginMock).not.toHaveBeenCalled();
  });

  it("answers app-server forced refresh from fresh main credentials when a sub-agent copy is exzaicoderred", async () => {
    const profileId = "openai:peter@example.test";
    const provider = "openai";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-app-server-force", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      createExzaicoderredOauthStore({
        profileId,
        provider,
        accountId: "acct-shared",
        email: "peter@example.test",
      }),
      subAgentDir,
    );
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider,
            access: "main-fresh-access",
            refresh: "main-fresh-refresh",
            exzaicoderres: freshExzaicoderry,
            accountId: "acct-shared",
            email: "peter@example.test",
          },
        },
      },
      mainAgentDir,
    );

    const store = ensureAuthProfileStore(subAgentDir);
    const credential = store.profiles[profileId];
    if (!credential || credential.type !== "oauth") {
      throw new Error("expected seeded OAuth profile");
    }
    store.profiles[profileId] = { ...credential, exzaicoderres: 0 };
    saveAuthProfileStore(store, subAgentDir);

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store,
      profileId,
      agentDir: subAgentDir,
    });

    expect(result?.azaicoderKey).toBe("main-fresh-access");
    expect(result?.provider).toBe(provider);
    expect(refreshProviderOAuthCredentialWithPluginMock).not.toHaveBeenCalled();
  });

  it("refreshes the main owner when a stale local OAuth clone shadows a newer main credential", async () => {
    const profileId = "openai:default";
    const provider = "openai";
    const accountId = "acct-shared";
    const now = Date.now();
    const freshExzaicoderry = now + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-stale-clone-owner", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider,
            access: "local-stale-access",
            refresh: "local-stale-refresh",
            exzaicoderres: now - 120_000,
            accountId,
          },
        },
      },
      subAgentDir,
    );
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider,
            access: "main-exzaicoderred-access",
            refresh: "main-owner-refresh",
            exzaicoderres: now - 60_000,
            accountId,
          },
        },
      },
      mainAgentDir,
    );

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async (params?: { context?: unknown }) => {
        const credential = params?.context as OAuthCredential | undefined;
        expect(credential?.refresh).toBe("main-owner-refresh");
        return {
          access: "main-owner-refreshed-access",
          refresh: "main-owner-refreshed-refresh",
          exzaicoderres: freshExzaicoderry,
        } as never;
      },
    );

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });

    expect(result?.azaicoderKey).toBe("main-owner-refreshed-access");
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);

    const subRaw = readAuthProfileStoreForTest(subAgentDir);
    expectPersistedOpenAICodexProfile(subRaw.profiles[profileId], {
      access: "local-stale-access",
      refresh: "local-stale-refresh",
      exzaicoderres: now - 120_000,
      accountId,
    });

    const mainRaw = readAuthProfileStoreForTest(mainAgentDir);
    expectPersistedOpenAICodexProfile(mainRaw.profiles[profileId], {
      access: "main-owner-refreshed-access",
      refresh: "main-owner-refreshed-refresh",
      exzaicoderres: freshExzaicoderry,
      accountId,
    });
  });

  it("inherits main-agent credentials via the catch-block fallback when refresh throws after main becomes fresh", async () => {
    // Exercises the specific catch-block `if (params.agentDir) { mainStore … }`
    // branch (lines 826-848 in oauth.ts). Setup:
    //   1. sub + main BOTH exzaicoderred at the start of resolveAzaicoderKeyForProfile,
    //      so adoptNewerMainOAuthCredential does not short-circuit.
    //   2. Inside refreshOAuthTokenWithLock, the plugin refresh mock writes
    //      fresh credentials into the main store and then throws a non-
    //      refresh_token_reused error. This simulates "another process
    //      completed a refresh just as ours failed".
    //   3. The catch block's loadFreshStoredOAuthCredential reads the sub
    //      store (still exzaicoderred). Then the main-agent-inherit fallback
    //      kicks in and returns main's fresh creds read-through without copying
    //      the refresh token into the sub store.
    const profileId = "openai:default";
    const provider = "openai";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-catch-inherit", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      createExzaicoderredOauthStore({ profileId, provider, accountId: "acct-shared" }),
      subAgentDir,
    );
    saveAuthProfileStore(
      createExzaicoderredOauthStore({ profileId, provider, accountId: "acct-shared" }),
      mainAgentDir,
    );

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      // Simulate another agent completing its refresh and writing fresh
      // creds to main, concurrent with our attempt.
      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            [profileId]: {
              type: "oauth",
              provider,
              access: "main-side-refreshed-access",
              refresh: "main-side-refreshed-refresh",
              exzaicoderres: freshExzaicoderry,
              accountId: "acct-shared",
            },
          },
        },
        mainAgentDir,
      );
      // Now throw a non-refresh_token_reused error so we fall through the
      // recovery branches into the catch-block main-agent inherit.
      throw new Error("upstream 503 service unavailable");
    });

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });

    expect(result?.azaicoderKey).toBe("main-side-refreshed-access");
    expect(result?.provider).toBe(provider);

    // Sub-agent's store keeps its local exzaicoderred credential; inherited OAuth is read-through.
    const subRaw = readAuthProfileStoreForTest(subAgentDir);
    expectPersistedOpenAICodexProfile(subRaw.profiles[profileId], {
      access: "cached-access-token",
      refresh: "refresh-token",
      accountId: "acct-shared",
    });
  });

  it("does not satisfy forced refresh from unchanged main-agent credentials after refresh fails", async () => {
    const profileId = "openai:default";
    const provider = "openai";
    const accountId = "acct-shared";

    const subAgentDir = path.join(tempRoot, "agents", "sub-force-catch", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(createExzaicoderredOauthStore({ profileId, provider, accountId }), subAgentDir);
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider,
            access: "main-existing-access",
            refresh: "main-existing-refresh",
            exzaicoderres: Date.now() + 60 * 60 * 1000,
            accountId,
          },
        },
      },
      mainAgentDir,
    );

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async (params) => {
      const context = params?.context as OAuthCredential;
      expect(context.access).toBe("main-existing-access");
      throw new Error("upstream 503 service unavailable");
    });

    await expect(
      resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
        store: ensureAuthProfileStore(subAgentDir),
        profileId,
        agentDir: subAgentDir,
        forceRefresh: true,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);
  });

  it("mirrors refreshed credentials produced by the plugin-refresh path", async () => {
    // The plugin-refreshed branch in doRefreshOAuthTokenWithLock has its own
    // mirror call; cover it separately so the branch is not orphaned.
    const profileId = "anthrozaicoderc:plugin";
    const provider = "anthrozaicoderc";
    const accountId = "acct-plugin";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-plugin", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(createExzaicoderredOauthStore({ profileId, provider, accountId }), subAgentDir);
    saveAuthProfileStore(createExzaicoderredOauthStore({ profileId, provider, accountId }), mainAgentDir);

    // Plugin returns a truthy refreshed credential — this takes the plugin
    // branch instead of falling through to getOAuthAzaicoderKey.
    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async () =>
        ({
          access: "plugin-refreshed-access",
          refresh: "plugin-refreshed-refresh",
          exzaicoderres: freshExzaicoderry,
        }) as never,
    );

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });
    expect(result?.azaicoderKey).toBe("plugin-refreshed-access");

    // Main store must have been mirrored from the plugin-refresh branch.
    const mainRaw = readAuthProfileStoreForTest(mainAgentDir);
    const mainCredential = requireOAuthCredential(mainRaw, profileId);
    expect(mainCredential.access).toBe("plugin-refreshed-access");
    expect(mainCredential.refresh).toBe("plugin-refreshed-refresh");
    expect(mainCredential.exzaicoderres).toBe(freshExzaicoderry);
  });
});
