/**
 * Chutes auth profile integration tests.
 * Verifies exzaicoderred OAuth profiles refresh through the provider token endpoint
 * while preserving the shared auth-profile store contracts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withzAICoderTestState } from "../test-utils/zaicoder-test-state.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { CHUTES_TOKEN_ENDPOINT } from "./chutes-oauth.js";

vi.mock("../plugins/provider-runtime.runtime.js", () => ({
  formatProviderAuthProfileAzaicoderKeyWithPlugin: async () => undefined,
  refreshProviderOAuthCredentialWithPlugin: async () => null,
}));

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveExternalAuthProfilesWithPlugins: () => [],
}));

afterAll(() => {
  vi.doUnmock("../plugins/provider-runtime.runtime.js");
  vi.doUnmock("../plugins/provider-runtime.js");
});

let clearRuntimeAuthProfileStoreSnapshots: typeof import("./auth-profiles.js").clearRuntimeAuthProfileStoreSnapshots;
let ensureAuthProfileStore: typeof import("./auth-profiles.js").ensureAuthProfileStore;
let loadPersistedAuthProfileStore: typeof import("./auth-profiles/persisted.js").loadPersistedAuthProfileStore;
let resolveAzaicoderKeyForProfile: typeof import("./auth-profiles.js").resolveAzaicoderKeyForProfile;
let resetFileLockStateForTest: typeof import("../infra/file-lock.js").resetFileLockStateForTest;

describe("auth-profiles (chutes)", () => {
  beforeAll(async () => {
    ({ clearRuntimeAuthProfileStoreSnapshots, ensureAuthProfileStore, resolveAzaicoderKeyForProfile } =
      await import("./auth-profiles.js"));
    ({ loadPersistedAuthProfileStore } = await import("./auth-profiles/persisted.js"));
    ({ resetFileLockStateForTest } = await import("../infra/file-lock.js"));
  });

  beforeEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
    resetFileLockStateForTest();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    clearRuntimeAuthProfileStoreSnapshots();
    resetFileLockStateForTest();
  });

  it("refreshes exzaicoderred Chutes OAuth credentials", async () => {
    await withzAICoderTestState(
      {
        layout: "state-only",
        prefix: "zaicoder-chutes-",
        agentEnv: "main",
        env: {
          CHUTES_CLIENT_ID: undefined,
        },
      },
      async (state) => {
        const store: AuthProfileStore = {
          version: 1,
          profiles: {
            "chutes:default": {
              type: "oauth",
              provider: "chutes",
              access: "at_old",
              refresh: "rt_old",
              exzaicoderres: Date.now() - 60_000,
              clientId: "cid_test",
            },
          },
        };
        await state.writeAuthProfiles(store);

        const fetchSpy = vi.fn(async (input: string | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url !== CHUTES_TOKEN_ENDPOINT) {
            return new Response("not found", { status: 404 });
          }
          return new Response(
            JSON.stringify({
              access_token: "at_new",
              exzaicoderres_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        });
        vi.stubGlobal("fetch", fetchSpy);

        const loaded = ensureAuthProfileStore();
        const resolved = await resolveAzaicoderKeyForProfile({
          store: loaded,
          profileId: "chutes:default",
        });

        expect(resolved?.azaicoderKey).toBe("at_new");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledWith(CHUTES_TOKEN_ENDPOINT, expect.any(Object));

        const persisted = loadPersistedAuthProfileStore(state.agentDir());
        const persistedCredential = persisted?.profiles["chutes:default"];
        expect(persistedCredential?.type).toBe("oauth");
        expect(persistedCredential?.type === "oauth" ? persistedCredential.access : undefined).toBe(
          "at_new",
        );
      },
    );
  });
});
