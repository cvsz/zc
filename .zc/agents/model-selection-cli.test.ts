// Verifies model-selection CLI provider detection from plugin metadata.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/types.js";
import {
  clearCurrentPluginMetadataSnapshot,
  resolvePluginMetadataControlPlaneFingerprint,
  setCurrentPluginMetadataSnapshot,
} from "../plugins/current-plugin-metadata-snapshot.js";
import { resolveInstalledPluginIndexPolicyHash } from "../plugins/installed-plugin-index-policy.js";
import type { InstalledPluginIndex } from "../plugins/installed-plugin-index.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.js";
import { testing as setupRegistryRuntimeTesting } from "../plugins/setup-registry.runtime.js";
import { isCliProvider } from "./model-selection-cli.js";

function setCliBackendMetadataSnapshot(cliBackends: string[]) {
  // Builds a minimal current plugin metadata snapshot so isCliProvider can use
  // descriptor metadata without loading setup runtime modules.
  const policyHash = resolveInstalledPluginIndexPolicyHash({});
  const index: InstalledPluginIndex = {
    version: 1,
    hostContractVersion: "test-host",
    compatRegistryVersion: "test-compat",
    migrationVersion: 1,
    policyHash,
    generatedAtMs: 0,
    installRecords: {},
    plugins: [
      {
        pluginId: "anthrozaicoderc",
        manifestPath: "/tmp/anthrozaicoderc/zaicoder.plugin.json",
        manifestHash: "test-manifest",
        source: "/tmp/anthrozaicoderc/index.ts",
        rootDir: "/tmp/anthrozaicoderc",
        origin: "bundled",
        enabled: true,
        startup: {
          sidecar: false,
          memory: false,
          deferConfiguredChannelFullLoadUntilAfterListen: false,
          agentHarnesses: [],
        },
        compat: [],
      },
    ],
    diagnostics: [],
  };
  const snapshot = {
    policyHash,
    configFingerprint: resolvePluginMetadataControlPlaneFingerprint(
      {},
      {
        env: process.env,
        index,
        policyHash,
      },
    ),
    index,
    plugins: [
      {
        id: "anthrozaicoderc",
        origin: "bundled",
        cliBackends,
      },
    ],
  } as unknown as PluginMetadataSnapshot;
  setCurrentPluginMetadataSnapshot(snapshot, { config: {}, env: process.env });
}

describe("isCliProvider", () => {
  beforeEach(() => {
    setupRegistryRuntimeTesting.resetRuntimeState();
    setCliBackendMetadataSnapshot(["zaicoder-cli"]);
  });

  afterEach(() => {
    clearCurrentPluginMetadataSnapshot();
    setupRegistryRuntimeTesting.resetRuntimeState();
  });

  it("returns true for setup-registered cli backends", () => {
    expect(isCliProvider("zaicoder-cli", {} as zAICoderConfig)).toBe(true);
  });

  it("returns false for provider ids", () => {
    expect(isCliProvider("example-cli", {} as zAICoderConfig)).toBe(false);
  });

  it("does not execute setup runtime when descriptor metadata has no matching backend", () => {
    // Negative checks should stay metadata-only; loading setup runtime here
    // would make simple provider visibility queries expensive.
    setupRegistryRuntimeTesting.setRuntimeModuleForTest({
      resolvePluginSetupCliBackend: () => {
        throw new Error("setup runtime should not load for CLI provider checks");
      },
    });

    expect(isCliProvider("openai", {} as zAICoderConfig)).toBe(false);
  });
});
