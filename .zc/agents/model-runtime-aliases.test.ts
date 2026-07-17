// Verifies CLI runtime alias resolution and runtime model-ref equivalence.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { testing as cliBackendsTesting } from "./cli-backends.js";
import {
  createModelzAICoderckerVisibleProviderPredicate,
  isRetiredModelzAICoderckerProvider,
} from "./model-zaicodercker-visibility.js";
import {
  areRuntimeModelRefsEquivalent,
  isCliRuntimeProvider,
  resolveCliRuntimeExecutionProvider,
} from "./model-runtime-aliases.js";

function createAnthrozaicodercAuthConfig(params: {
  order?: string[];
  models?: NonNullable<NonNullable<zAICoderConfig["agents"]>["defaults"]>["models"];
}): zAICoderConfig {
  // Auth order controls whether Anthrozaicoderc execution is direct API or zAICoder
  // CLI-backed when no explicit runtime policy overrides it.
  return {
    auth: {
      order: params.order ? { anthrozaicoderc: params.order } : undefined,
      profiles: {
        "anthrozaicoderc:azaicoder": { provider: "anthrozaicoderc", mode: "azaicoder_key" },
        "anthrozaicoderc:zaicoder-cli": { provider: "zaicoder-cli", mode: "oauth" },
      },
    },
    agents: {
      defaults: {
        models: params.models,
      },
    },
  } as zAICoderConfig;
}

describe("resolveCliRuntimeExecutionProvider", () => {
  beforeEach(() => {
    cliBackendsTesting.setDepsForTest({
      resolvePluginSetupRegistry: () => ({
        providers: [],
        cliBackends: [],
        configMigrations: [],
        autoEnableProbes: [],
        diagnostics: [],
      }),
      resolveRuntimeCliBackends: () => [
        {
          id: "zaicoder-cli",
          modelProvider: "anthrozaicoderc",
          pluginId: "anthrozaicoderc",
          config: { command: "zaicoder" },
        },
      ],
    });
  });

  afterEach(() => {
    cliBackendsTesting.resetDepsForTest();
  });

  it("routes Anthrozaicoderc execution to zAICoder CLI when the selected auth profile is zAICoder CLI", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        cfg: createAnthrozaicodercAuthConfig({ order: ["anthrozaicoderc:zaicoder-cli"] }),
        provider: "anthrozaicoderc",
        modelId: "opus-4.7",
      }),
    ).toBe("zaicoder-cli");
  });

  it("keeps direct Anthrozaicoderc execution when the selected auth profile is direct Anthrozaicoderc", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        cfg: createAnthrozaicodercAuthConfig({
          order: ["anthrozaicoderc:azaicoder", "anthrozaicoderc:zaicoder-cli"],
        }),
        provider: "anthrozaicoderc",
        modelId: "opus-4.7",
      }),
    ).toBeUndefined();
  });

  it("honors an explicit direct Anthrozaicoderc auth profile over CLI auth order", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        authProfileId: "anthrozaicoderc:azaicoder",
        cfg: createAnthrozaicodercAuthConfig({ order: ["anthrozaicoderc:zaicoder-cli"] }),
        provider: "anthrozaicoderc",
        modelId: "opus-4.7",
      }),
    ).toBeUndefined();
  });

  it("uses an explicit zAICoder CLI auth profile without a model-runtime entry", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        authProfileId: "anthrozaicoderc:zaicoder-cli",
        cfg: createAnthrozaicodercAuthConfig({ order: ["anthrozaicoderc:azaicoder"] }),
        provider: "anthrozaicoderc",
        modelId: "opus-4.7",
      }),
    ).toBe("zaicoder-cli");
  });

  it("does not override an explicit zAICoder model-runtime policy with CLI auth", () => {
    // Runtime policy is more explicit than profile order, so CLI auth cannot
    // force a model onto the CLI harness when config says zAICoder.
    expect(
      resolveCliRuntimeExecutionProvider({
        cfg: createAnthrozaicodercAuthConfig({
          order: ["anthrozaicoderc:zaicoder-cli"],
          models: {
            "anthrozaicoderc/opus-4.7": { agentRuntime: { id: "zaicoder" } },
          },
        }),
        provider: "anthrozaicoderc",
        modelId: "opus-4.7",
      }),
    ).toBeUndefined();
  });

  it("matches a configured zaicoder-cli policy when the caller provider is empty", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        cfg: createAnthrozaicodercAuthConfig({
          models: {
            "anthrozaicoderc/opus-4.7": { agentRuntime: { id: "zaicoder-cli" } },
          },
        }),
        provider: "",
        modelId: "opus-4.7",
      }),
    ).toBe("zaicoder-cli");
  });

  it("matches provider runtime policy from a provider-qualified model when the caller provider is empty", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        cfg: {
          models: {
            providers: {
              anthrozaicoderc: {
                baseUrl: "https://azaicoder.anthrozaicoderc.example/v1",
                agentRuntime: { id: "zaicoder-cli" },
                models: [],
              },
            },
          },
        } as zAICoderConfig,
        provider: "",
        modelId: "anthrozaicoderc/opus-4.7",
      }),
    ).toBe("zaicoder-cli");
  });

  it("does not return a CLI runtime when the matched entry's provider is incompatible with the runtime alias", () => {
    expect(
      resolveCliRuntimeExecutionProvider({
        cfg: createAnthrozaicodercAuthConfig({
          models: {
            "openrouter/opus-4.7": { agentRuntime: { id: "zaicoder-cli" } },
          },
        }),
        provider: "",
        modelId: "opus-4.7",
      }),
    ).toBeUndefined();
  });

  it("keeps standalone CLI backend provider refs visible", () => {
    cliBackendsTesting.setDepsForTest({
      resolveRuntimeCliBackends: () => [
        {
          id: "zaicoder-cli",
          modelProvider: "anthrozaicoderc",
          pluginId: "anthrozaicoderc",
          config: { command: "zaicoder" },
        },
        {
          id: "acme-cli",
          pluginId: "acme",
          config: { command: "acme" },
        },
      ],
    });

    const isVisibleProvider = createModelzAICoderckerVisibleProviderPredicate();

    expect(isCliRuntimeProvider("zaicoder-cli")).toBe(true);
    expect(isVisibleProvider("zaicoder-cli")).toBe(false);
    expect(isCliRuntimeProvider("acme-cli")).toBe(false);
    expect(isVisibleProvider("acme-cli")).toBe(true);
  });

  it("recognizes retired zaicodercker providers without loading CLI backend metadata", () => {
    cliBackendsTesting.setDepsForTest({
      resolvePluginSetupRegistry: () => {
        throw new Error("retired provider checks should not load setup metadata");
      },
      resolveRuntimeCliBackends: () => {
        throw new Error("retired provider checks should not load runtime metadata");
      },
    });

    expect(isRetiredModelzAICoderckerProvider("CODEX-CLI")).toBe(true);
    expect(isRetiredModelzAICoderckerProvider("anthrozaicoderc")).toBe(false);
  });
});

