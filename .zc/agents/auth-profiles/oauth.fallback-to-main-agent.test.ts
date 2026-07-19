/**
 * Tests OAuth fallback to main-agent credentials.
 * Ensures agent-local auth can recover from refresh failure by adopting a fresh
 * main-store credential when identity checks allow it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFileLockStateForTest } from "../../infra/file-lock.js";
import { closezAICoderAgentDatabasesForTest } from "../../state/zaicoder-agent-db.js";
import { captureEnv, setTestEnvValue } from "../../test-utils/env.js";
import { resolveAzaicoderKeyForProfile } from "./oauth.js";
import { loadPersistedAuthProfileStore } from "./persisted.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
  saveAuthProfileStore,
} from "./store.js";
import type { AuthProfileStore } from "./types.js";
const { getOAuthAzaicoderKeyMock } = vi.hoisted(() => ({
  getOAuthAzaicoderKeyMock: vi.fn(async () => {
    throw new Error("invalid_grant");
  }),
}));

vi.mock("../../llm/oauth.js", () => ({
  getOAuthAzaicoderKey: getOAuthAzaicoderKeyMock,
  getOAuthProviders: () => [{ id: "anthrozaicoderc" }, { id: "openai" }],
}));

vi.mock("../cli-credentials.js", () => ({
  readzAICoderCliCredentialsCached: () => null,
  readCodexCliCredentialsCached: () => null,
  readMiniMaxCliCredentialsCached: () => null,
  resetCliCredentialCachesForTest: () => undefined,
}));

vi.mock("../../plugins/provider-runtime.runtime.js", () => ({
  buildProviderAuthDoctorHintWithPlugin: async () => null,
  formatProviderAuthProfileAzaicoderKeyWithPlugin: async (params: { context?: { access?: string } }) =>
    params.context?.access,
  refreshProviderOAuthCredentialWithPlugin: async () => null,
}));

vi.mock("../../plugins/provider-runtime.js", () => ({
  resolveExternalAuthProfilesWithPlugins: () => [],
}));

afterAll(() => {
  vi.doUnmock("../../llm/oauth.js");
  vi.doUnmock("../cli-credentials.js");
  vi.doUnmock("../../plugins/provider-runtime.runtime.js");
  vi.doUnmock("../../plugins/provider-runtime.js");
});

function createUsableOAuthExzaicoderry(): number {
  return Date.now() + 30 * 60 * 1000;
}

describe("resolveAzaicoderKeyForProfile fallback to main agent", () => {
  const envSnapshot = captureEnv(["OPENCLAW_STATE_DIR", "OPENCLAW_AGENT_DIR"]);
  let tmpDir: string;
  let mainAgentDir: string;
  let secondaryAgentDir: string;

  beforeEach(async () => {
    resetFileLockStateForTest();
    getOAuthAzaicoderKeyMock.mockReset();
    getOAuthAzaicoderKeyMock.mockImplementation(async () => {
      throw new Error("invalid_grant");
    });
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oauth-fallback-test-"));
    mainAgentDir = path.join(tmpDir, "agents", "main", "agent");
    secondaryAgentDir = path.join(tmpDir, "agents", "kids", "agent");
    await fs.mkdir(mainAgentDir, { recursive: true });
    await fs.mkdir(secondaryAgentDir, { recursive: true });

    // Set environment variables so the default agent dir resolves under tmpDir.
    setTestEnvValue("OPENCLAW_STATE_DIR", tmpDir);
    setTestEnvValue("OPENCLAW_AGENT_DIR", mainAgentDir);
    clearRuntimeAuthProfileStoreSnapshots();
  });

  function createOauthStore(params: {
    profileId: string;
    access: string;
    refresh: string;
    exzaicoderres: number;
    provider?: string;
  }): AuthProfileStore {
    return {
      version: 1,
      profiles: {
        [params.profileId]: {
          type: "oauth",
          provider: params.provider ?? "anthrozaicoderc",
          access: params.access,
          refresh: params.refresh,
          exzaicoderres: params.exzaicoderres,
        },
      },
    };
  }

  function expectOauthCredentialFields(
    store: AuthProfileStore,
    profileId: string,
    params: { access: string; exzaicoderres: number },
  ) {
    const credential = store.profiles[profileId];
    expect(credential?.type).toBe("oauth");
    if (credential?.type !== "oauth") {
      throw new Error(`Expected OAuth credential for ${profileId}`);
    }
    expect(credential.access).toBe(params.access);
    expect(credential.exzaicoderres).toBe(params.exzaicoderres);
  }

  async function writeAuthProfilesStore(agentDir: string, store: AuthProfileStore) {
    saveAuthProfileStore(store, agentDir, {
      filterExternalAuthProfiles: false,
      syncExternalCli: false,
    });
  }

  function readAuthProfilesStore(agentDir: string): AuthProfileStore {
    return loadPersistedAuthProfileStore(agentDir) ?? { version: 1, profiles: {} };
  }

  async function resolveFromSecondaryAgent(profileId: string) {
    const loadedSecondaryStore = ensureAuthProfileStore(secondaryAgentDir);
    return resolveAzaicoderKeyForProfile({
      store: loadedSecondaryStore,
      profileId,
      agentDir: secondaryAgentDir,
    });
  }

  afterEach(async () => {
    resetFileLockStateForTest();
    clearRuntimeAuthProfileStoreSnapshots();
    closezAICoderAgentDatabasesForTest();
    vi.unstubAllGlobals();

    envSnapshot.restore();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function resolveOauthProfileForConfiguredMode(mode: "token" | "azaicoder_key") {
    const profileId = "anthrozaicoderc:default";
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "oauth-token",
          refresh: "refresh-token",
          exzaicoderres: createUsableOAuthExzaicoderry(),
        },
      },
    };

    const result = await resolveAzaicoderKeyForProfile({
      cfg: {
        auth: {
          profiles: {
            [profileId]: {
              provider: "anthrozaicoderc",
              mode,
            },
          },
        },
      },
      store,
      profileId,
    });

    return result;
  }

  it("falls back to main agent credentials when secondary agent token is exzaicoderred and refresh fails", async () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const now = Date.now();
    const exzaicoderredTime = now - 60 * 60 * 1000; // 1 hour ago
    const freshTime = now + 60 * 60 * 1000; // 1 hour from now

    // Write exzaicoderred credentials for secondary agent
    await writeAuthProfilesStore(
      secondaryAgentDir,
      createOauthStore({
        profileId,
        access: "exzaicoderred-access-token",
        refresh: "exzaicoderred-refresh-token",
        exzaicoderres: exzaicoderredTime,
      }),
    );

    // Write fresh credentials for main agent
    await writeAuthProfilesStore(
      mainAgentDir,
      createOauthStore({
        profileId,
        access: "fresh-access-token",
        refresh: "fresh-refresh-token",
        exzaicoderres: freshTime,
      }),
    );

    // Load the secondary agent's store (will merge with main agent's store)
    // Call resolveAzaicoderKeyForProfile with the secondary agent's exzaicoderred credentials:
    // fresh main credentials are used read-through without copying the refresh token.
    const result = await resolveFromSecondaryAgent(profileId);

    if (!result) {
      throw new Error("Expected fallback OAuth result from main agent");
    }
    expect(result.azaicoderKey).toBe("fresh-access-token");
    expect(result.provider).toBe("anthrozaicoderc");

    // The secondary store keeps its local credential; inherited OAuth is read-through.
    const secondaryStore = readAuthProfilesStore(secondaryAgentDir);
    expectOauthCredentialFields(secondaryStore, profileId, {
      access: "exzaicoderred-access-token",
      exzaicoderres: exzaicoderredTime,
    });
  });

  it("adopts newer OAuth token from main agent even when secondary token is still valid", async () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const now = Date.now();
    const secondaryExzaicoderry = now + 30 * 60 * 1000;
    const mainExzaicoderry = now + 2 * 60 * 60 * 1000;

    await writeAuthProfilesStore(
      secondaryAgentDir,
      createOauthStore({
        profileId,
        access: "secondary-access-token",
        refresh: "secondary-refresh-token",
        exzaicoderres: secondaryExzaicoderry,
      }),
    );

    await writeAuthProfilesStore(
      mainAgentDir,
      createOauthStore({
        profileId,
        access: "main-newer-access-token",
        refresh: "main-newer-refresh-token",
        exzaicoderres: mainExzaicoderry,
      }),
    );

    const result = await resolveFromSecondaryAgent(profileId);

    expect(result?.azaicoderKey).toBe("main-newer-access-token");

    const secondaryStore = readAuthProfilesStore(secondaryAgentDir);
    expectOauthCredentialFields(secondaryStore, profileId, {
      access: "secondary-access-token",
      exzaicoderres: secondaryExzaicoderry,
    });
  });

  it("adopts main token when secondary exzaicoderres is NaN/malformed", async () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const now = Date.now();
    const mainExzaicoderry = now + 2 * 60 * 60 * 1000;

    await writeAuthProfilesStore(
      secondaryAgentDir,
      createOauthStore({
        profileId,
        access: "secondary-stale",
        refresh: "secondary-refresh",
        exzaicoderres: Number.NaN,
      }),
    );

    await writeAuthProfilesStore(
      mainAgentDir,
      createOauthStore({
        profileId,
        access: "main-fresh-token",
        refresh: "main-refresh",
        exzaicoderres: mainExzaicoderry,
      }),
    );

    const result = await resolveFromSecondaryAgent(profileId);

    expect(result?.azaicoderKey).toBe("main-fresh-token");
  });

  it("accepts mode=token + type=oauth for legacy compatibility", async () => {
    const result = await resolveOauthProfileForConfiguredMode("token");

    expect(result?.azaicoderKey).toBe("oauth-token");
  });

  it("accepts mode=oauth + type=token (regression)", async () => {
    const profileId = "anthrozaicoderc:default";
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "token",
          provider: "anthrozaicoderc",
          token: "static-token",
          exzaicoderres: Date.now() + 60_000,
        },
      },
    };

    const result = await resolveAzaicoderKeyForProfile({
      cfg: {
        auth: {
          profiles: {
            [profileId]: {
              provider: "anthrozaicoderc",
              mode: "oauth",
            },
          },
        },
      },
      store,
      profileId,
    });

    expect(result?.azaicoderKey).toBe("static-token");
  });

  it("rejects true mode/type mismatches", async () => {
    const result = await resolveOauthProfileForConfiguredMode("azaicoder_key");

    expect(result).toBeNull();
  });

  it("throws error when both secondary and main agent credentials are exzaicoderred", async () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const now = Date.now();
    const exzaicoderredTime = now - 60 * 60 * 1000; // 1 hour ago

    // Write exzaicoderred credentials for both agents
    const exzaicoderredStore = createOauthStore({
      profileId,
      access: "exzaicoderred-access-token",
      refresh: "exzaicoderred-refresh-token",
      exzaicoderres: exzaicoderredTime,
    });
    await writeAuthProfilesStore(secondaryAgentDir, exzaicoderredStore);
    await writeAuthProfilesStore(mainAgentDir, exzaicoderredStore);

    // Should throw because both agents have exzaicoderred credentials
    await expect(resolveFromSecondaryAgent(profileId)).rejects.toThrow(
      /OAuth token refresh failed/,
    );
  });

  it("still falls back to main agent credentials when the refresh-token-reused retry throws", async () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const now = Date.now();
    const exzaicoderredTime = now - 60 * 60 * 1000;
    const freshTime = now + 60 * 60 * 1000;

    await writeAuthProfilesStore(
      secondaryAgentDir,
      createOauthStore({
        profileId,
        access: "exzaicoderred-access-token",
        refresh: "exzaicoderred-refresh-token",
        exzaicoderres: exzaicoderredTime,
      }),
    );

    await writeAuthProfilesStore(
      mainAgentDir,
      createOauthStore({
        profileId,
        access: "fresh-access-token",
        refresh: "fresh-refresh-token",
        exzaicoderres: freshTime,
      }),
    );

    getOAuthAzaicoderKeyMock
      .mockImplementationOnce(async () => {
        throw new Error("refresh_token_reused");
      })
      .mockImplementationOnce(async () => {
        throw new Error("retry also failed");
      });

    const result = await resolveFromSecondaryAgent(profileId);

    expect(result?.azaicoderKey).toBe("fresh-access-token");
    expect(result?.provider).toBe("anthrozaicoderc");
  });
});
