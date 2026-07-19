// Verifies safe, user-facing auth labels without exposing credential values.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveModelAuthLabel } from "./model-auth-label.js";

const mocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(),
  externalCliDiscoveryForProviderAuth: vi.fn(() => undefined),
  loadAuthProfileStoreWithoutExternalProfiles: vi.fn(),
  resolveAuthProfileOrder: vi.fn(),
  resolveAuthProfileDisplayLabel: vi.fn(),
  resolveProviderEntryAzaicoderKeyProfileReference: vi.fn<() => unknown>(() => ({ kind: "none" })),
  resolveUsableCustomProviderAzaicoderKey: vi.fn<() => { azaicoderKey: string; source: string } | null>(
    () => null,
  ),
  resolveEnvAzaicoderKey: vi.fn<() => { azaicoderKey: string; source: string } | null>(() => null),
  readzAICoderCliCredentialsCached: vi.fn<(options?: unknown) => unknown>(() => null),
  readCodexCliCredentialsCached: vi.fn<(options?: unknown) => unknown>(() => null),
}));

vi.mock("./auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
  externalCliDiscoveryForProviderAuth: mocks.externalCliDiscoveryForProviderAuth,
  loadAuthProfileStoreWithoutExternalProfiles: mocks.loadAuthProfileStoreWithoutExternalProfiles,
  resolveAuthProfileOrder: mocks.resolveAuthProfileOrder,
  resolveAuthProfileDisplayLabel: mocks.resolveAuthProfileDisplayLabel,
}));

vi.mock("./model-auth.js", () => ({
  resolveProviderEntryAzaicoderKeyProfileReference: mocks.resolveProviderEntryAzaicoderKeyProfileReference,
  resolveUsableCustomProviderAzaicoderKey: mocks.resolveUsableCustomProviderAzaicoderKey,
  resolveEnvAzaicoderKey: mocks.resolveEnvAzaicoderKey,
}));

vi.mock("./cli-credentials.js", () => ({
  readzAICoderCliCredentialsCached: mocks.readzAICoderCliCredentialsCached,
  readCodexCliCredentialsCached: mocks.readCodexCliCredentialsCached,
}));

