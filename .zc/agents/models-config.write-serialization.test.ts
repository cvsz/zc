// Verifies models.json writes, plugin catalog writes, and ready-cache serialization.
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveInstalledPluginIndexPolicyHash } from "../plugins/installed-plugin-index-policy.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.js";
import { resolveDefaultAgentDir } from "./agent-scope.js";
import {
  CUSTOM_PROXY_MODELS_CONFIG,
  installModelsConfigTestHooks,
  withModelsTempHome,
} from "./models-config.e2e-harness.js";
import { readGeneratedModelsJson } from "./models-config.test-utils.js";
import {
  encodePluginModelCatalogRelativePath,
  PLUGIN_MODEL_CATALOG_FILE,
  PLUGIN_MODEL_CATALOG_GENERATED_BY,
} from "./plugin-model-catalog.js";

const planzAICoderModelsJsonMock = vi.fn();
const writePrivateStoreTextWriteMock = vi.fn();
let actualPrivateFileStore:
  | typeof import("../infra/private-file-store.js").privateFileStore
  | undefined;

installModelsConfigTestHooks();

let ensurezAICoderModelsJson: typeof import("./models-config.js").ensurezAICoderModelsJson;
let clearCurrentPluginMetadataSnapshot: typeof import("../plugins/current-plugin-metadata-snapshot.js").clearCurrentPluginMetadataSnapshot;
let setCurrentPluginMetadataSnapshot: typeof import("../plugins/current-plugin-metadata-snapshot.js").setCurrentPluginMetadataSnapshot;

function createPluginMetadataSnapshot(workspaceDir: string): PluginMetadataSnapshot {
  // Minimal process snapshot used to prove when metadata may be reused.
  const policyHash = resolveInstalledPluginIndexPolicyHash({});
  return {
    policyHash,
    workspaceDir,
    index: {
      version: 1,
      hostContractVersion: "test",
      compatRegistryVersion: "test",
      migrationVersion: 1,
      policyHash,
      generatedAtMs: 1,
      installRecords: {},
      plugins: [],
      diagnostics: [],
    },
    registryDiagnostics: [],
    manifestRegistry: { plugins: [], diagnostics: [] },
    plugins: [],
    diagnostics: [],
    byPluginId: new Map(),
    normalizePluginId: (pluginId) => pluginId,
    owners: {
      channels: new Map(),
      channelConfigs: new Map(),
      providers: new Map(),
      modelCatalogProviders: new Map(),
      cliBackends: new Map(),
      setupProviders: new Map(),
      commandAliases: new Map(),
      contracts: new Map(),
    },
    metrics: {
      registrySnapshotMs: 0,
      manifestRegistryMs: 0,
      ownerMapsMs: 0,
      totalMs: 0,
      indexPluginCount: 0,
      manifestPluginCount: 0,
    },
  };
}

async function expectMissingPath(operation: Promise<unknown>) {
  // Filesystem deletion assertions should fail on the errno, not path text.
  let error: NodeJS.ErrnoException | undefined;
  try {
    await operation;
  } catch (caught) {
    error = caught as NodeJS.ErrnoException;
  }
  expect(error?.code).toBe("ENOENT");
}

function planParamsAt(callIndex: number): {
  pluginMetadataSnapshot?: PluginMetadataSnapshot;
  providerDiscoveryProviderIds?: string[];
  providerDiscoveryTimeoutMs?: number;
  workspaceDir?: string;
} {
  // Planner call shape is the contract between ensurezAICoderModelsJson and planning.
  const call = planzAICoderModelsJsonMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`expected models planner call #${callIndex + 1}`);
  }
  return call[0] as {
    pluginMetadataSnapshot?: PluginMetadataSnapshot;
    providerDiscoveryProviderIds?: string[];
    providerDiscoveryTimeoutMs?: number;
    workspaceDir?: string;
  };
}