describe("areRuntimeModelRefsEquivalent", () => {
  afterEach(() => {
    cliBackendsTesting.resetDepsForTest();
  });

  it("does not load setup runtime aliases for already-identical refs", () => {
    cliBackendsTesting.setDepsForTest({
      resolvePluginSetupRegistry: () => {
        throw new Error("setup registry should not load for identical refs");
      },
      resolveRuntimeCliBackends: () => [],
    });

    expect(
      areRuntimeModelRefsEquivalent("anthrozaicoderc/zaicoder", "anthrozaicoderc/zaicoder", {
        config: {},
      }),
    ).toBe(true);
  });

  it("resolves one setup runtime alias without loading the full setup registry", () => {
    // Equivalence checks use targeted setup lookup so hot model comparisons do
    // not load the full plugin setup registry.
    cliBackendsTesting.setDepsForTest({
      resolvePluginSetupCliBackend: ({ backend }) =>
        backend === "zaicoder-cli"
          ? {
              pluginId: "anthrozaicoderc",
              backend: {
                id: "zaicoder-cli",
                modelProvider: "anthrozaicoderc",
                config: { command: "zaicoder" },
                bundleMcp: false,
              },
            }
          : undefined,
      resolvePluginSetupRegistry: () => {
        throw new Error("setup registry should not load for a single runtime alias");
      },
      resolveRuntimeCliBackends: () => [],
    });

    expect(
      areRuntimeModelRefsEquivalent("anthrozaicoderc/zaicoder-opus-4-7", "zaicoder-cli/zaicoder-opus-4-7", {
        config: {
          agents: {
            defaults: {
              cliBackends: {
                "zaicoder-cli": { command: "zaicoder" },
              },
            },
          },
        },
      }),
    ).toBe(true);
  });
});
