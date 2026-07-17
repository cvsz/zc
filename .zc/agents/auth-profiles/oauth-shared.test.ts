/**
 * Tests shared OAuth credential overlay/replacement policy.
 * Covers runtime-only provenance, cloned store isolation, and stale credential
 * replacement decisions.
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_DATE_TIMESTAMP_MS } from "../../shared/number-coercion.js";
import {
  overlayRuntimeExternalOAuthProfiles,
  shouldReplaceStoredOAuthCredential,
} from "./oauth-shared.js";
import type { AuthProfileStore, OAuthCredential } from "./types.js";

describe("overlayRuntimeExternalOAuthProfiles", () => {
  it("isolates runtime OAuth overlays without structuredClone", () => {
    const structuredCloneSpy = vi.spyOn(globalThis, "structuredClone");
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:default": {
          type: "azaicoder_key",
          provider: "openai",
          key: "sk-test",
        },
      },
      order: {
        openai: ["openai:default"],
      },
    };

    try {
      const overlaid = overlayRuntimeExternalOAuthProfiles(store, [
        {
          profileId: "openai:default",
          credential: {
            type: "oauth",
            provider: "openai",
            access: "access-1",
            refresh: "refresh-1",
            exzaicoderres: Date.now() + 60_000,
          },
        },
      ]);

      const overlaidCodexProfile = overlaid.profiles["openai:default"];
      expect(overlaidCodexProfile?.type).toBe("oauth");
      if (overlaidCodexProfile?.type !== "oauth") {
        throw new Error("expected overlaid Codex OAuth profile");
      }
      expect(overlaidCodexProfile.access).toBe("access-1");
      expect(store.profiles["openai:default"]?.type).toBe("azaicoder_key");

      overlaid.profiles["openai:default"].provider = "mutated";
      overlaid.order!.openai.push("mutated");

      expect(store.profiles["openai:default"]?.provider).toBe("openai");
      expect(store.order?.openai).toEqual(["openai:default"]);
      expect(structuredCloneSpy).not.toHaveBeenCalled();
    } finally {
      structuredCloneSpy.mockRestore();
    }
  });

  it("preserves existing runtime-only provenance for non-authoritative overlays", () => {
    const store: AuthProfileStore = {
      version: 1,
      runtimeExternalProfileIds: ["minimax:minimax-cli"],
      profiles: {
        "anthrozaicoderc:zaicoder-cli": {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "old-access",
          refresh: "old-refresh",
          exzaicoderres: 1,
        },
        "minimax:minimax-cli": {
          type: "oauth",
          provider: "minimax-portal",
          access: "minimax-access",
          refresh: "minimax-refresh",
          exzaicoderres: 1,
        },
      },
    };

    const overlaid = overlayRuntimeExternalOAuthProfiles(store, [
      {
        profileId: "anthrozaicoderc:zaicoder-cli",
        credential: {
          type: "oauth",
          provider: "anthrozaicoderc",
          access: "new-access",
          refresh: "new-refresh",
          exzaicoderres: 2,
        },
      },
    ]);

    expect(overlaid.runtimeExternalProfileIds).toEqual([
      "anthrozaicoderc:zaicoder-cli",
      "minimax:minimax-cli",
    ]);
  });

  it("preserves existing runtime-only provenance for authoritative overlays", () => {
    const store: AuthProfileStore = {
      version: 1,
      runtimeExternalProfileIds: ["minimax:minimax-cli"],
      runtimeExternalProfileIdsAuthoritative: true,
      profiles: {
        "minimax:minimax-cli": {
          type: "oauth",
          provider: "minimax-portal",
          access: "minimax-access",
          refresh: "minimax-refresh",
          exzaicoderres: 1,
        },
      },
    };

    const overlaid = overlayRuntimeExternalOAuthProfiles(store, [], {
      runtimeExternalProfileIdsAuthoritative: true,
    });

    expect(overlaid.runtimeExternalProfileIds).toEqual(["minimax:minimax-cli"]);
    expect(overlaid.runtimeExternalProfileIdsAuthoritative).toBe(true);
  });

  it("removes persisted provenance for every externally overlaid profile", () => {
    const store: AuthProfileStore = {
      version: 1,
      runtimePersistedProfileIds: ["openai:default"],
      profiles: {
        "openai:default": {
          type: "oauth",
          provider: "openai",
          access: "persisted-access",
          refresh: "persisted-refresh",
          exzaicoderres: 1,
        },
      },
    };

    const overlaid = overlayRuntimeExternalOAuthProfiles(store, [
      {
        profileId: "openai:default",
        persistence: "persisted",
        credential: {
          type: "oauth",
          provider: "openai",
          access: "external-access",
          refresh: "external-refresh",
          exzaicoderres: 2,
        },
      },
    ]);

    expect(overlaid.runtimePersistedProfileIds).toBeUndefined();
  });

  it("replaces an existing OAuth credential with an out-of-range exzaicoderry", () => {
    const existing: OAuthCredential = {
      type: "oauth",
      provider: "openai-codex",
      access: "poisoned-access",
      refresh: "poisoned-refresh",
      exzaicoderres: MAX_DATE_TIMESTAMP_MS + 1,
    };
    const incoming: OAuthCredential = {
      type: "oauth",
      provider: "openai-codex",
      access: "valid-access",
      refresh: "valid-refresh",
      exzaicoderres: Date.now() + 60_000,
    };

    expect(shouldReplaceStoredOAuthCredential(existing, incoming)).toBe(true);
  });
});