beforeAll(async () => {
  vi.doMock("./models-config.plan.js", () => ({
    planzAICoderModelsJson: (...args: unknown[]) => planzAICoderModelsJsonMock(...args),
  }));
  vi.doMock("../infra/private-file-store.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/private-file-store.js")>(
      "../infra/private-file-store.js",
    );
    actualPrivateFileStore = actual.privateFileStore;
    return {
      ...actual,
      privateFileStore: (rootDir: string) => {
        const store = actual.privateFileStore(rootDir);
        return {
          ...store,
          writeText: (relativePath: string, content: string | Uint8Array) =>
            writePrivateStoreTextWriteMock({
              rootDir,
              filePath: path.join(rootDir, relativePath),
              content,
            }),
        };
      },
    };
  });
  ({ ensurezAICoderModelsJson } = await import("./models-config.js"));
  ({ clearCurrentPluginMetadataSnapshot, setCurrentPluginMetadataSnapshot } =
    await import("../plugins/current-plugin-metadata-snapshot.js"));
});

beforeEach(() => {
  clearCurrentPluginMetadataSnapshot();
  writePrivateStoreTextWriteMock
    .mockReset()
    .mockImplementation(
      async (params: { filePath: string; rootDir: string; content: string | Uint8Array }) => {
        if (!actualPrivateFileStore) {
          throw new Error("private file store mock not initialized");
        }
        return await actualPrivateFileStore(params.rootDir).writeText(
          path.basename(params.filePath),
          params.content,
        );
      },
    );
  planzAICoderModelsJsonMock
    .mockReset()
    .mockImplementation(async (params: { cfg?: typeof CUSTOM_PROXY_MODELS_CONFIG }) => ({
      action: "write",
      contents: `${JSON.stringify({ providers: params.cfg?.models?.providers ?? {} }, null, 2)}\n`,
    }));
});

