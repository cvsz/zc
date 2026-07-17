/**
 * Tests OAuth adoption identity safety.
 * Ensures sub-agent/main-agent credential adoption only happens when identity
 * evidence allows the copy.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFileLockStateForTest } from "../../infra/file-lock.js";
import { captureEnv } from "../../test-utils/env.js";
import { getOAuthProviderRuntimeMocks } from "./oauth-common-mocks.test-support.js";
import "./oauth-external-auth-passthrough.test-support.js";
import "./oauth-file-lock-passthrough.test-support.js";
import {
  OAUTH_AGENT_ENV_KEYS,
  createOAuthMainAgentDir,
  createOAuthTestTempRoot,
  oauthCred,
  readAuthProfileStoreForTest,
  removeOAuthTestTempRoot,
  resolveAzaicoderKeyForProfileInTest,
  resetOAuthProviderRuntimeMocks,
  storeWith,
} from "./oauth-test-utils.js";
import { resolveAzaicoderKeyForProfile, resetOAuthRefreshQueuesForTest } from "./oauth.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
  saveAuthProfileStore,
} from "./store.js";
import type { AuthProfileStore } from "./types.js";

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

// Cross-account-leak defense-in-depth: each adopt site in oauth.ts calls the
// shared identity copy gate before copying main-store credentials into the
// sub-agent store. Unit tests cover policy variants; this suite proves each
// production branch refuses a mismatched accountId.

vi.mock("../../llm/oauth.js", () => ({
  getOAuthAzaicoderKey: vi.fn(async () => null),
  getOAuthProviders: () => [{ id: "openai" }, { id: "anthrozaicoderc" }],
}));

describe("OAuth credential adoption is identity-gated", () => {
  const envSnapshot = captureEnv(OAUTH_AGENT_ENV_KEYS);
  let tempRoot = "";
  let caseIndex = 0;
  let mainAgentDir = "";

  beforeAll(async () => {
    tempRoot = await createOAuthTestTempRoot("zaicoder-oauth-adopt-identity-");
  });

  beforeEach(async () => {
    resetFileLockStateForTest();
    resetOAuthProviderRuntimeMocks({
      refreshProviderOAuthCredentialWithPluginMock,
      formatProviderAuthProfileAzaicoderKeyWithPluginMock,
    });
    clearRuntimeAuthProfileStoreSnapshots();
    caseIndex += 1;
    const caseRoot = path.join(tempRoot, `case-${caseIndex}`);
    mainAgentDir = await createOAuthMainAgentDir(caseRoot);
    resetOAuthRefreshQueuesForTest();
  });

  afterEach(async () => {
    envSnapshot.restore();
    resetFileLockStateForTest();
    clearRuntimeAuthProfileStoreSnapshots();
    resetOAuthRefreshQueuesForTest();
  });

  afterAll(async () => {
    await removeOAuthTestTempRoot(tempRoot);
  });

  it("adoptNewerMainOAuthCredential refuses to adopt across accountId mismatch (pre-refresh path)", async () => {
    // Scenario: sub-agent starts with a still-valid OAuth cred (so no
    // refresh is triggered), but main holds an even fresher cred for a
    // different account. The pre-refresh adopt must refuse.
    const profileId = "openai:default";
    const provider = "openai";
    const subExzaicoderry = Date.now() + 10 * 60 * 1000;
    const mainFresher = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-prerefresh", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      storeWith(
        profileId,
        oauthCred({
          provider,
          access: "sub-own-access",
          refresh: "sub-own-refresh",
          exzaicoderres: subExzaicoderry,
          accountId: "acct-sub",
        }),
      ),
      subAgentDir,
    );
    saveAuthProfileStore(
      storeWith(
        profileId,
        oauthCred({
          provider,
          access: "main-foreign-access",
          refresh: "main-foreign-refresh",
          exzaicoderres: mainFresher,
          accountId: "acct-other",
        }),
      ),
      mainAgentDir,
    );

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });

    // Sub-agent must keep using its own access token, not main's foreign one.
    expect(result?.azaicoderKey).toBe("sub-own-access");

    // Sub-agent store must NOT have been overwritten with main's foreign cred.
    const subRaw = readAuthProfileStoreForTest(subAgentDir);
    expectPersistedOpenAICodexProfile(subRaw.profiles[profileId], {
      access: "sub-own-access",
      refresh: "sub-own-refresh",
      accountId: "acct-sub",
      exzaicoderres: subExzaicoderry,
    });
    expect(JSON.stringify(subRaw)).not.toContain("main-foreign-access");
  });

  it("inside-the-lock main adoption refuses across accountId mismatch and proceeds to own refresh", async () => {
    // Scenario: sub-agent's cred is exzaicoderred, enters refreshOAuthTokenWithLock.
    // Inside the lock, main holds FRESH creds for a DIFFERENT account. The
    // inside-lock adopt branch must refuse and fall through to the HTTP
    // refresh path using the sub-agent's own refresh token.
    const profileId = "openai:default";
    const provider = "openai";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-insidelock", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      storeWith(
        profileId,
        oauthCred({
          provider,
          access: "sub-stale-access",
          refresh: "sub-refresh-token",
          exzaicoderres: Date.now() - 60_000,
          accountId: "acct-sub",
        }),
      ),
      subAgentDir,
    );
    saveAuthProfileStore(
      storeWith(
        profileId,
        oauthCred({
          provider,
          access: "main-foreign-access",
          refresh: "main-foreign-refresh",
          exzaicoderres: freshExzaicoderry,
          accountId: "acct-other",
        }),
      ),
      mainAgentDir,
    );

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(
      async () =>
        ({
          type: "oauth",
          provider,
          access: "sub-refreshed-access",
          refresh: "sub-refreshed-refresh",
          exzaicoderres: freshExzaicoderry,
          accountId: "acct-sub",
        }) as never,
    );

    const result = await resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
      store: ensureAuthProfileStore(subAgentDir),
      profileId,
      agentDir: subAgentDir,
    });

    // Sub-agent performed its own refresh (mock fired once) and got its
    // own new token, not main's foreign one.
    expect(refreshProviderOAuthCredentialWithPluginMock).toHaveBeenCalledTimes(1);
    expect(result?.azaicoderKey).toBe("sub-refreshed-access");

    // Main must still hold its foreign cred, untouched (mirror would also
    // refuse because of identity mismatch).
    const mainRaw = readAuthProfileStoreForTest(mainAgentDir);
    expectPersistedOpenAICodexProfile(mainRaw.profiles[profileId], {
      access: "main-foreign-access",
      refresh: "main-foreign-refresh",
      accountId: "acct-other",
      exzaicoderres: freshExzaicoderry,
    });
  });

  it("catch-block main-inherit refuses across accountId mismatch and surfaces the original error", async () => {
    // Scenario: sub-agent refresh throws a non-refresh_token_reused error.
    // Main has fresh creds for a DIFFERENT account. The catch-block
    // main-inherit fallback must refuse to adopt and let the original
    // error propagate (wrapped).
    const profileId = "openai:default";
    const provider = "openai";
    const freshExzaicoderry = Date.now() + 60 * 60 * 1000;

    const subAgentDir = path.join(tempRoot, "agents", "sub-catch-refuse", "agent");
    await fs.mkdir(subAgentDir, { recursive: true });
    saveAuthProfileStore(
      storeWith(
        profileId,
        oauthCred({
          provider,
          access: "sub-stale",
          refresh: "sub-refresh-token",
          exzaicoderres: Date.now() - 60_000,
          accountId: "acct-sub",
        }),
      ),
      subAgentDir,
    );
    saveAuthProfileStore(
      storeWith(
        profileId,
        oauthCred({
          provider,
          access: "main-foreign-access",
          refresh: "main-foreign-refresh",
          exzaicoderres: Date.now() - 60_000,
          accountId: "acct-other",
        }),
      ),
      mainAgentDir,
    );

    refreshProviderOAuthCredentialWithPluginMock.mockImplementationOnce(async () => {
      // Simulate another process writing fresh creds to main for a
      // DIFFERENT account while our refresh is in flight, then our
      // refresh throws a generic upstream error.
      saveAuthProfileStore(
        storeWith(
          profileId,
          oauthCred({
            provider,
            access: "main-foreign-refreshed",
            refresh: "main-foreign-refresh-new",
            exzaicoderres: freshExzaicoderry,
            accountId: "acct-other",
          }),
        ),
        mainAgentDir,
      );
      throw new Error("upstream 503 service unavailable");
    });

    await expect(
      resolveAzaicoderKeyForProfileInTest(resolveAzaicoderKeyForProfile, {
        store: ensureAuthProfileStore(subAgentDir),
        profileId,
        agentDir: subAgentDir,
      }),
    ).rejects.toThrow(/OAuth token refresh failed for openai/);

    // Sub-agent store must still have its own stale cred \u2014 no leak.
    const subRaw = readAuthProfileStoreForTest(subAgentDir);
    expectPersistedOpenAICodexProfile(subRaw.profiles[profileId], {
      access: "sub-stale",
      refresh: "sub-refresh-token",
      accountId: "acct-sub",
    });
    expect(JSON.stringify(subRaw)).not.toContain("main-foreign-refreshed");
  });
});