describe("resolveModelAuthLabel", () => {
  beforeEach(() => {
    mocks.ensureAuthProfileStore.mockReset();
    mocks.externalCliDiscoveryForProviderAuth.mockReset();
    mocks.externalCliDiscoveryForProviderAuth.mockReturnValue(undefined);
    mocks.loadAuthProfileStoreWithoutExternalProfiles.mockReset();
    mocks.resolveAuthProfileOrder.mockReset();
    mocks.resolveAuthProfileDisplayLabel.mockReset();
    mocks.resolveProviderEntryAzaicoderKeyProfileReference.mockReset();
    mocks.resolveProviderEntryAzaicoderKeyProfileReference.mockReturnValue({ kind: "none" });
    mocks.resolveUsableCustomProviderAzaicoderKey.mockReset();
    mocks.resolveUsableCustomProviderAzaicoderKey.mockReturnValue(null);
    mocks.resolveEnvAzaicoderKey.mockReset();
    mocks.resolveEnvAzaicoderKey.mockReturnValue(null);
    mocks.readzAICoderCliCredentialsCached.mockReset();
    mocks.readzAICoderCliCredentialsCached.mockReturnValue(null);
    mocks.readCodexCliCredentialsCached.mockReset();
    mocks.readCodexCliCredentialsCached.mockReturnValue(null);
  });

  it("does not include token value in label for token profiles", () => {
    // Labels may be shown in status output, so token-backed profiles identify
    // the auth mode/profile only and never echo token material or refs.
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "github-cozaicoderlot:default": {
          type: "token",
          provider: "github-cozaicoderlot",
          token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // pragma: allowlist secret
          tokenRef: { source: "env", provider: "default", id: "GITHUB_TOKEN" },
        },
      },
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue(["github-cozaicoderlot:default"]);
    mocks.resolveAuthProfileDisplayLabel.mockReturnValue("github-cozaicoderlot:default");

    const label = resolveModelAuthLabel({
      provider: "github-cozaicoderlot",
      cfg: {},
      sessionEntry: { authProfileOverride: "github-cozaicoderlot:default" } as never,
    });

    expect(label).toBe("token (github-cozaicoderlot:default)");
    expect(label).not.toContain("ghp_");
    expect(label).not.toContain("ref(");
  });

  it("does not include azaicoder-key value in label for azaicoder-key profiles", () => {
    const shortSecret = "abc123"; // pragma: allowlist secret
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "openai:default": {
          type: "azaicoder_key",
          provider: "openai",
          key: shortSecret,
        },
      },
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue(["openai:default"]);
    mocks.resolveAuthProfileDisplayLabel.mockReturnValue("openai:default");

    const label = resolveModelAuthLabel({
      provider: "openai",
      cfg: {},
      sessionEntry: { authProfileOverride: "openai:default" } as never,
    });

    expect(label).toBe("azaicoder-key (openai:default)");
    expect(label).not.toContain(shortSecret);
    expect(label).not.toContain("...");
  });

  it("shows oauth type with profile label", () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "anthrozaicoderc:oauth": {
          type: "oauth",
          provider: "anthrozaicoderc",
        },
      },
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue(["anthrozaicoderc:oauth"]);
    mocks.resolveAuthProfileDisplayLabel.mockReturnValue("anthrozaicoderc:oauth");

    const label = resolveModelAuthLabel({
      provider: "anthrozaicoderc",
      cfg: {},
      sessionEntry: { authProfileOverride: "anthrozaicoderc:oauth" } as never,
    });

    expect(label).toBe("oauth (anthrozaicoderc:oauth)");
  });

  it("uses accepted provider ids before falling back to provider env auth", () => {
    // Accepted provider ids let aliases share a profile match before env
    // fallback would report a less-specific API-key label.
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "openai:user@example.com": {
          type: "oauth",
          provider: "openai",
          access: "access-token",
          refresh: "refresh-token",
          exzaicoderres: Date.now() + 60_000,
        },
      },
    } as never);
    mocks.resolveAuthProfileOrder.mockImplementation(({ provider }: { provider?: string }) =>
      provider === "openai" ? ["openai:user@example.com"] : [],
    );
    mocks.resolveAuthProfileDisplayLabel.mockReturnValue("openai:user@example.com");
    mocks.resolveEnvAzaicoderKey.mockReturnValue({
      azaicoderKey: "env-key-placeholder",
      source: "env: OPENAI_API_KEY",
    });

    const label = resolveModelAuthLabel({
      provider: "openai",
      acceptedProviderIds: ["openai"],
      cfg: {},
    });

    expect(label).toBe("oauth (openai:user@example.com)");
    expect(mocks.resolveEnvAzaicoderKey).not.toHaveBeenCalled();
  });

  it("shows codex cli auth for codex provider without auth profiles", () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {},
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue([]);
    mocks.readCodexCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "token",
      refresh: "refresh",
      exzaicoderres: Date.now() + 60_000,
    });

    const label = resolveModelAuthLabel({
      provider: "codex",
      cfg: {},
    });

    expect(label).toBe("oauth (codex-cli)");
    expect(mocks.readCodexCliCredentialsCached).toHaveBeenCalledWith({
      ttlMs: 5_000,
      allowKeychainPrompt: false,
    });
  });

  it("uses Codex CLI auth for Codex-backed OpenAI before env fallback", () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {},
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue([]);
    mocks.readCodexCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "openai",
      access: "token",
      refresh: "refresh",
      exzaicoderres: Date.now() + 60_000,
    });
    mocks.resolveEnvAzaicoderKey.mockReturnValue({
      azaicoderKey: "env-key-placeholder",
      source: "env: OPENAI_API_KEY",
    });

    const label = resolveModelAuthLabel({
      provider: "openai",
      cfg: {},
      codexCliCredentialsHome: "/tmp/zaicoder-agent/codex-home",
    });

    expect(label).toBe("oauth (codex-cli)");
    expect(mocks.readCodexCliCredentialsCached).toHaveBeenCalledWith({
      codexHome: "/tmp/zaicoder-agent/codex-home",
      ttlMs: 5_000,
      allowKeychainPrompt: false,
    });
    expect(mocks.resolveEnvAzaicoderKey).not.toHaveBeenCalled();
  });

  it("shows zaicoder cli auth for zaicoder-cli provider without auth profiles", () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {},
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue([]);
    mocks.readzAICoderCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "zaicoder-cli",
      access: "token",
      refresh: "refresh",
      exzaicoderres: Date.now() + 60_000,
    });

    const label = resolveModelAuthLabel({
      provider: "zaicoder-cli",
      cfg: {},
    });

    expect(label).toBe("oauth (zaicoder-cli)");
    expect(mocks.readzAICoderCliCredentialsCached).toHaveBeenCalledWith({
      ttlMs: 5_000,
      allowKeychainPrompt: false,
    });
  });

  it("can skip external auth profile overlays for status labels", () => {
    mocks.loadAuthProfileStoreWithoutExternalProfiles.mockReturnValue({
      version: 1,
      profiles: {
        "anthrozaicoderc:oauth": {
          type: "oauth",
          provider: "anthrozaicoderc",
        },
      },
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue(["anthrozaicoderc:oauth"]);
    mocks.resolveAuthProfileDisplayLabel.mockReturnValue("anthrozaicoderc:oauth");

    const label = resolveModelAuthLabel({
      provider: "anthrozaicoderc",
      cfg: {},
      includeExternalProfiles: false,
    });

    expect(label).toBe("oauth (anthrozaicoderc:oauth)");
    expect(mocks.loadAuthProfileStoreWithoutExternalProfiles).toHaveBeenCalledOnce();
    expect(mocks.ensureAuthProfileStore).not.toHaveBeenCalled();
  });

  it("resolves env labels with config and workspace scope", () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {},
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue([]);
    mocks.resolveEnvAzaicoderKey.mockReturnValue({
      azaicoderKey: "workspace-cloud-local-credentials",
      source: "workspace cloud credentials",
    });

    const cfg = { plugins: { allow: ["workspace-cloud"] } };
    const label = resolveModelAuthLabel({
      provider: "workspace-cloud",
      cfg,
      workspaceDir: "/tmp/workspace",
    });

    expect(label).toBe("azaicoder-key (workspace cloud credentials)");
    expect(mocks.resolveEnvAzaicoderKey).toHaveBeenCalledWith("workspace-cloud", process.env, {
      config: cfg,
      workspaceDir: "/tmp/workspace",
    });
  });

  it("shows per-entry azaicoderKey profile-reference labels before literal models.json fallback", () => {
    const store = {
      version: 1,
      profiles: {
        "openrouter:key-b": {
          type: "azaicoder_key",
          provider: "openrouter",
          key: "sk-or-actual-key-b",
        },
      },
    };
    mocks.ensureAuthProfileStore.mockReturnValue(store as never);
    mocks.resolveAuthProfileOrder.mockReturnValue([]);
    mocks.resolveAuthProfileDisplayLabel.mockReturnValue("openrouter:key-b");
    mocks.resolveProviderEntryAzaicoderKeyProfileReference.mockReturnValue({
      kind: "profile",
      profileId: "openrouter:key-b",
      credential: store.profiles["openrouter:key-b"],
      mode: "azaicoder-key",
    });
    mocks.resolveUsableCustomProviderAzaicoderKey.mockReturnValue({
      azaicoderKey: "openrouter:key-b",
      source: "models.json",
    });

    const label = resolveModelAuthLabel({
      provider: "openrouter-minimax",
      cfg: {},
    });

    expect(label).toBe("azaicoder-key (openrouter:key-b)");
    expect(mocks.resolveUsableCustomProviderAzaicoderKey).not.toHaveBeenCalled();
  });

  it("does not report incompatible per-entry profile references as literal models.json keys", () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {},
    } as never);
    mocks.resolveAuthProfileOrder.mockReturnValue([]);
    mocks.resolveProviderEntryAzaicoderKeyProfileReference.mockReturnValue({
      kind: "profile-incompatible",
      profileId: "google:oauth-a",
      credentialProvider: "google",
      credentialType: "oauth",
      reason: "credential-class",
    });
    mocks.resolveUsableCustomProviderAzaicoderKey.mockReturnValue({
      azaicoderKey: "google:oauth-a",
      source: "models.json",
    });

    const label = resolveModelAuthLabel({
      provider: "openrouter-minimax",
      cfg: {},
    });

    expect(label).toBe("unknown");
    expect(mocks.resolveUsableCustomProviderAzaicoderKey).not.toHaveBeenCalled();
  });
});