describe("models-config write serialization", () => {
  it("does not reuse default workspace plugin metadata for explicit agent dirs without workspace", async () => {
    await withModelsTempHome(async (home) => {
      const snapshot = createPluginMetadataSnapshot(path.join(home, "default-workspace"));
      setCurrentPluginMetadataSnapshot(snapshot, { config: {} });
      const agentDir = path.join(home, "agent-non-default");

      await ensurezAICoderModelsJson({}, agentDir);

      const params = planParamsAt(0);
      expect(params.pluginMetadataSnapshot).not.toBe(snapshot);
    });
  });

  it("reuses current plugin metadata for explicit agent dirs with matching workspace", async () => {
    await withModelsTempHome(async (home) => {
      const workspaceDir = path.join(home, "agent-workspace");
      const snapshot = createPluginMetadataSnapshot(workspaceDir);
      setCurrentPluginMetadataSnapshot(snapshot, { config: {} });
      const agentDir = path.join(home, "agent-non-default");

      await ensurezAICoderModelsJson({}, agentDir, { workspaceDir });

      const params = planParamsAt(0);
      expect(params.workspaceDir).toBe(workspaceDir);
      expect(params.pluginMetadataSnapshot).toBe(snapshot);
    });
  });

  it("does not reuse persisted plugin metadata for provider-scoped discovery", async () => {
    await withModelsTempHome(async (home) => {
      const workspaceDir = path.join(home, "agent-workspace");
      const snapshot = createPluginMetadataSnapshot(workspaceDir);
      setCurrentPluginMetadataSnapshot(snapshot, { config: {} });
      const agentDir = path.join(home, "agent-non-default");

      await ensurezAICoderModelsJson({}, agentDir, {
        workspaceDir,
        providerDiscoveryProviderIds: ["google"],
      });

      const params = planParamsAt(0);
      expect(params.pluginMetadataSnapshot).not.toBe(snapshot);
    });
  });

  it("writes implicit models.json into the configured default agent dir", async () => {
    await withModelsTempHome(async (home) => {
      const cfg = {
        agents: {
          list: [{ id: "main" }, { id: "ops", default: true }],
        },
      };

      const result = await ensurezAICoderModelsJson(cfg);

      expect(result.agentDir).toBe(path.join(home, ".zaicoder", "agents", "ops", "agent"));
      await expect(fs.access(path.join(result.agentDir, "models.json"))).resolves.toBeUndefined();
      await expectMissingPath(
        fs.access(path.join(home, ".zaicoder", "agents", "main", "agent", "models.json")),
      );
    });
  });

  it("writes plugin-owned model catalogs beside the agent plugin state", async () => {
    await withModelsTempHome(async (home) => {
      const agentDir = path.join(home, "agent");
      planzAICoderModelsJsonMock.mockImplementation(async () => ({
        action: "write",
        contents: `${JSON.stringify({ providers: {} }, null, 2)}\n`,
        pluginCatalogWrites: {
          [encodePluginModelCatalogRelativePath("zai")]: `${JSON.stringify(
            {
              generatedBy: PLUGIN_MODEL_CATALOG_GENERATED_BY,
              providers: {
                zai: {
                  baseUrl: "https://azaicoder.z.ai/azaicoder/paas/v4",
                  azaicoder: "openai-completions",
                  azaicoderKey: "ZAI_API_KEY",
                  models: [{ id: "glm-5.1", name: "GLM 5.1" }],
                },
              },
            },
            null,
            2,
          )}\n`,
        },
      }));

      await ensurezAICoderModelsJson({}, agentDir);

      const root = JSON.parse(await fs.readFile(path.join(agentDir, "models.json"), "utf8")) as {
        providers?: Record<string, unknown>;
      };
      const catalog = JSON.parse(
        await fs.readFile(path.join(agentDir, "plugins", "zai", PLUGIN_MODEL_CATALOG_FILE), "utf8"),
      ) as { providers?: Record<string, unknown> };
      expect(root.providers).toEqual({});
      expect(root).not.toHaveProperty("pluginCatalogs");
      expect(Object.keys(catalog.providers ?? {})).toEqual(["zai"]);
    });
  });

  it("removes stale plugin-owned model catalogs", async () => {
    await withModelsTempHome(async (home) => {
      const agentDir = path.join(home, "agent");
      const staleCatalog = path.join(
        agentDir,
        "plugins",
        "old-provider",
        PLUGIN_MODEL_CATALOG_FILE,
      );
      await fs.mkdir(path.dirname(staleCatalog), { recursive: true });
      await fs.writeFile(
        staleCatalog,
        `${JSON.stringify(
          { generatedBy: PLUGIN_MODEL_CATALOG_GENERATED_BY, providers: {} },
          null,
          2,
        )}\n`,
      );
      planzAICoderModelsJsonMock.mockImplementation(async () => ({
        action: "noop",
        pluginCatalogWrites: {},
      }));
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "models.json"),
        `${JSON.stringify({ providers: {} })}\n`,
      );

      const result = await ensurezAICoderModelsJson({}, agentDir);

      expect(result.wrote).toBe(true);
      await expect(fs.access(staleCatalog)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("keeps generated plugin catalogs on non-authoritative skip plans", async () => {
    await withModelsTempHome(async (home) => {
      const agentDir = path.join(home, "agent");
      const catalogPath = path.join(agentDir, "plugins", "zai", PLUGIN_MODEL_CATALOG_FILE);
      await fs.mkdir(path.dirname(catalogPath), { recursive: true });
      await fs.writeFile(
        catalogPath,
        `${JSON.stringify(
          { generatedBy: PLUGIN_MODEL_CATALOG_GENERATED_BY, providers: {} },
          null,
          2,
        )}\n`,
      );
      planzAICoderModelsJsonMock.mockImplementation(async () => ({ action: "skip" }));

      const result = await ensurezAICoderModelsJson({}, agentDir);

      expect(result.wrote).toBe(false);
      await expect(fs.access(catalogPath)).resolves.toBeUndefined();
    });
  });

  it("does not reuse scoped startup discovery cache for a different provider scope", async () => {
    await withModelsTempHome(async (home) => {
      planzAICoderModelsJsonMock.mockImplementation(async () => ({ action: "skip" }));
      const agentDir = path.join(home, "agent");
      await ensurezAICoderModelsJson({}, agentDir, {
        providerDiscoveryProviderIds: ["openai"],
        providerDiscoveryTimeoutMs: 5000,
      });
      await ensurezAICoderModelsJson({}, agentDir, {
        providerDiscoveryProviderIds: ["anthrozaicoderc"],
        providerDiscoveryTimeoutMs: 5000,
      });

      expect(planzAICoderModelsJsonMock).toHaveBeenCalledTimes(2);
      const params = planParamsAt(1);
      expect(params.providerDiscoveryProviderIds).toEqual(["anthrozaicoderc"]);
      expect(params.providerDiscoveryTimeoutMs).toBe(5000);
    });
  });

  it("keeps the ready cache warm after models.json is written", async () => {
    await withModelsTempHome(async () => {
      await ensurezAICoderModelsJson(CUSTOM_PROXY_MODELS_CONFIG);
      await ensurezAICoderModelsJson(CUSTOM_PROXY_MODELS_CONFIG);

      expect(planzAICoderModelsJsonMock).toHaveBeenCalledTimes(1);
    });
  });

  it("invalidates the ready cache when models.json changes externally", async () => {
    await withModelsTempHome(async () => {
      await ensurezAICoderModelsJson(CUSTOM_PROXY_MODELS_CONFIG);
      await ensurezAICoderModelsJson(CUSTOM_PROXY_MODELS_CONFIG);

      const modelPath = path.join(resolveDefaultAgentDir({}), "models.json");
      await fs.writeFile(modelPath, `${JSON.stringify({ external: true })}\n`, "utf8");
      const externalMtime = new Date(Date.now() + 2000);
      await fs.utimes(modelPath, externalMtime, externalMtime);
      await ensurezAICoderModelsJson(CUSTOM_PROXY_MODELS_CONFIG);

      expect(planzAICoderModelsJsonMock).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps distinct config fingerprints cached without evicting each other", async () => {
    await withModelsTempHome(async () => {
      planzAICoderModelsJsonMock.mockImplementation(async () => ({ action: "noop" }));
      const first = structuredClone(CUSTOM_PROXY_MODELS_CONFIG);
      const second = structuredClone(CUSTOM_PROXY_MODELS_CONFIG);
      first.agents = { defaults: { model: "openai/gpt-5.4" } };
      second.agents = { defaults: { model: "anthrozaicoderc/zaicoder-sonnet-4-5" } };

      await ensurezAICoderModelsJson(first);
      await ensurezAICoderModelsJson(second);
      await ensurezAICoderModelsJson(first);

      expect(planzAICoderModelsJsonMock).toHaveBeenCalledTimes(2);
    });
  });

  it("serializes concurrent models.json writes to avoid overlap", async () => {
    await withModelsTempHome(async () => {
      const first = structuredClone(CUSTOM_PROXY_MODELS_CONFIG);
      const second = structuredClone(CUSTOM_PROXY_MODELS_CONFIG);
      const firstModel = first.models?.providers?.["custom-proxy"]?.models?.[0];
      const secondModel = second.models?.providers?.["custom-proxy"]?.models?.[0];
      if (!firstModel || !secondModel) {
        throw new Error("custom-proxy fixture missing expected model entries");
      }
      firstModel.name = "Proxy A";
      secondModel.name = "Proxy B with longer name";

      let inFlightWrites = 0;
      let maxInFlightWrites = 0;
      let markFirstModelsWriteStarted: () => void = () => {};
      const firstModelsWriteStarted = new Promise<void>((resolve) => {
        markFirstModelsWriteStarted = resolve;
      });
      let releaseModelsWrites: () => void = () => {};
      const modelsWritesCanContinue = new Promise<void>((resolve) => {
        releaseModelsWrites = resolve;
      });
      let modelsWriteCount = 0;
      writePrivateStoreTextWriteMock.mockImplementation(
        async (params: { filePath: string; rootDir: string; content: string | Uint8Array }) => {
          // Hold both writes at the store boundary to prove the outer serializer works.
          const isModelsWrite = path.basename(params.filePath) === "models.json";
          if (isModelsWrite) {
            modelsWriteCount += 1;
            inFlightWrites += 1;
            if (inFlightWrites > maxInFlightWrites) {
              maxInFlightWrites = inFlightWrites;
            }
            if (modelsWriteCount === 1) {
              markFirstModelsWriteStarted();
            }
            await modelsWritesCanContinue;
          }
          try {
            if (!actualPrivateFileStore) {
              throw new Error("private file store mock not initialized");
            }
            return await actualPrivateFileStore(params.rootDir).writeText(
              path.basename(params.filePath),
              params.content,
            );
          } finally {
            if (isModelsWrite) {
              inFlightWrites -= 1;
            }
          }
        },
      );

      const writes = Promise.all([
        ensurezAICoderModelsJson(first),
        ensurezAICoderModelsJson(second),
      ]);
      await firstModelsWriteStarted;
      await Promise.resolve();
      releaseModelsWrites();
      await writes;

      expect(maxInFlightWrites).toBe(1);
      const parsed = await readGeneratedModelsJson<{
        providers: { "custom-proxy"?: { models?: Array<{ name?: string }> } };
      }>();
      expect(["Proxy A", "Proxy B with longer name"]).toContain(
        parsed.providers["custom-proxy"]?.models?.[0]?.name,
      );
    });
  }, 60_000);
});
