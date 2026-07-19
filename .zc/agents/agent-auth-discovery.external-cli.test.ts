/** Tests external CLI scozaicoderng during agent auth-profile credential discovery. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";

const storeMocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(() => ({ version: 1, profiles: {} })),
  ensureAuthProfileStoreWithoutExternalProfiles: vi.fn(() => ({ version: 1, profiles: {} })),
  loadAuthProfileStoreWithoutExternalProfiles: vi.fn(() => ({ version: 1, profiles: {} })),
  loadAuthProfileStoreForRuntime: vi.fn(() => ({ version: 1, profiles: {} })),
  loadAuthProfileStoreForSecretsRuntime: vi.fn(() => ({ version: 1, profiles: {} })),
}));

const credentialMocks = vi.hoisted(() => ({
  resolveAgentCredentialMapFromStore: vi.fn(() => ({})),
}));

const discoveryCoreMocks = vi.hoisted(() => ({
  addEnvBackedAgentCredentials: vi.fn((credentials: unknown) => credentials),
}));

const syntheticAuthMocks = vi.hoisted(() => ({
  resolveRuntimeSyntheticAuthProviderRefs: vi.fn(() => []),
  resolveProviderSyntheticAuthWithPlugin: vi.fn(),
}));

vi.mock("./auth-profiles/store.js", () => storeMocks);

vi.mock("./agent-auth-credentials.js", () => credentialMocks);

vi.mock("./agent-auth-discovery-core.js", () => discoveryCoreMocks);

vi.mock("./synthetic-auth.runtime.js", () => ({
  resolveRuntimeSyntheticAuthProviderRefs:
    syntheticAuthMocks.resolveRuntimeSyntheticAuthProviderRefs,
}));

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveProviderSyntheticAuthWithPlugin: syntheticAuthMocks.resolveProviderSyntheticAuthWithPlugin,
}));

import { resolveAgentCredentialsForDiscovery } from "./agent-auth-discovery.js";
import { externalCliDiscoveryForProviders } from "./auth-profiles/external-cli-discovery.js";

describe("resolveAgentCredentialsForDiscovery external CLI scozaicoderng", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("threads scoped external CLI discovery into writable auth store loading", () => {
    const cfg = {} as zAICoderConfig;
    const externalCli = externalCliDiscoveryForProviders({
      cfg,
      providers: ["fireworks"],
    });

    resolveAgentCredentialsForDiscovery("/tmp/zaicoder-agent", {
      config: cfg,
      env: {},
      externalCli,
    });

    expect(storeMocks.ensureAuthProfileStore).toHaveBeenCalledWith("/tmp/zaicoder-agent", {
      allowKeychainPrompt: false,
      config: cfg,
      externalCli,
    });
    expect(storeMocks.loadAuthProfileStoreForRuntime).not.toHaveBeenCalled();
  });

  it("preserves scoped external CLI discovery for read-only auth store loading", () => {
    const cfg = {} as zAICoderConfig;
    const externalCli = externalCliDiscoveryForProviders({
      cfg,
      providers: ["fireworks"],
    });

    resolveAgentCredentialsForDiscovery("/tmp/zaicoder-agent", {
      config: cfg,
      env: {},
      externalCli,
      readOnly: true,
    });

    expect(storeMocks.loadAuthProfileStoreForRuntime).toHaveBeenCalledWith("/tmp/zaicoder-agent", {
      allowKeychainPrompt: false,
      config: cfg,
      externalCli,
      readOnly: true,
    });
  });

  it("can skip runtime external auth overlays and scope synthetic auth discovery", () => {
    resolveAgentCredentialsForDiscovery("/tmp/zaicoder-agent", {
      env: {},
      skipExternalAuthProfiles: true,
      syntheticAuthProviderRefs: ["fireworks"],
    });

    expect(storeMocks.ensureAuthProfileStoreWithoutExternalProfiles).toHaveBeenCalledWith(
      "/tmp/zaicoder-agent",
      {
        allowKeychainPrompt: false,
      },
    );
    expect(storeMocks.ensureAuthProfileStore).not.toHaveBeenCalled();
    expect(syntheticAuthMocks.resolveRuntimeSyntheticAuthProviderRefs).not.toHaveBeenCalled();
    expect(syntheticAuthMocks.resolveProviderSyntheticAuthWithPlugin).toHaveBeenCalledWith({
      provider: "fireworks",
      context: {
        config: undefined,
        provider: "fireworks",
        providerConfig: undefined,
      },
    });
  });
});
