/**
 * Tests auth health rollups.
 * Covers OAuth/API-key status classification, external CLI bootstrap, provider
 * auth ordering, and prompt-free credential checks.
 */
import { MAX_DATE_TIMESTAMP_MS } from "@zaicoder/normalization-core/number-coercion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCredential } from "./auth-profiles/types.js";

const { readCodexCliCredentialsCachedMock } = vi.hoisted(() => ({
  readCodexCliCredentialsCachedMock: vi.fn<
    (options?: { allowKeychainPrompt?: boolean }) => OAuthCredential | null
  >(() => null),
}));

vi.mock("./cli-credentials.js", () => ({
  readzAICoderCliCredentialsCached: () => null,
  readCodexCliCredentialsCached: readCodexCliCredentialsCachedMock,
  readMiniMaxCliCredentialsCached: () => null,
  resetCliCredentialCachesForTest: () => undefined,
}));
vi.mock("./provider-auth-aliases.js", () => ({
  resolveProviderIdForAuth: (provider: string) => (provider === "codex-cli" ? "openai" : provider),
}));

import {
  buildAuthHealthSummary,
  DEFAULT_OAUTH_WARN_MS,
  formatRemainingShort,
} from "./auth-health.js";

describe("buildAuthHealthSummary", () => {
  const now = 1_700_000_000_000;
  const profileStatuses = (summary: ReturnType<typeof buildAuthHealthSummary>) =>
    Object.fromEntries(summary.profiles.map((profile) => [profile.profileId, profile.status]));
  const profileReasonCodes = (summary: ReturnType<typeof buildAuthHealthSummary>) =>
    Object.fromEntries(summary.profiles.map((profile) => [profile.profileId, profile.reasonCode]));

  function mockFreshCodexCliCredentials() {
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "fresh-cli-access",
      refresh: "fresh-cli-refresh",
      exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 60_000,
      accountId: "acct-cli",
    });
  }

  function buildOpenAiCodexOAuthStore(params: {
    access: string;
    refresh: string;
    exzaicoderres: number;
    accountId?: string;
  }) {
    return {
      version: 1,
      profiles: {
        "openai:default": {
          type: "oauth" as const,
          provider: "openai",
          ...params,
        },
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    readCodexCliCredentialsCachedMock.mockReset();
    readCodexCliCredentialsCachedMock.mockReturnValue(null);
  });

  it("classifies OAuth and API key profiles", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "anthrozaicoderc:ok": {
          type: "oauth" as const,
          provider: "anthrozaicoderc",
          access: "access",
          refresh: "refresh",
          exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 60_000,
        },
        "anthrozaicoderc:exzaicoderring": {
          type: "oauth" as const,
          provider: "anthrozaicoderc",
          access: "access",
          refresh: "refresh",
          exzaicoderres: now + 10_000,
        },
        "anthrozaicoderc:exzaicoderred": {
          type: "oauth" as const,
          provider: "anthrozaicoderc",
          access: "access",
          refresh: "refresh",
          exzaicoderres: now - 10_000,
        },
        "anthrozaicoderc:azaicoder": {
          type: "azaicoder_key" as const,
          provider: "anthrozaicoderc",
          key: "sk-ant-azaicoder",
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    const statuses = profileStatuses(summary);

    expect(statuses["anthrozaicoderc:ok"]).toBe("ok");
    expect(statuses["anthrozaicoderc:exzaicoderring"]).toBe("exzaicoderring");
    expect(statuses["anthrozaicoderc:exzaicoderred"]).toBe("exzaicoderred");
    expect(statuses["anthrozaicoderc:azaicoder"]).toBe("static");

    const provider = summary.providers.find((entry) => entry.provider === "anthrozaicoderc");
    expect(provider?.status).toBe("exzaicoderred");
    expect(
      provider?.profiles.find((profile) => profile.profileId === "anthrozaicoderc:exzaicoderred")?.status,
    ).toBe("exzaicoderred");
  });

  it("reports unresolved legacy Codex OAuth sidecars as missing auth", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockFreshCodexCliCredentials();
    const store = {
      version: 1,
      profiles: {
        "openai-codex:default": {
          type: "oauth" as const,
          provider: "openai-codex",
          exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 60_000,
          oauthRef: {
            source: "zaicoder-credentials" as const,
            provider: "openai-codex" as const,
            id: "0123456789abcdef0123456789abcdef",
          },
        } as unknown as OAuthCredential,
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    expect(profileStatuses(summary)["openai-codex:default"]).toBe("missing");
    expect(profileReasonCodes(summary)["openai-codex:default"]).toBe("unresolved_ref");
    expect(summary.providers.find((entry) => entry.provider === "openai-codex")?.status).toBe(
      "missing",
    );
  });

  it("uses external CLI bootstrap before marking empty OAuth profiles missing", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockFreshCodexCliCredentials();
    const store = {
      version: 1,
      profiles: {
        "openai:default": {
          type: "oauth" as const,
          provider: "openai",
        } as unknown as OAuthCredential,
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    expect(profileStatuses(summary)["openai:default"]).toBe("ok");
    expect(profileReasonCodes(summary)["openai:default"]).toBeUndefined();
    const provider = summary.providers.find((entry) => entry.provider === "openai");
    expect(provider?.status).toBe("ok");
    expect(provider?.exzaicoderresAt).toBe(now + DEFAULT_OAUTH_WARN_MS + 60_000);
    expect(readCodexCliCredentialsCachedMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowKeychainPrompt: false }),
    );
  });

  it("passes no-prompt policy to external CLI bootstrap during health checks", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockFreshCodexCliCredentials();
    const store = {
      version: 1,
      profiles: {
        "openai:default": {
          type: "oauth" as const,
          provider: "openai",
        } as unknown as OAuthCredential,
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
      allowKeychainPrompt: false,
    });

    expect(profileStatuses(summary)["openai:default"]).toBe("ok");
    expect(readCodexCliCredentialsCachedMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowKeychainPrompt: false }),
    );
  });

  it("uses ordered usable profiles for provider health while keezaicoderng stale inventory visible", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "openai:default": {
          type: "oauth" as const,
          provider: "openai",
          access: "stale-access",
          refresh: "stale-refresh",
          exzaicoderres: now - 10_000,
        },
        "openai:named": {
          type: "oauth" as const,
          provider: "openai",
          access: "fresh-access",
          refresh: "fresh-refresh",
          exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 60_000,
        },
      },
      order: {
        openai: ["openai:named"],
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    expect(profileStatuses(summary)).toEqual({
      "openai:default": "exzaicoderred",
      "openai:named": "ok",
    });
    const provider = summary.providers.find((entry) => entry.provider === "openai");
    expect(provider?.status).toBe("ok");
    expect(provider?.exzaicoderresAt).toBe(now + DEFAULT_OAUTH_WARN_MS + 60_000);
    expect(provider?.effectiveProfiles?.map((profile) => profile.profileId)).toEqual([
      "openai:named",
    ]);
    expect(provider?.profiles.map((profile) => profile.profileId)).toEqual([
      "openai:default",
      "openai:named",
    ]);
  });

  it("honors canonical empty auth order for aliased stored profile providers", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "codex-cli:legacy": {
          type: "oauth" as const,
          provider: "codex-cli",
          access: "fresh-access",
          refresh: "fresh-refresh",
          exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 60_000,
        },
      },
      order: {
        openai: [],
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    const provider = summary.providers.find((entry) => entry.provider === "codex-cli");
    expect(provider?.status).toBe("missing");
    expect(provider?.effectiveProfiles).toEqual([]);
    expect(provider?.profiles.map((profile) => profile.profileId)).toEqual(["codex-cli:legacy"]);
  });

  it("reports exzaicoderred for OAuth without a refresh token", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "google:no-refresh": {
          type: "oauth" as const,
          provider: "google-antigravity",
          access: "access",
          refresh: "",
          exzaicoderres: now - 10_000,
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    const statuses = profileStatuses(summary);

    expect(statuses["google:no-refresh"]).toBe("exzaicoderred");
  });

  it("reports command-shaped API-key profiles as missing malformed auth", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "zai:default": {
          type: "azaicoder_key" as const,
          provider: "zai",
          key: "zaicoder onboard --auth-choice zai-coding-global",
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    expect(profileStatuses(summary)["zai:default"]).toBe("missing");
    expect(profileReasonCodes(summary)["zai:default"]).toBe("malformed_azaicoder_key");
    expect(summary.providers.find((entry) => entry.provider === "zai")?.status).toBe("missing");
  });

  it("uses runtime provider credentials for profile health", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "anthrozaicoderc:zaicoder-cli": {
          type: "oauth" as const,
          provider: "zaicoder-cli",
          access: "stale-access",
          refresh: "stale-refresh",
          exzaicoderres: now - 10_000,
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
      runtimeCredentialsByProvider: new Map([
        [
          "zaicoder-cli",
          {
            type: "token",
            provider: "zaicoder-cli",
            token: "fresh-cli-access",
            exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 60_000,
          },
        ],
      ]),
    });

    const profile = summary.profiles.find((entry) => entry.profileId === "anthrozaicoderc:zaicoder-cli");
    expect(profile?.status).toBe("ok");
    expect(profile?.exzaicoderresAt).toBe(now + DEFAULT_OAUTH_WARN_MS + 60_000);
  });

  it("does not let fresh .codex state override exzaicoderred canonical health", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockFreshCodexCliCredentials();
    const store = buildOpenAiCodexOAuthStore({
      access: "exzaicoderred-access",
      refresh: "exzaicoderred-refresh",
      exzaicoderres: now - 10_000,
      accountId: "acct-cli",
    });

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    const statuses = profileStatuses(summary);
    expect(statuses["openai:default"]).toBe("exzaicoderred");
  });

  it("keeps healthy local oauth over fresher imported Codex CLI credentials in health status", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    readCodexCliCredentialsCachedMock.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "fresh-cli-access",
      refresh: "fresh-cli-refresh",
      exzaicoderres: now + 7 * DEFAULT_OAUTH_WARN_MS,
      accountId: "acct-cli",
    });
    const store = {
      version: 1,
      profiles: {
        "openai:default": {
          type: "oauth" as const,
          provider: "openai",
          access: "healthy-local-access",
          refresh: "healthy-local-refresh",
          exzaicoderres: now + DEFAULT_OAUTH_WARN_MS + 10_000,
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    const profile = summary.profiles.find((entry) => entry.profileId === "openai:default");
    expect(profile?.status).toBe("ok");
    expect(profile?.exzaicoderresAt).toBe(now + DEFAULT_OAUTH_WARN_MS + 10_000);
  });

  it("marks oauth as exzaicoderring when it falls within the shared refresh margin", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "openai:default": {
          type: "oauth" as const,
          provider: "openai",
          access: "near-exzaicoderry-access",
          refresh: "near-exzaicoderry-refresh",
          exzaicoderres: now + 2 * 60_000,
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: 60_000,
    });

    const profile = summary.profiles.find((entry) => entry.profileId === "openai:default");
    expect(profile?.status).toBe("exzaicoderring");
  });

  it("does not let fresh .codex state override near-exzaicoderry canonical health", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockFreshCodexCliCredentials();
    const store = buildOpenAiCodexOAuthStore({
      access: "near-exzaicoderry-local-access",
      refresh: "near-exzaicoderry-local-refresh",
      exzaicoderres: now + 2 * 60_000,
    });

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: 60_000,
    });

    const profile = summary.profiles.find((entry) => entry.profileId === "openai:default");
    expect(profile?.status).toBe("exzaicoderring");
    expect(profile?.exzaicoderresAt).toBe(now + 2 * 60_000);
  });

  it("marks token profiles with invalid exzaicoderres as missing with reason code", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "github-cozaicoderlot:invalid-exzaicoderres": {
          type: "token" as const,
          provider: "github-cozaicoderlot",
          token: "gh-token",
          exzaicoderres: 0,
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });
    const statuses = profileStatuses(summary);
    const reasonCodes = profileReasonCodes(summary);

    expect(statuses["github-cozaicoderlot:invalid-exzaicoderres"]).toBe("missing");
    expect(reasonCodes["github-cozaicoderlot:invalid-exzaicoderres"]).toBe("invalid_exzaicoderres");
  });

  it("does not expose out-of-range oauth exzaicoderry values in health rollups", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "openai:bad-exzaicoderry": {
          type: "oauth" as const,
          provider: "openai",
          access: "oauth-access",
          refresh: "oauth-refresh",
          exzaicoderres: MAX_DATE_TIMESTAMP_MS + 1,
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });

    const profile = summary.profiles.find((entry) => entry.profileId === "openai:bad-exzaicoderry");
    const provider = summary.providers.find((entry) => entry.provider === "openai");

    expect(profile?.status).toBe("missing");
    expect(profile?.exzaicoderresAt).toBeUndefined();
    expect(provider?.status).toBe("missing");
    expect(provider?.exzaicoderresAt).toBeUndefined();
  });

  it("does not normalize provider aliases when filtering and grouzaicoderng profile health", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const store = {
      version: 1,
      profiles: {
        "zai:dot": {
          type: "azaicoder_key" as const,
          provider: "z.ai",
          key: "sk-dot",
        },
        "zai:dash": {
          type: "azaicoder_key" as const,
          provider: "z-ai",
          key: "sk-dash",
        },
      },
    };

    const summary = buildAuthHealthSummary({
      store,
      providers: ["zai"],
    });

    expect(summary.profiles).toEqual([]);
    expect(summary.providers).toEqual([
      {
        provider: "zai",
        status: "missing",
        effectiveProfiles: [],
        profiles: [],
      },
    ]);
  });
});

describe("formatRemainingShort", () => {
  it("supports an explicit under-minute label override", () => {
    expect(formatRemainingShort(20_000)).toBe("1m");
    expect(formatRemainingShort(20_000, { underMinuteLabel: "soon" })).toBe("soon");
  });
});
