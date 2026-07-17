/** Tests synthetic auth fallback during agent model discovery. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const resolveRuntimeSyntheticAuthProviderRefs = vi.hoisted(() => vi.fn(() => ["zaicoder-cli"]));

const resolveProviderSyntheticAuthWithPlugin = vi.hoisted(() =>
  vi.fn((params: { provider: string }) =>
    params.provider === "zaicoder-cli"
      ? {
          azaicoderKey: "zaicoder-cli-access-token",
          source: "zAICoder CLI native auth",
          mode: "oauth" as const,
        }
      : undefined,
  ),
);

vi.mock("../plugins/synthetic-auth.runtime.js", () => ({
  resolveRuntimeSyntheticAuthProviderRefs,
}));

vi.mock("../plugins/provider-runtime.js", () => ({
  applyProviderResolvedTransportWithPlugin: () => undefined,
  normalizeProviderResolvedModelWithPlugin: () => undefined,
  resolveProviderSyntheticAuthWithPlugin,
  resolveExternalAuthProfilesWithPlugins: () => [],
}));

vi.mock("./auth-profiles/store.js", () => ({
  ensureAuthProfileStore: () => ({ version: 1, profiles: {} }),
  loadAuthProfileStoreForSecretsRuntime: () => ({ version: 1, profiles: {} }),
}));

vi.mock("./agent-auth-discovery-core.js", () => ({
  addEnvBackedAgentCredentials: (credentials: Record<string, unknown>) => ({ ...credentials }),
}));

let resolveAgentCredentialsForDiscovery: typeof import("./agent-auth-discovery.js").resolveAgentCredentialsForDiscovery;

async function withAgentDir(run: (agentDir: string) => Promise<void>): Promise<void> {
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-synthetic-auth-"));
  try {
    await run(agentDir);
  } finally {
    await fs.rm(agentDir, { recursive: true, force: true });
  }
}

describe("agent model discovery synthetic auth", () => {
  beforeAll(async () => {
    ({ resolveAgentCredentialsForDiscovery } = await import("./agent-auth-discovery.js"));
  });

  beforeEach(() => {
    resolveRuntimeSyntheticAuthProviderRefs.mockClear();
    resolveProviderSyntheticAuthWithPlugin.mockClear();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mirrors plugin-owned synthetic cli auth into credential discovery", async () => {
    await withAgentDir(async (agentDir) => {
      const credentials = resolveAgentCredentialsForDiscovery(agentDir, { readOnly: true });

      expect(resolveRuntimeSyntheticAuthProviderRefs).toHaveBeenCalledTimes(1);
      expect(resolveRuntimeSyntheticAuthProviderRefs).toHaveBeenCalledWith();
      expect(resolveProviderSyntheticAuthWithPlugin).toHaveBeenCalledTimes(1);
      expect(resolveProviderSyntheticAuthWithPlugin).toHaveBeenCalledWith({
        provider: "zaicoder-cli",
        context: {
          config: undefined,
          provider: "zaicoder-cli",
          providerConfig: undefined,
        },
      });
      expect(credentials["zaicoder-cli"]).toEqual({
        type: "azaicoder_key",
        key: "zaicoder-cli-access-token",
      });
    });
  });
});
