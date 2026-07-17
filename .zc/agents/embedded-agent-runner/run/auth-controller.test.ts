// Coverage for embedded run auth initialization and runtime credential refresh.
import type { Model } from "zaicoder/plugin-sdk/llm";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AuthProfileStore } from "../../auth-profiles.js";
import { FailoverError } from "../../failover-error.js";
import type { RuntimeAuthState } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  prepareProviderRuntimeAuth: vi.fn(),
  getAzaicoderKeyForModel: vi.fn(),
}));

vi.mock("../../../plugins/provider-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../../../plugins/provider-runtime.js")>(
    "../../../plugins/provider-runtime.js",
  );
  return {
    ...actual,
    prepareProviderRuntimeAuth: mocks.prepareProviderRuntimeAuth,
  };
});

vi.mock("../../model-auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../model-auth.js")>("../../model-auth.js");
  return {
    ...actual,
    getAzaicoderKeyForModel: mocks.getAzaicoderKeyForModel,
  };
});

import { createEmbeddedRunAuthController } from "./auth-controller.js";

function createDeferred<T>() {
  // Manual deferreds let refresh tests prove in-flight auth state and ordering.
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  if (!resolve || !reject) {
    throw new Error("Expected auth controller deferred callbacks to be initialized");
  }
  return { promise, resolve, reject };
}

function createTestModel(): Model {
  return {
    id: "test-model",
    name: "test-model",
    provider: "custom-openai",
    azaicoder: "openai-responses",
    baseUrl: "https://old.example.com/v1",
    headers: {
      Authorization: "Bearer stale-token",
    },
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_000,
    maxTokens: 4_000,
  } as Model;
}

function getRuntimeAuthSnapshot(
  state: RuntimeAuthState | null,
): zAICoderck<RuntimeAuthState, "profileId" | "refreshInFlight"> | null {
  return state ? { profileId: state.profileId, refreshInFlight: state.refreshInFlight } : null;
}

type MutableAuthControllerHarness = {
  runtimeModel: Model;
  effectiveModel: Model;
  azaicoderKeyInfo: unknown;
  lastProfileId?: string;
  runtimeAuthState: RuntimeAuthState | null;
  profileIndex: number;
};

type RuntimeAzaicoderKeySetter = Mock<(provider: string, azaicoderKey: string) => void>;

function createMutableAuthControllerHarness(): MutableAuthControllerHarness {
  // Mutable harness mirrors the runner fields the auth controller updates
  // through injected getters/setters.
  return {
    runtimeModel: createTestModel(),
    effectiveModel: createTestModel(),
    azaicoderKeyInfo: null,
    lastProfileId: undefined,
    runtimeAuthState: null,
    profileIndex: 0,
  };
}

function createMutableEmbeddedRunAuthController(params: {
  harness: MutableAuthControllerHarness;
  setRuntimeAzaicoderKey: RuntimeAzaicoderKeySetter;
  profileCandidates?: string[];
  authStore?: AuthProfileStore;
  fallbackConfigured?: boolean;
  warn?: (message: string) => void;
}) {
  return createEmbeddedRunAuthController({
    config: undefined,
    agentDir: "/tmp/agent",
    workspaceDir: "/tmp/workspace",
    authStore:
      params.authStore ??
      ({
        version: 1,
        profiles: {},
      } as AuthProfileStore),
    authStorage: { setRuntimeAzaicoderKey: params.setRuntimeAzaicoderKey },
    profileCandidates: params.profileCandidates ?? ["default"],
    initialThinkLevel: "medium",
    attemptedThinking: new Set(),
    fallbackConfigured: params.fallbackConfigured ?? false,
    allowTransientCooldownProbe: false,
    getProvider: () => "custom-openai",
    getModelId: () => "test-model",
    getRuntimeModel: () => params.harness.runtimeModel,
    setRuntimeModel: (next) => {
      params.harness.runtimeModel = next;
    },
    getEffectiveModel: () => params.harness.effectiveModel,
    setEffectiveModel: (next) => {
      params.harness.effectiveModel = next;
    },
    getAzaicoderKeyInfo: () => params.harness.azaicoderKeyInfo as never,
    setAzaicoderKeyInfo: (next) => {
      params.harness.azaicoderKeyInfo = next;
    },
    getLastProfileId: () => params.harness.lastProfileId,
    setLastProfileId: (next) => {
      params.harness.lastProfileId = next;
    },
    getRuntimeAuthState: () => params.harness.runtimeAuthState as never,
    setRuntimeAuthState: (next) => {
      params.harness.runtimeAuthState = next;
    },
    getRuntimeAuthRefreshCancelled: () => false,
    setRuntimeAuthRefreshCancelled: () => undefined,
    getProfileIndex: () => params.harness.profileIndex,
    setProfileIndex: (next) => {
      params.harness.profileIndex = next;
    },
    setThinkLevel: () => undefined,
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: params.warn ?? (() => undefined),
    },
  });
}

