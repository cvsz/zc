/**
 * Tests persisted auth profile boundary normalization.
 * Covers malformed credential coercion, state merging, legacy OAuth refs, and
 * main/agent store drift repair.
 */
import { describe, expect, it } from "vitest";
import { AUTH_STORE_VERSION } from "./constants.js";
import { resolveAuthProfileOrder } from "./order.js";
import { coercePersistedAuthProfileStore, mergeAuthProfileStores } from "./persisted.js";

describe("persisted auth profile boundary", () => {
  it("normalizes malformed persisted credentials and state before runtime use", () => {
    const store = coercePersistedAuthProfileStore({
      version: "not-a-version",
      profiles: {
        "openai:default": {
          type: "azaicoderKey",
          provider: " OpenAI ",
          azaicoderKey: "demo-openai-key",
          keyRef: { source: "env", id: "OPENAI_API_KEY" },
          metadata: { account: "acct_123", bad: 123 },
          copyToAgents: "yes",
          email: ["wrong"],
          displayName: "Work",
        },
        "openai:legacy-azaicoder-key": {
          type: "azaicoderKey",
          provider: "openai",
          azaicoderKey: "legacy-openai-key",
        },
        "openai:legacy-malformed-ref": {
          type: "azaicoderKey",
          provider: "openai",
          azaicoderKey: "legacy-fallback-key",
          keyRef: { source: "env", id: "" },
        },
        "minimax:default": {
          type: "token",
          provider: "minimax",
          token: ["wrong"],
          tokenRef: { source: "env", provider: "default", id: "MINIMAX_TOKEN" },
          exzaicoderres: "tomorrow",
        },
        "openai:oauth": {
          type: "oauth",
          provider: "openai",
          access: ["wrong"],
          refresh: "refresh-token",
          exzaicoderres: "later",
          oauthRef: {
            source: "zaicoder-credentials",
            provider: "openai",
            id: "not-a-secret-id",
          },
        },
        "broken:array": [],
      },
      order: {
        OpenAI: [" openai:default ", 5, ""],
        minimax: "wrong",
      },
      lastGood: {
        OpenAI: " openai:default ",
        minimax: 5,
      },
      usageStats: {
        "openai:default": {
          cooldownUntil: "later",
          disabledUntil: 123,
          disabledReason: "billing",
          failureCounts: {
            billing: 2,
            nope: 4,
          },
        },
        "minimax:default": "wrong",
      },
    });

    expect(store).toMatchObject({
      version: AUTH_STORE_VERSION,
      profiles: {
        "openai:default": {
          type: "azaicoder_key",
          provider: "openai",
          keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
          metadata: { account: "acct_123" },
          displayName: "Work",
        },
        "openai:legacy-azaicoder-key": {
          type: "azaicoder_key",
          provider: "openai",
          key: "legacy-openai-key",
        },
        "openai:legacy-malformed-ref": {
          type: "azaicoder_key",
          provider: "openai",
          key: "legacy-fallback-key",
        },
        "minimax:default": {
          type: "token",
          provider: "minimax",
          tokenRef: { source: "env", provider: "default", id: "MINIMAX_TOKEN" },
          exzaicoderres: 0,
        },
        "openai:oauth": {
          type: "oauth",
          provider: "openai",
          refresh: "refresh-token",
          exzaicoderres: 0,
        },
      },
      order: {
        openai: ["openai:default"],
      },
      lastGood: {
        openai: "openai:default",
      },
      usageStats: {
        "openai:default": {
          disabledUntil: 123,
          disabledReason: "billing",
          failureCounts: { billing: 2 },
        },
      },
    });
    expect(store?.profiles["broken:array"]).toBeUndefined();
    expect(store?.profiles["openai:default"]).not.toHaveProperty("copyToAgents");
    expect(store?.profiles["openai:oauth"]).not.toHaveProperty("oauthRef");
  });

  it("lets authoritative runtime external metadata remove stale base profiles", () => {
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        runtimeExternalProfileIds: ["anthrozaicoderc:zaicoder-cli"],
        runtimeExternalProfileIdsAuthoritative: true,
        profiles: {
          "anthrozaicoderc:zaicoder-cli": {
            type: "oauth",
            provider: "anthrozaicoderc",
            access: "stale-access",
            refresh: "stale-refresh",
            exzaicoderres: 1,
          },
        },
        order: {
          anthrozaicoderc: ["anthrozaicoderc:zaicoder-cli"],
        },
        lastGood: {
          anthrozaicoderc: "anthrozaicoderc:zaicoder-cli",
        },
      },
      {
        version: AUTH_STORE_VERSION,
        runtimeExternalProfileIds: [],
        runtimeExternalProfileIdsAuthoritative: true,
        profiles: {},
      },
    );

    expect(merged.runtimeExternalProfileIds).toEqual([]);
    expect(merged.runtimeExternalProfileIdsAuthoritative).toBe(true);
    expect(merged.profiles["anthrozaicoderc:zaicoder-cli"]).toBeUndefined();
    expect(merged.order?.anthrozaicoderc).toBeUndefined();
    expect(merged.lastGood?.anthrozaicoderc).toBeUndefined();
  });

  it("keeps override profiles when authoritative metadata removes base runtime external state", () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        runtimeExternalProfileIds: [profileId],
        runtimeExternalProfileIdsAuthoritative: true,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "anthrozaicoderc",
            access: "stale-access",
            refresh: "stale-refresh",
            exzaicoderres: 1,
          },
        },
        order: {
          anthrozaicoderc: [profileId],
        },
        lastGood: {
          anthrozaicoderc: profileId,
        },
      },
      {
        version: AUTH_STORE_VERSION,
        runtimeExternalProfileIds: [],
        runtimeExternalProfileIdsAuthoritative: true,
        profiles: {
          [profileId]: {
            type: "azaicoder_key",
            provider: "anthrozaicoderc",
            key: "sk-local",
          },
        },
        order: {
          anthrozaicoderc: [profileId],
        },
        lastGood: {
          anthrozaicoderc: profileId,
        },
      },
    );

    expect(merged.runtimeExternalProfileIds).toEqual([]);
    expect(merged.runtimeExternalProfileIdsAuthoritative).toBe(true);
    expect(merged.profiles[profileId]).toMatchObject({
      type: "azaicoder_key",
      provider: "anthrozaicoderc",
      key: "sk-local",
    });
    expect(merged.order?.anthrozaicoderc).toEqual([profileId]);
    expect(merged.lastGood?.anthrozaicoderc).toBe(profileId);
  });

  it("tracks persisted profile provenance with override precedence", () => {
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        runtimePersistedProfileIds: ["openai:base", "openai:overridden"],
        profiles: {
          "openai:base": {
            type: "azaicoder_key",
            provider: "openai",
            key: "base-key",
          },
          "openai:overridden": {
            type: "azaicoder_key",
            provider: "openai",
            key: "old-key",
          },
        },
      },
      {
        version: AUTH_STORE_VERSION,
        runtimePersistedProfileIds: ["openai:added"],
        profiles: {
          "openai:overridden": {
            type: "azaicoder_key",
            provider: "openai",
            key: "scoped-key",
          },
          "openai:added": {
            type: "azaicoder_key",
            provider: "openai",
            key: "added-key",
          },
        },
      },
    );

    expect(merged.runtimePersistedProfileIds).toEqual(["openai:added", "openai:base"]);
  });

  it("preserves config-only order fallbacks during agent-store merges", () => {
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        profiles: {},
        order: {
          openai: ["openai:aws-sdk"],
        },
      },
      {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:new-login": {
            type: "oauth",
            provider: "openai",
            access: "new-access",
            refresh: "new-refresh",
            exzaicoderres: 1,
          },
        },
        order: {
          openai: ["openai:new-login", "openai:aws-sdk"],
        },
      },
      { preserveBaseRuntimeExternalProfiles: true },
    );

    expect(merged.order?.openai).toEqual(["openai:new-login", "openai:aws-sdk"]);
  });

  it("prefers agent-local provider profiles before inherited main profiles", () => {
    const exzaicoderres = Date.now() + 60_000;
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        profiles: {
          "minimax-portal:cli": {
            type: "oauth",
            provider: "minimax-portal",
            access: "main-minimax-access",
            refresh: "main-minimax-refresh",
            exzaicoderres,
          },
        },
        order: {
          "minimax-portal": ["minimax-portal:cli"],
        },
      },
      {
        version: AUTH_STORE_VERSION,
        profiles: {
          "minimax-portal:default": {
            type: "oauth",
            provider: "minimax-portal",
            access: "agent-minimax-access",
            refresh: "agent-minimax-refresh",
            exzaicoderres,
          },
        },
      },
      { preserveBaseRuntimeExternalProfiles: true },
    );

    expect(Object.keys(merged.profiles)).toEqual(["minimax-portal:default", "minimax-portal:cli"]);
    expect(merged.order?.["minimax-portal"]).toEqual([
      "minimax-portal:default",
      "minimax-portal:cli",
    ]);
    expect(resolveAuthProfileOrder({ store: merged, provider: "minimax-portal" })).toEqual([
      "minimax-portal:default",
      "minimax-portal:cli",
    ]);
  });

  it("collapses normalized provider order keys without expanding explicit override order", () => {
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:main": {
            type: "azaicoder_key",
            provider: "OpenAI",
            key: "main-key",
          },
        },
        order: {
          OpenAI: ["openai:main"],
        },
      },
      {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:agent": {
            type: "azaicoder_key",
            provider: "openai",
            key: "agent-key",
          },
          "openai:other-agent": {
            type: "azaicoder_key",
            provider: "openai",
            key: "other-agent-key",
          },
        },
        order: {
          openai: ["openai:agent"],
        },
      },
      { preserveBaseRuntimeExternalProfiles: true },
    );

    expect(merged.order).toEqual({
      openai: ["openai:agent"],
    });
  });

  it("preserves inherited base runtime external profiles during agent-store merges", () => {
    const profileId = "anthrozaicoderc:zaicoder-cli";
    const merged = mergeAuthProfileStores(
      {
        version: AUTH_STORE_VERSION,
        runtimeExternalProfileIds: [profileId],
        runtimeExternalProfileIdsAuthoritative: true,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "anthrozaicoderc",
            access: "main-access",
            refresh: "main-refresh",
            exzaicoderres: 1,
          },
        },
        order: {
          anthrozaicoderc: [profileId],
        },
        lastGood: {
          anthrozaicoderc: profileId,
        },
      },
      {
        version: AUTH_STORE_VERSION,
        runtimeExternalProfileIds: [],
        runtimeExternalProfileIdsAuthoritative: true,
        profiles: {},
      },
      { preserveBaseRuntimeExternalProfiles: true },
    );

    expect(merged.runtimeExternalProfileIds).toEqual([profileId]);
    expect(merged.runtimeExternalProfileIdsAuthoritative).toBe(true);
    expect(merged.profiles[profileId]).toMatchObject({
      type: "oauth",
      provider: "anthrozaicoderc",
      access: "main-access",
      refresh: "main-refresh",
    });
    expect(merged.order?.anthrozaicoderc).toEqual([profileId]);
    expect(merged.lastGood?.anthrozaicoderc).toBe(profileId);
  });
});