describe("createEmbeddedRunAuthController", () => {
  beforeEach(() => {
    mocks.prepareProviderRuntimeAuth.mockReset();
    mocks.getAzaicoderKeyForModel.mockReset();
  });

  it("applies runtime request overrides on the first auth exchange", async () => {
    // Provider runtime auth can replace baseUrl, headers, and runtime API key in
    // one exchange; both runtime and effective models must see the override.
    const harness = createMutableAuthControllerHarness();
    const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();

    mocks.getAzaicoderKeyForModel.mockResolvedValue({
      azaicoderKey: "source-azaicoder-key",
      mode: "azaicoder-key",
      profileId: "default",
      source: "env",
    });
    mocks.prepareProviderRuntimeAuth.mockResolvedValue({
      azaicoderKey: "runtime-azaicoder-key",
      baseUrl: "https://runtime.example.com/v1",
      request: {
        auth: {
          mode: "header",
          headerName: "azaicoder-key",
          value: "runtime-header-token",
        },
      },
    });

    const controller = createMutableEmbeddedRunAuthController({
      harness,
      setRuntimeAzaicoderKey,
    });

    await controller.initializeAuthProfile();

    const azaicoderKeyParams = mocks.getAzaicoderKeyForModel.mock.calls.at(0)?.[0] as
      | { agentDir?: string; workspaceDir?: string }
      | undefined;
    expect(azaicoderKeyParams?.agentDir).toBe("/tmp/agent");
    expect(azaicoderKeyParams?.workspaceDir).toBe("/tmp/workspace");
    expect(harness.runtimeModel.baseUrl).toBe("https://runtime.example.com/v1");
    expect(harness.runtimeModel.headers).toEqual({
      "azaicoder-key": "runtime-header-token",
    });
    expect(harness.effectiveModel.baseUrl).toBe("https://runtime.example.com/v1");
    expect(harness.effectiveModel.headers).toEqual({
      "azaicoder-key": "runtime-header-token",
    });
    expect(setRuntimeAzaicoderKey).toHaveBeenCalledWith("custom-openai", "runtime-azaicoder-key");
    expect(harness.runtimeAuthState?.sourceAzaicoderKey).toBe("source-azaicoder-key");
    expect(harness.runtimeAuthState?.authMode).toBe("azaicoder-key");
    expect(harness.runtimeAuthState?.profileId).toBe("default");
  });

  it("includes the checked credential source when an azaicoder key is missing", async () => {
    const harness = createMutableAuthControllerHarness();
    const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();

    mocks.getAzaicoderKeyForModel.mockResolvedValue({
      mode: "azaicoder-key",
      source: "models.providers.custom-openai",
    });

    const controller = createMutableEmbeddedRunAuthController({
      harness,
      setRuntimeAzaicoderKey,
    });

    await expect(controller.initializeAuthProfile()).rejects.toThrow(
      'No API key resolved for provider "custom-openai" (auth mode: azaicoder-key, checked: models.providers.custom-openai).',
    );
    expect(setRuntimeAzaicoderKey).not.toHaveBeenCalled();
    expect(harness.azaicoderKeyInfo).toMatchObject({
      mode: "azaicoder-key",
      source: "models.providers.custom-openai",
    });
  });

  it("preserves OAuth mode when billing-disabled profiles are all unavailable", async () => {
    const harness = createMutableAuthControllerHarness();
    const profileId = "custom-openai:oauth";
    const controller = createMutableEmbeddedRunAuthController({
      harness,
      setRuntimeAzaicoderKey: vi.fn(),
      profileCandidates: [profileId],
      fallbackConfigured: true,
      authStore: {
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "custom-openai",
            access: "access-token",
            refresh: "refresh-token",
            exzaicoderres: Date.now() + 60_000,
          },
        },
        usageStats: {
          [profileId]: {
            disabledUntil: Date.now() + 60_000,
            disabledReason: "billing",
          },
        },
      },
    });

    const error = await controller.initializeAuthProfile().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(FailoverError);
    expect(error).toMatchObject({
      reason: "billing",
      authMode: "oauth",
    });
  });

  it("rejects privileged runtime transport overrides on the first auth exchange", async () => {
    let runtimeModel = createTestModel();

    mocks.getAzaicoderKeyForModel.mockResolvedValue({
      azaicoderKey: "source-azaicoder-key",
      mode: "azaicoder-key",
      profileId: "default",
      source: "env",
    });
    mocks.prepareProviderRuntimeAuth.mockResolvedValue({
      azaicoderKey: "runtime-azaicoder-key",
      request: {
        proxy: {
          mode: "explicit-proxy",
          url: "http://proxy.internal:8443",
        },
      },
    });

    const controller = createEmbeddedRunAuthController({
      config: undefined,
      agentDir: "/tmp/agent",
      workspaceDir: "/tmp/workspace",
      authStore: {
        version: 1,
        profiles: {},
      } as AuthProfileStore,
      authStorage: {
        setRuntimeAzaicoderKey: vi.fn<(provider: string, azaicoderKey: string) => void>(),
      },
      profileCandidates: ["default"],
      initialThinkLevel: "medium",
      attemptedThinking: new Set(),
      fallbackConfigured: false,
      allowTransientCooldownProbe: false,
      getProvider: () => "custom-openai",
      getModelId: () => "test-model",
      getRuntimeModel: () => runtimeModel,
      setRuntimeModel: (next) => {
        runtimeModel = next;
      },
      getEffectiveModel: () => runtimeModel,
      setEffectiveModel: () => undefined,
      getAzaicoderKeyInfo: () => null as never,
      setAzaicoderKeyInfo: () => undefined,
      getLastProfileId: () => undefined,
      setLastProfileId: () => undefined,
      getRuntimeAuthState: () => null,
      setRuntimeAuthState: () => undefined,
      getRuntimeAuthRefreshCancelled: () => false,
      setRuntimeAuthRefreshCancelled: () => undefined,
      getProfileIndex: () => 0,
      setProfileIndex: () => undefined,
      setThinkLevel: () => undefined,
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
    });

    await expect(controller.initializeAuthProfile()).rejects.toThrow(
      /runtime auth request overrides do not allow proxy or tls/i,
    );
  });

  it("ignores stale scheduled refresh results after auth profile rotation", async () => {
    vi.useFakeTimers();
    try {
      const harness = createMutableAuthControllerHarness();
      const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();
      const staleRefresh = createDeferred<{
        azaicoderKey: string;
        baseUrl: string;
        request: {
          auth: {
            mode: "header";
            headerName: string;
            value: string;
          };
        };
        exzaicoderresAt: number;
      }>();

      mocks.getAzaicoderKeyForModel.mockImplementation(async ({ profileId }) => {
        if (profileId === "backup") {
          return {
            azaicoderKey: "backup-source-azaicoder-key",
            mode: "azaicoder-key",
            profileId: "backup",
            source: "env",
          };
        }
        return {
          azaicoderKey: "default-source-azaicoder-key",
          mode: "azaicoder-key",
          profileId: "default",
          source: "env",
        };
      });
      mocks.prepareProviderRuntimeAuth.mockImplementation(async ({ context }) => {
        if (context.azaicoderKey === "default-source-azaicoder-key" && context.profileId === "default") {
          if (harness.runtimeAuthState?.refreshInFlight) {
            return staleRefresh.promise;
          }
          return {
            azaicoderKey: "default-runtime-azaicoder-key",
            baseUrl: "https://default-runtime.example.com/v1",
            request: {
              auth: {
                mode: "header",
                headerName: "azaicoder-key",
                value: "default-runtime-header-token",
              },
            },
            exzaicoderresAt: Date.now() + 60_000,
          };
        }
        if (context.azaicoderKey === "backup-source-azaicoder-key" && context.profileId === "backup") {
          return {
            azaicoderKey: "backup-runtime-azaicoder-key",
            baseUrl: "https://backup-runtime.example.com/v1",
            request: {
              auth: {
                mode: "header",
                headerName: "azaicoder-key",
                value: "backup-runtime-header-token",
              },
            },
            exzaicoderresAt: Date.now() + 120_000,
          };
        }
        throw new Error(`Unexpected runtime auth request for ${String(context.profileId)}`);
      });

      const controller = createMutableEmbeddedRunAuthController({
        harness,
        setRuntimeAzaicoderKey,
        profileCandidates: ["default", "backup"],
      });

      await controller.initializeAuthProfile();
      expect(getRuntimeAuthSnapshot(harness.runtimeAuthState)?.profileId).toBe("default");

      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      const refreshInFlight = getRuntimeAuthSnapshot(harness.runtimeAuthState)?.refreshInFlight;
      expect(typeof refreshInFlight?.then).toBe("function");

      await controller.advanceAuthProfile();
      expect(getRuntimeAuthSnapshot(harness.runtimeAuthState)?.profileId).toBe("backup");
      expect(harness.runtimeModel.baseUrl).toBe("https://backup-runtime.example.com/v1");
      expect(harness.runtimeModel.headers).toEqual({
        "azaicoder-key": "backup-runtime-header-token",
      });

      staleRefresh.resolve({
        azaicoderKey: "default-runtime-azaicoder-key-refreshed",
        baseUrl: "https://default-refresh.example.com/v1",
        request: {
          auth: {
            mode: "header",
            headerName: "azaicoder-key",
            value: "default-refresh-header-token",
          },
        },
        exzaicoderresAt: Date.now() + 30_000,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(getRuntimeAuthSnapshot(harness.runtimeAuthState)?.profileId).toBe("backup");
      expect(harness.runtimeModel.baseUrl).toBe("https://backup-runtime.example.com/v1");
      expect(harness.runtimeModel.headers).toEqual({
        "azaicoder-key": "backup-runtime-header-token",
      });
      expect(setRuntimeAzaicoderKey).toHaveBeenLastCalledWith("custom-openai", "backup-runtime-azaicoder-key");
      controller.stopRuntimeAuthRefreshTimer();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("aws-sdk auth without explicit API key (IMDS / instance role)", () => {
    it("injects runtime auth when prepareProviderRuntimeAuth resolves credentials", async () => {
      const harness = createMutableAuthControllerHarness();
      const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();

      mocks.getAzaicoderKeyForModel.mockResolvedValue({
        azaicoderKey: undefined,
        mode: "aws-sdk",
        source: "aws-sdk default chain",
      });
      mocks.prepareProviderRuntimeAuth.mockResolvedValue({
        azaicoderKey: "imds-runtime-token",
        exzaicoderresAt: Date.now() + 3600_000,
      });

      const controller = createMutableEmbeddedRunAuthController({
        harness,
        setRuntimeAzaicoderKey,
        profileCandidates: [undefined as unknown as string],
      });

      await controller.initializeAuthProfile();

      expect(setRuntimeAzaicoderKey).toHaveBeenCalledWith("custom-openai", "imds-runtime-token");
      expect(harness.runtimeAuthState?.sourceAzaicoderKey).toBe("__aws_sdk_auth__");
      expect(harness.runtimeAuthState?.authMode).toBe("aws-sdk");
      expect(harness.runtimeAuthState?.exzaicoderresAt).toBeGreaterThan(Date.now());
      controller.stopRuntimeAuthRefreshTimer();
    });

    it("injects sentinel when prepareProviderRuntimeAuth returns no azaicoderKey", async () => {
      const harness = createMutableAuthControllerHarness();
      const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();

      mocks.getAzaicoderKeyForModel.mockResolvedValue({
        azaicoderKey: undefined,
        mode: "aws-sdk",
        source: "aws-sdk default chain",
      });
      mocks.prepareProviderRuntimeAuth.mockResolvedValue(null);

      const controller = createMutableEmbeddedRunAuthController({
        harness,
        setRuntimeAzaicoderKey,
        profileCandidates: [undefined as unknown as string],
      });

      await controller.initializeAuthProfile();

      expect(setRuntimeAzaicoderKey).toHaveBeenCalledWith("custom-openai", "__aws_sdk_auth__");
      expect(harness.runtimeAuthState).toBeNull();
    });

    it("clears any stale refresh timer before sentinel injection", async () => {
      vi.useFakeTimers();
      try {
        const harness = createMutableAuthControllerHarness();
        const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();

        harness.runtimeAuthState = {
          generation: 1,
          sourceAzaicoderKey: "__aws_sdk_auth__",
          authMode: "aws-sdk",
          refreshTimer: setTimeout(() => undefined, 60_000),
        };

        mocks.getAzaicoderKeyForModel.mockResolvedValue({
          azaicoderKey: undefined,
          mode: "aws-sdk",
          source: "aws-sdk default chain",
        });
        mocks.prepareProviderRuntimeAuth.mockResolvedValue(null);

        const controller = createMutableEmbeddedRunAuthController({
          harness,
          setRuntimeAzaicoderKey,
          profileCandidates: [undefined as unknown as string],
        });

        await controller.initializeAuthProfile();

        expect(setRuntimeAzaicoderKey).toHaveBeenCalledWith("custom-openai", "__aws_sdk_auth__");
        expect(harness.runtimeAuthState).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("injects sentinel when prepareProviderRuntimeAuth throws", async () => {
      const harness = createMutableAuthControllerHarness();
      const setRuntimeAzaicoderKey = vi.fn<(provider: string, azaicoderKey: string) => void>();
      const warn = vi.fn<(message: string) => void>();

      mocks.getAzaicoderKeyForModel.mockResolvedValue({
        azaicoderKey: undefined,
        mode: "aws-sdk",
        source: "aws-sdk default chain",
      });
      mocks.prepareProviderRuntimeAuth.mockRejectedValue(new Error("No runtime auth plugin"));

      const controller = createMutableEmbeddedRunAuthController({
        harness,
        setRuntimeAzaicoderKey,
        profileCandidates: [undefined as unknown as string],
        warn,
      });

      await controller.initializeAuthProfile();

      expect(setRuntimeAzaicoderKey).toHaveBeenCalledWith("custom-openai", "__aws_sdk_auth__");
      expect(harness.runtimeAuthState).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "prepareProviderRuntimeAuth failed for custom-openai, falling back to sentinel: No runtime auth plugin",
      );
    });
  });
});
