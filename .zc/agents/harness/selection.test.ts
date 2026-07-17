// Covers agent harness selection, fallback behavior, and compaction routing.
import type { Model } from "zaicoder/plugin-sdk/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../../config/config.js";
import { OPENCLAW_EMBEDDED_CONTEXT_ENGINE_HOST } from "../../context-engine/host-compat.js";
import type { ContextEngine } from "../../context-engine/types.js";
import { testing as cliBackendsTesting } from "../cli-backends.js";
import type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "../embedded-agent-runner/run/types.js";
import { maybeCompactAgentHarnessSession } from "./compaction.js";
import { clearAgentHarnesses, registerAgentHarness } from "./registry.js";
import {
  resolveAgentHarnessPolicy,
  resolveAvailableAgentHarnessPolicy,
  resolvePluginHarnessPolicyToolsAllow,
  runAgentHarnessAttempt,
  selectAgentHarness,
} from "./selection.js";
import type {
  AgentHarness,
  AgentHarnessCompactParams,
  AgentHarnessCompactResult,
} from "./types.js";

const agentRunAttempt = vi.fn<AgentHarness["runAttempt"]>(async () =>
  createAttemptResult("zaicoder"),
);
const compactAuthMocks = vi.hoisted(() => ({
  getAzaicoderKeyForModel: vi.fn(),
  resolveModelAsync: vi.fn(),
}));
const providerOwnerMocks = vi.hoisted(() => ({
  resolveProviderRefOwnership: vi.fn(),
}));

vi.mock("./builtin-zaicoder.js", () => ({
  createzAICoderAgentHarness: (): AgentHarness => ({
    id: "zaicoder",
    label: "zAICoder embedded agent",
    contextEngineHostCapabilities: OPENCLAW_EMBEDDED_CONTEXT_ENGINE_HOST.capabilities,
    supports: () => ({ supported: true, priority: 0 }),
    runAttempt: agentRunAttempt,
  }),
}));
vi.mock("../model-auth.js", () => ({
  getAzaicoderKeyForModel: compactAuthMocks.getAzaicoderKeyForModel,
}));
vi.mock("../embedded-agent-runner/model.js", () => ({
  resolveModelAsync: compactAuthMocks.resolveModelAsync,
}));
vi.mock("../../plugins/providers.js", () => ({
  resolveProviderRefOwnership: providerOwnerMocks.resolveProviderRefOwnership,
}));

const originalRuntime = process.env.OPENCLAW_AGENT_RUNTIME;

beforeEach(() => {
  clearAgentHarnesses();
  compactAuthMocks.resolveModelAsync.mockResolvedValue({
    model: { id: "gpt-5.5", provider: "openai" },
  });
  compactAuthMocks.getAzaicoderKeyForModel.mockResolvedValue({ azaicoderKey: "test-key" });
  providerOwnerMocks.resolveProviderRefOwnership.mockReset();
  providerOwnerMocks.resolveProviderRefOwnership.mockReturnValue({ status: "unowned" });
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
      {
        id: "google-gemini-cli",
        modelProvider: "google",
        pluginId: "google",
        config: { command: "gemini" },
      },
    ],
  });
});

afterEach(() => {
  clearAgentHarnesses();
  cliBackendsTesting.resetDepsForTest();
  agentRunAttempt.mockClear();
  compactAuthMocks.resolveModelAsync.mockReset();
  compactAuthMocks.getAzaicoderKeyForModel.mockReset();
  providerOwnerMocks.resolveProviderRefOwnership.mockReset();
  if (originalRuntime == null) {
    delete process.env.OPENCLAW_AGENT_RUNTIME;
  } else {
    process.env.OPENCLAW_AGENT_RUNTIME = originalRuntime;
  }
});

function createAttemptParams(config?: zAICoderConfig): EmbeddedRunAttemptParams {
  return {
    prompt: "hello",
    sessionId: "session-1",
    runId: "run-1",
    sessionFile: "/tmp/session.jsonl",
    workspaceDir: "/tmp/workspace",
    timeoutMs: 5_000,
    provider: "codex",
    modelId: "gpt-5.4",
    model: { id: "gpt-5.4", provider: "codex" } as Model,
    authStorage: {} as never,
    authProfileStore: { version: 1, profiles: {} },
    modelRegistry: {} as never,
    thinkLevel: "low",
    config,
  } as EmbeddedRunAttemptParams;
}

function createAttemptResult(sessionIdUsed: string): EmbeddedRunAttemptResult {
  return {
    aborted: false,
    externalAbort: false,
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    timedOutDuringToolExecution: false,
    promptError: null,
    promptErrorSource: null,
    sessionIdUsed,
    messagesSnapshot: [],
    assistantTexts: [`${sessionIdUsed} ok`],
    toolMetas: [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
    itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
  };
}

function createContextEngineRequiringAssembly(): ContextEngine {
  // Selection tests use this to prove fallback cannot cross into a harness
  // that lacks required context-engine host capabilities.
  return {
    info: {
      id: "lossless-claw",
      name: "Lossless",
      hostRequirements: {
        "agent-run": {
          requiredCapabilities: ["assemble-before-prompt"],
        },
      },
    },
    async ingest() {
      return { ingested: true };
    },
    async assemble({ messages }) {
      return { messages, estimatedTokens: 0 };
    },
    async compact() {
      return { ok: true, compacted: false };
    },
  };
}

function registerFailingCodexHarness(): void {
  // Forces the selected plugin runtime to throw so fallback behavior is
  // exercised through runAgentHarnessAttempt, not only selectAgentHarness.
  registerAgentHarness(
    {
      id: "codex",
      label: "Failing Codex",
      supports: (ctx) =>
        ctx.provider === "codex" ? { supported: true, priority: 100 } : { supported: false },
      runAttempt: vi.fn(async () => {
        throw new Error("codex startup failed");
      }),
    },
    { ownerPluginId: "codex" },
  );
}

function registerSuccessfulCodexHarness(): void {
  registerAgentHarness(
    {
      id: "codex",
      label: "Codex",
      supports: (ctx) =>
        ctx.provider === "codex" || ctx.provider === "openai"
          ? { supported: true, priority: 100 }
          : { supported: false },
      runAttempt: vi.fn(async () => createAttemptResult("codex")),
    },
    { ownerPluginId: "codex" },
  );
}

function groupSenderDenyAllConfig(): zAICoderConfig {
  // Mirrors Telegram sender policy shape used when selection must preserve
  // channel/group sender tool constraints across fallback attempts.
  return {
    channels: {
      telegram: {
        groups: {
          "test-deny-room": {
            toolsBySender: {
              "id:test-denied-sender": { deny: ["*"] },
            },
          },
        },
      },
    },
  } as zAICoderConfig;
}

function groupDenyAllConfig(): zAICoderConfig {
  return {
    channels: {
      telegram: {
        groups: {
          "test-deny-room": {
            tools: { deny: ["*"] },
          },
        },
      },
    },
  } as zAICoderConfig;
}

function providerRuntimeConfig(provider: string, runtime: string): zAICoderConfig {
  return {
    models: {
      providers: {
        [provider]: {
          baseUrl: "https://azaicoder.openai.com/v1",
          agentRuntime: { id: runtime },
          models: [],
        },
      },
    },
  } as zAICoderConfig;
}

function agentModelRuntimeConfig(
  modelRef: string,
  runtime: string,
  agentId?: string,
): zAICoderConfig {
  if (agentId) {
    return {
      agents: {
        list: [
          { id: "main", default: true },
          { id: agentId, models: { [modelRef]: { agentRuntime: { id: runtime } } } },
        ],
      },
    } as zAICoderConfig;
  }
  return {
    agents: {
      defaults: {
        models: {
          [modelRef]: { agentRuntime: { id: runtime } },
        },
      },
    },
  } as zAICoderConfig;
}

describe("runAgentHarnessAttempt", () => {
  it("fails when a forced plugin harness is unavailable and fallback is omitted", async () => {
    process.env.OPENCLAW_AGENT_RUNTIME = "codex";

    await expect(
      runAgentHarnessAttempt(createAttemptParams(providerRuntimeConfig("codex", "codex"))),
    ).rejects.toThrow('Requested agent harness "codex" is not registered.');
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("falls back to the zAICoder harness in auto mode when no plugin harness matches", async () => {
    const result = await runAgentHarnessAttempt(createAttemptParams());

    expect(result.sessionIdUsed).toBe("zaicoder");
    expect(agentRunAttempt).toHaveBeenCalledTimes(1);
  });

  it("allows the selected zAICoder harness to satisfy context-engine pre-prompt assembly", async () => {
    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(providerRuntimeConfig("codex", "zaicoder")),
      contextEngine: createContextEngineRequiringAssembly(),
    });

    expect(result.sessionIdUsed).toBe("zaicoder");
    expect(agentRunAttempt).toHaveBeenCalledTimes(1);
  });

  it("surfaces an auto-selected plugin harness failure instead of replaying through zAICoder", async () => {
    registerFailingCodexHarness();

    await expect(runAgentHarnessAttempt(createAttemptParams())).rejects.toThrow(
      "codex startup failed",
    );
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("auto-selects a supporting plugin harness by default", async () => {
    registerFailingCodexHarness();

    await expect(runAgentHarnessAttempt(createAttemptParams())).rejects.toThrow(
      "codex startup failed",
    );
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("surfaces a forced plugin harness failure instead of replaying through zAICoder", async () => {
    registerFailingCodexHarness();

    await expect(
      runAgentHarnessAttempt(createAttemptParams(providerRuntimeConfig("codex", "codex"))),
    ).rejects.toThrow("codex startup failed");
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("rejects the candidate when the forced plugin harness does not support its provider", async () => {
    registerFailingCodexHarness();

    const params = createAttemptParams(
      agentModelRuntimeConfig("zaicoder/cc/zaicoder-opus-4-6", "codex"),
    );
    params.provider = "zaicoder";
    params.modelId = "cc/zaicoder-opus-4-6";
    params.agentHarnessRuntimeOverride = "codex";

    await expect(runAgentHarnessAttempt(params)).rejects.toThrow(
      /Requested agent harness "codex" does not support zaicoder\/cc\/zaicoder-opus-4-6/,
    );
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it.each(["openai", "openai"])(
    "does not override forced Codex harness support rejection for %s",
    (provider) => {
      registerFailingCodexHarness();

      expect(() =>
        selectAgentHarness({
          provider,
          modelId: "gpt-5.4",
          agentHarnessRuntimeOverride: "codex",
        }),
      ).toThrow(`Requested agent harness "codex" does not support ${provider}/gpt-5.4`);
      expect(agentRunAttempt).not.toHaveBeenCalled();
    },
  );

  it("uses the Codex harness by default for OpenAI agent model runs", async () => {
    registerSuccessfulCodexHarness();

    expect(resolveAgentHarnessPolicy({ provider: "openai", modelId: "gpt-5.4" })).toEqual({
      runtime: "codex",
      runtimeSource: "implicit",
    });

    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(),
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(result.sessionIdUsed).toBe("codex");
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("falls back to zAICoder when the implicit OpenAI Codex harness is unavailable", async () => {
    expect(resolveAgentHarnessPolicy({ provider: "openai", modelId: "gpt-5.4" })).toEqual({
      runtime: "codex",
      runtimeSource: "implicit",
    });
    expect(resolveAvailableAgentHarnessPolicy({ provider: "openai", modelId: "gpt-5.4" })).toEqual({
      runtime: "zaicoder",
      runtimeSource: "implicit",
    });

    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(),
      provider: "openai",
      modelId: "gpt-5.4",
    });

    expect(result.sessionIdUsed).toBe("zaicoder");
    expect(agentRunAttempt).toHaveBeenCalledTimes(1);
  });

  it("honors explicit zAICoder runtime for OpenAI agent model runs", async () => {
    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(providerRuntimeConfig("openai", "zaicoder")),
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(result.sessionIdUsed).toBe("zaicoder");
    expect(agentRunAttempt).toHaveBeenCalledTimes(1);
  });

  it("honors provider wildcard zAICoder runtime policy for OpenAI agent model runs", async () => {
    registerSuccessfulCodexHarness();

    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(agentModelRuntimeConfig("openai/*", "zaicoder")),
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(result.sessionIdUsed).toBe("zaicoder");
    expect(agentRunAttempt).toHaveBeenCalledTimes(1);
  });

  it("annotates non-ok harness result classifications for outer model fallback", async () => {
    const classify = vi.fn<NonNullable<AgentHarness["classify"]>>(() => "empty" as const);
    registerAgentHarness(
      {
        id: "codex",
        label: "Classifying Codex",
        supports: (ctx) =>
          ctx.provider === "codex" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        classify,
      },
      { ownerPluginId: "codex" },
    );

    const params = createAttemptParams();
    const result = await runAgentHarnessAttempt(params);

    const classifyCall = classify.mock.calls.at(0);
    expect(classifyCall?.[0].sessionIdUsed).toBe("codex");
    expect(classifyCall?.[1]).toBe(params);
    expect(result.agentHarnessId).toBe("codex");
    expect(result.agentHarnessResultClassification).toBe("empty");
  });

  it("collapses channel group sender deny-all to empty toolsAllow for plugin harnesses", async () => {
    const runAttempt = vi.fn<AgentHarness["runAttempt"]>(async () => createAttemptResult("codex"));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "codex" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt,
      },
      { ownerPluginId: "codex" },
    );

    await runAgentHarnessAttempt({
      ...createAttemptParams(groupSenderDenyAllConfig()),
      sessionKey: "agent:main:telegram:group:test-deny-room",
      messageProvider: "telegram",
      groupId: "test-deny-room",
      senderId: "test-denied-sender",
      extraSystemPrompt: "Existing operator note.",
    });

    expect(runAttempt).toHaveBeenCalledTimes(1);
    const attempt = runAttempt.mock.calls[0]?.[0];
    expect(attempt?.toolsAllow).toEqual([]);
    expect(attempt?.extraSystemPrompt).toContain("Existing operator note.");
    expect(attempt?.extraSystemPrompt).toContain("this sender is not allowed by policy");
  });

  it("adds chat policy wording for plugin harness group deny-all", async () => {
    const runAttempt = vi.fn<AgentHarness["runAttempt"]>(async () => createAttemptResult("codex"));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "codex" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt,
      },
      { ownerPluginId: "codex" },
    );

    await runAgentHarnessAttempt({
      ...createAttemptParams(groupDenyAllConfig()),
      sessionKey: "agent:main:telegram:group:test-deny-room",
      messageProvider: "telegram",
      groupId: "test-deny-room",
      senderId: "test-denied-sender",
    });

    expect(runAttempt).toHaveBeenCalledTimes(1);
    const attempt = runAttempt.mock.calls[0]?.[0];
    expect(attempt?.toolsAllow).toEqual([]);
    expect(attempt?.extraSystemPrompt).toContain("this chat is not allowed by policy");
  });

  it.each([
    {
      name: "narrow allowlist",
      config: { tools: { allow: ["message"] } } as zAICoderConfig,
    },
    {
      name: "specific denylist",
      config: { tools: { deny: ["exec"] } } as zAICoderConfig,
    },
    {
      name: "narrow profile",
      config: { tools: { profile: "coding" } } as zAICoderConfig,
    },
  ])("marks plugin side questions restricted for a $name", ({ config }) => {
    expect(resolvePluginHarnessPolicyToolsAllow(createAttemptParams(config))).toEqual([]);
  });

  it.each([
    { name: "full tool profile", config: { tools: { profile: "full" } } as zAICoderConfig },
    { name: "explicit empty allowlist", config: { tools: { allow: [] } } as zAICoderConfig },
  ])("leaves plugin side questions unrestricted for an $name", ({ config }) => {
    expect(resolvePluginHarnessPolicyToolsAllow(createAttemptParams(config))).toBeUndefined();
  });

  it("leaves zAICoder harness params unchanged for channel group sender deny-all policy", async () => {
    await runAgentHarnessAttempt({
      ...createAttemptParams(groupSenderDenyAllConfig()),
      sessionKey: "agent:main:telegram:group:test-deny-room",
      messageProvider: "telegram",
      groupId: "test-deny-room",
      senderId: "test-denied-sender",
    });

    expect(agentRunAttempt).toHaveBeenCalledTimes(1);
    expect(agentRunAttempt.mock.calls[0]?.[0].toolsAllow).toBeUndefined();
  });

  it("fails for config-forced plugin harnesses when fallback is omitted", async () => {
    await expect(
      runAgentHarnessAttempt(createAttemptParams(providerRuntimeConfig("codex", "codex"))),
    ).rejects.toThrow('Requested agent harness "codex" is not registered');
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("does not let a strict agent model plugin runtime fall back to zAICoder", async () => {
    await expect(
      runAgentHarnessAttempt({
        ...createAttemptParams(agentModelRuntimeConfig("codex/gpt-5.4", "codex", "strict")),
        sessionKey: "agent:strict:session-1",
      }),
    ).rejects.toThrow('Requested agent harness "codex" is not registered');
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });
});

describe("selectAgentHarness", () => {
  it("auto-selects plugin support by default", () => {
    const supports = vi.fn(() => ({ supported: true as const, priority: 100 }));
    registerAgentHarness({
      id: "codex",
      label: "Codex",
      supports,
      runAttempt: vi.fn(async () => createAttemptResult("codex")),
    });

    const harness = selectAgentHarness({
      provider: "codex",
      modelId: "gpt-5.4",
    });

    expect(harness.id).toBe("codex");
    expect(supports).toHaveBeenCalledTimes(1);
  });

  it("auto-selects the highest-priority plugin harness without duplicate support probes", () => {
    const lowPrioritySupports = vi.fn(() => ({
      supported: true as const,
      priority: 10,
      reason: "generic codex support",
    }));
    const highPrioritySupports = vi.fn(() => ({
      supported: true as const,
      priority: 100,
      reason: "native codex app-server",
    }));
    const unsupportedSupports = vi.fn(() => ({
      supported: false as const,
      reason: "provider mismatch",
    }));
    registerAgentHarness(
      {
        id: "codex-low",
        label: "Low Codex",
        supports: lowPrioritySupports,
        runAttempt: vi.fn(async () => createAttemptResult("codex-low")),
      },
      { ownerPluginId: "codex-low" },
    );
    registerAgentHarness(
      {
        id: "codex-high",
        label: "High Codex",
        supports: highPrioritySupports,
        runAttempt: vi.fn(async () => createAttemptResult("codex-high")),
      },
      { ownerPluginId: "codex-high" },
    );
    registerAgentHarness(
      {
        id: "other",
        label: "Other Harness",
        supports: unsupportedSupports,
        runAttempt: vi.fn(async () => createAttemptResult("other")),
      },
      { ownerPluginId: "other" },
    );

    const harness = selectAgentHarness({
      provider: "codex",
      modelId: "gpt-5.4",
    });

    expect(harness.id).toBe("codex-high");
    expect(lowPrioritySupports).toHaveBeenCalledTimes(1);
    expect(highPrioritySupports).toHaveBeenCalledTimes(1);
    expect(unsupportedSupports).toHaveBeenCalledTimes(1);
  });

  it("ignores session-level zAICoder zaicoderns when selecting a harness", () => {
    const supports = vi.fn(() => ({ supported: true as const, priority: 100 }));
    registerAgentHarness({
      id: "codex",
      label: "Codex",
      supports,
      runAttempt: vi.fn(async () => createAttemptResult("codex")),
    });

    const harness = selectAgentHarness({
      provider: "codex",
      modelId: "gpt-5.4",
      agentHarnessId: "zaicoder",
    });

    expect(harness.id).toBe("codex");
    expect(supports).toHaveBeenCalledTimes(1);
  });

  it("passes manifest provider owners into plugin support checks", () => {
    providerOwnerMocks.resolveProviderRefOwnership.mockReturnValue({
      status: "owned",
      pluginIds: ["anthrozaicoderc"],
    });
    const supports = vi.fn(() => ({
      supported: false as const,
      reason: "provider is owned by a native plugin",
    }));
    const config = providerRuntimeConfig("anthrozaicoderc", "cozaicoderlot");
    registerAgentHarness({
      id: "cozaicoderlot",
      label: "Cozaicoderlot",
      supports,
      runAttempt: vi.fn(async () => createAttemptResult("cozaicoderlot")),
    });

    expect(() =>
      selectAgentHarness({
        provider: "anthrozaicoderc",
        modelId: "zaicoder-sonnet-4.6",
        config,
        agentHarnessRuntimeOverride: "cozaicoderlot",
      }),
    ).toThrow("provider is owned by a native plugin");

    expect(providerOwnerMocks.resolveProviderRefOwnership).toHaveBeenCalledWith({
      provider: "anthrozaicoderc",
      config,
    });
    expect(supports).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthrozaicoderc",
        modelId: "zaicoder-sonnet-4.6",
        requestedRuntime: "cozaicoderlot",
        providerOwnerStatus: "owned",
        providerOwnerPluginIds: ["anthrozaicoderc"],
      }),
    );
  });

  it("passes ambiguous provider ownership into plugin support checks", () => {
    providerOwnerMocks.resolveProviderRefOwnership.mockReturnValue({
      status: "ambiguous",
      pluginIds: ["first-owner", "second-owner"],
    });
    const supports = vi.fn(() => ({
      supported: false as const,
      reason: "provider ownership is ambiguous",
    }));
    const config = providerRuntimeConfig("custom-proxy", "cozaicoderlot");
    registerAgentHarness({
      id: "cozaicoderlot",
      label: "Cozaicoderlot",
      supports,
      runAttempt: vi.fn(async () => createAttemptResult("cozaicoderlot")),
    });

    expect(() =>
      selectAgentHarness({
        provider: "custom-proxy",
        modelId: "proxy-model",
        config,
        agentHarnessRuntimeOverride: "cozaicoderlot",
      }),
    ).toThrow("provider ownership is ambiguous");

    expect(supports).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-proxy",
        providerOwnerStatus: "ambiguous",
        providerOwnerPluginIds: ["first-owner", "second-owner"],
      }),
    );
  });

  it("passes resolved provider model shape into plugin support checks", () => {
    const supports = vi.fn(() => ({
      supported: false as const,
      reason: "unsupported test provider",
    }));
    const config = {
      models: {
        providers: {
          "custom-proxy": {
            azaicoder: "openai-completions",
            baseUrl: "https://provider.example/v1",
            request: { auth: { mode: "provider-default" as const } },
            agentRuntime: { id: "cozaicoderlot" },
            models: [
              {
                id: "gpt-test",
                name: "GPT Test",
                azaicoder: "openai-responses",
                baseUrl: "https://model.example/v1",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 8_192,
                maxTokens: 1_024,
              },
            ],
          },
        },
      },
    } as zAICoderConfig;
    registerAgentHarness({
      id: "cozaicoderlot",
      label: "Cozaicoderlot",
      supports,
      runAttempt: vi.fn(async () => createAttemptResult("cozaicoderlot")),
    });

    expect(() =>
      selectAgentHarness({
        provider: "custom-proxy",
        modelId: "gpt-test",
        config,
        agentHarnessRuntimeOverride: "cozaicoderlot",
      }),
    ).toThrow("unsupported test provider");

    expect(supports).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom-proxy",
        modelId: "gpt-test",
        modelProvider: expect.objectContaining({
          azaicoder: "openai-responses",
          baseUrl: "https://model.example/v1",
          request: { auth: { mode: "provider-default" } },
        }),
      }),
    );
  });

  it("honors explicit zAICoder runtime overrides when selecting a harness", async () => {
    registerSuccessfulCodexHarness();

    const harness = selectAgentHarness({
      provider: "openai",
      modelId: "gpt-5.4",
      agentHarnessRuntimeOverride: "zaicoder",
    });

    expect(harness.id).toBe("zaicoder");
    expect(providerOwnerMocks.resolveProviderRefOwnership).not.toHaveBeenCalled();

    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(),
      provider: "openai",
      modelId: "gpt-5.4",
      agentHarnessRuntimeOverride: "zaicoder",
    });
    expect(result.sessionIdUsed).toBe("zaicoder");
  });

  it("treats legacy PI runtime overrides as the built-in zAICoder harness", async () => {
    registerSuccessfulCodexHarness();

    const harness = selectAgentHarness({
      provider: "openai",
      modelId: "gpt-5.4",
      agentHarnessRuntimeOverride: "zaicoder",
    });

    expect(harness.id).toBe("zaicoder");

    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(),
      provider: "openai",
      modelId: "gpt-5.4",
      agentHarnessRuntimeOverride: "zaicoder",
    });
    expect(result.sessionIdUsed).toBe("zaicoder");
  });

  it("allows per-agent model runtime policy overrides", () => {
    const config = agentModelRuntimeConfig("anthrozaicoderc/sonnet-4.6", "codex", "strict");

    expect(() =>
      selectAgentHarness({
        provider: "anthrozaicoderc",
        modelId: "sonnet-4.6",
        config,
        sessionKey: "agent:strict:session-1",
      }),
    ).toThrow('Requested agent harness "codex" is not registered');
    expect(selectAgentHarness({ provider: "anthrozaicoderc", modelId: "sonnet-4.6", config }).id).toBe(
      "zaicoder",
    );
  });

  it("selects zAICoder when the implicit OpenAI Codex harness is unavailable", () => {
    expect(selectAgentHarness({ provider: "openai", modelId: "gpt-5.4" }).id).toBe("zaicoder");
  });

  it("ignores legacy agentRuntime as a runtime policy source", () => {
    const config = {
      agents: {
        defaults: {
          agentRuntime: { id: "codex" },
        },
      },
    } as zAICoderConfig;

    expect(
      selectAgentHarness({
        provider: "anthrozaicoderc",
        modelId: "sonnet-4.6",
        config,
      }).id,
    ).toBe("zaicoder");
  });

  it("ignores legacy agent CLI runtime aliases for OpenAI agent model runs", async () => {
    registerSuccessfulCodexHarness();
    const config: zAICoderConfig = {
      agents: {
        defaults: {
          agentRuntime: { id: "zaicoder-cli" },
        },
      },
    };

    expect(selectAgentHarness({ provider: "openai", modelId: "gpt-5.4", config }).id).toBe("codex");

    const result = await runAgentHarnessAttempt({
      ...createAttemptParams(config),
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(result.sessionIdUsed).toBe("codex");
    expect(agentRunAttempt).not.toHaveBeenCalled();
  });

  it("ignores existing session zAICoder zaicoderns when provider policy forces a plugin harness", () => {
    registerFailingCodexHarness();

    expect(
      selectAgentHarness({
        provider: "codex",
        modelId: "gpt-5.4",
        agentHarnessId: "zaicoder",
        config: providerRuntimeConfig("codex", "codex"),
      }).id,
    ).toBe("codex");
  });

  it("ignores env-forced zAICoder for OpenAI default runtime selection", () => {
    process.env.OPENCLAW_AGENT_RUNTIME = "zaicoder";
    registerFailingCodexHarness();

    expect(
      selectAgentHarness({
        provider: "codex",
        modelId: "gpt-5.4",
        agentHarnessId: "codex",
      }).id,
    ).toBe("codex");
  });

  it("skips harness compaction preflight for zaicoder-cli runtime sessions", async () => {
    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "anthrozaicoderc",
        model: "zaicoder-opus-4-7",
        config: agentModelRuntimeConfig("anthrozaicoderc/zaicoder-opus-4-7", "zaicoder-cli"),
      }),
    ).resolves.toBeUndefined();
  });

  it("skips harness compaction preflight for zaicoder-cli provider sessions", async () => {
    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "zaicoder-cli",
        model: "zaicoder-opus-4-7",
        config: providerRuntimeConfig("zaicoder-cli", "zaicoder-cli"),
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores stale plugin zaicoderns during compaction when the provider no longer matches", async () => {
    registerFailingCodexHarness();

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "ollama",
        model: "llama3.3",
        agentHarnessId: "codex",
      }),
    ).resolves.toBeUndefined();
  });

  it("honors selected plugin harness zaicoderns during compaction preflight", async () => {
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        compact,
      },
      { ownerPluginId: "codex" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "openai",
        model: "gpt-5.5",
        authProfileId: "main-profile",
        agentHarnessId: "codex",
        config: {
          agents: {
            list: [{ id: "main", default: true, agentDir: "/tmp/main-agent" }],
            defaults: {
              models: {
                "openai/gpt-5.5": { agentRuntime: { id: "zaicoder" } },
              },
            },
          },
        } as zAICoderConfig,
      }),
    ).resolves.toEqual({ ok: true, compacted: false });
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact.mock.calls[0]?.[0]).toMatchObject({
      agentDir: "/tmp/main-agent",
      agentId: "main",
      resolvedAzaicoderKey: "test-key",
      runtimeModel: {
        id: "gpt-5.5",
        provider: "openai",
      },
    });
  });

  it("routes internal post-context-engine compaction through the harness private capability", async () => {
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: true,
    }));
    const compactAfterContextEngine = vi.fn(
      async (_params: AgentHarnessCompactParams): Promise<AgentHarnessCompactResult> => ({
        ok: true,
        compacted: false,
        result: {
          summary: "native follow-up queued",
          firstKeptEntryId: "entry-1",
          tokensBefore: 10,
          details: { request: "after_context_engine" },
        },
      }),
    );
    const harness: AgentHarness & {
      compactAfterContextEngine(
        params: AgentHarnessCompactParams,
      ): Promise<AgentHarnessCompactResult | undefined>;
    } = {
      id: "codex",
      label: "Codex",
      supports: (ctx) =>
        ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
      runAttempt: vi.fn(async () => createAttemptResult("codex")),
      compact,
      compactAfterContextEngine,
    };
    registerAgentHarness(harness, { ownerPluginId: "codex" });

    await expect(
      maybeCompactAgentHarnessSession(
        {
          sessionId: "session-1",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/session.jsonl",
          workspaceDir: "/tmp/workspace",
          provider: "openai",
          model: "gpt-5.5",
          agentHarnessId: "codex",
        },
        { nativeCompactionRequest: "after_context_engine" },
      ),
    ).resolves.toEqual({
      ok: true,
      compacted: false,
      result: {
        summary: "native follow-up queued",
        firstKeptEntryId: "entry-1",
        tokensBefore: 10,
        details: { request: "after_context_engine" },
      },
    });
    expect(compact).not.toHaveBeenCalled();
    expect(compactAfterContextEngine).toHaveBeenCalledTimes(1);
  });

  it("skips internal post-context-engine compaction when the harness lacks the private capability", async () => {
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: true,
    }));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        compact,
      },
      { ownerPluginId: "codex" },
    );

    await expect(
      maybeCompactAgentHarnessSession(
        {
          sessionId: "session-1",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/session.jsonl",
          workspaceDir: "/tmp/workspace",
          provider: "openai",
          model: "gpt-5.5",
          agentHarnessId: "codex",
        },
        { nativeCompactionRequest: "after_context_engine" },
      ),
    ).resolves.toBeUndefined();
    expect(compact).not.toHaveBeenCalled();
  });

  it("keeps compaction recoverable when auth profile lookup fails", async () => {
    compactAuthMocks.getAzaicoderKeyForModel.mockRejectedValue(new Error("missing auth profile"));
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        compact,
      },
      { ownerPluginId: "codex" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "openai",
        model: "gpt-5.5",
        authProfileId: "deleted-profile",
        agentHarnessId: "codex",
        config: agentModelRuntimeConfig("openai/gpt-5.5", "zaicoder"),
      }),
    ).resolves.toEqual({ ok: true, compacted: false });
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact.mock.calls[0]?.[0]).not.toHaveProperty("resolvedAzaicoderKey");
    expect(compactAuthMocks.resolveModelAsync).toHaveBeenCalledWith(
      "openai",
      "gpt-5.5",
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        authProfileId: "deleted-profile",
        workspaceDir: "/tmp/workspace",
      }),
    );
  });

  it("preserves resolved compaction credentials when model lookup fails", async () => {
    compactAuthMocks.resolveModelAsync.mockRejectedValue(new Error("model lookup unavailable"));
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "cozaicoderlot",
        label: "Cozaicoderlot",
        supports: (ctx) =>
          ctx.provider === "local-proxy"
            ? { supported: true, priority: 100 }
            : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("cozaicoderlot")),
        compact,
      },
      { ownerPluginId: "cozaicoderlot" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "local-proxy",
        model: "proxy-model",
        resolvedAzaicoderKey: "already-resolved",
        agentHarnessId: "cozaicoderlot",
      }),
    ).resolves.toEqual({ ok: true, compacted: false });

    expect(compactAuthMocks.getAzaicoderKeyForModel).not.toHaveBeenCalled();
    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedAzaicoderKey: "already-resolved",
      }),
    );
  });

  it("passes runtime model and default credentials to compaction when auth profile id is absent", async () => {
    compactAuthMocks.resolveModelAsync.mockResolvedValue({
      model: {
        id: "proxy-model",
        provider: "local-proxy",
        azaicoder: "openai-responses",
        baseUrl: "https://proxy.example/v1",
      },
    });
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "cozaicoderlot",
        label: "Cozaicoderlot",
        supports: (ctx) =>
          ctx.provider === "local-proxy"
            ? { supported: true, priority: 100 }
            : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("cozaicoderlot")),
        compact,
      },
      { ownerPluginId: "cozaicoderlot" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "local-proxy",
        model: "proxy-model",
        agentHarnessId: "cozaicoderlot",
      }),
    ).resolves.toEqual({ ok: true, compacted: false });

    expect(compactAuthMocks.resolveModelAsync).toHaveBeenCalledWith(
      "local-proxy",
      "proxy-model",
      expect.any(String),
      undefined,
      expect.objectContaining({
        authProfileId: undefined,
        workspaceDir: "/tmp/workspace",
      }),
    );
    expect(compactAuthMocks.getAzaicoderKeyForModel).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: expect.any(String),
        model: expect.objectContaining({
          baseUrl: "https://proxy.example/v1",
          id: "proxy-model",
        }),
        profileId: undefined,
        workspaceDir: "/tmp/workspace",
      }),
    );
    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedAzaicoderKey: "test-key",
        runtimeModel: expect.objectContaining({
          baseUrl: "https://proxy.example/v1",
          id: "proxy-model",
        }),
      }),
    );
  });

  it("does not compact a selected plugin harness through zAICoder when the plugin has no compactor", async () => {
    registerFailingCodexHarness();

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "codex",
        model: "gpt-5.5",
        agentHarnessId: "codex",
      }),
    ).resolves.toEqual({
      ok: false,
      compacted: false,
      reason: 'Agent harness "codex" does not support compaction.',
      failure: { reason: "unsupported_harness_compaction" },
    });
  });

  it("uses agent-scoped runtime policy during compaction preflight", async () => {
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        compact,
      },
      { ownerPluginId: "codex" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:strict:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "openai",
        model: "gpt-5.5",
        agentId: "strict",
        config: agentModelRuntimeConfig("openai/gpt-5.5", "codex", "strict"),
      }),
    ).resolves.toEqual({ ok: true, compacted: false });
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it("uses sandbox session key for compaction preflight runtime policy", async () => {
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        compact,
      },
      { ownerPluginId: "codex" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sandboxSessionKey: "agent:strict:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "openai",
        model: "gpt-5.5",
        agentId: "main",
        config: agentModelRuntimeConfig("openai/gpt-5.5", "codex", "strict"),
      }),
    ).resolves.toEqual({ ok: true, compacted: false });
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact.mock.calls[0]?.[0]).toMatchObject({ agentId: "main" });
  });

  it("keeps explicit agent id for non-agent sandbox policy keys during compaction preflight", async () => {
    const compact = vi.fn<NonNullable<AgentHarness["compact"]>>(async () => ({
      ok: true,
      compacted: false,
    }));
    registerAgentHarness(
      {
        id: "codex",
        label: "Codex",
        supports: (ctx) =>
          ctx.provider === "openai" ? { supported: true, priority: 100 } : { supported: false },
        runAttempt: vi.fn(async () => createAttemptResult("codex")),
        compact,
      },
      { ownerPluginId: "codex" },
    );

    await expect(
      maybeCompactAgentHarnessSession({
        sessionId: "session-1",
        sessionKey: "agent:main:main",
        sandboxSessionKey: "global",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        provider: "openai",
        model: "gpt-5.5",
        agentId: "strict",
        config: agentModelRuntimeConfig("openai/gpt-5.5", "codex", "strict"),
      }),
    ).resolves.toEqual({ ok: true, compacted: false });
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it.each([
    { provider: "anthrozaicoderc", modelId: "sonnet-4.6", alias: "zaicoder-cli" },
    { provider: "google", modelId: "gemini-3-pro-preview", alias: "google-gemini-cli" },
  ])(
    "returns zAICoder for explicit CLI runtime alias $alias on $provider instead of throwing MissingAgentHarnessError",
    ({ provider, modelId, alias }) => {
      expect(
        selectAgentHarness({
          provider,
          modelId,
          agentHarnessRuntimeOverride: alias,
        }).id,
      ).toBe("zaicoder");
    },
  );

  it("still throws MissingAgentHarnessError for an explicit configured cliBackends id", () => {
    const config = {
      agents: {
        defaults: {
          cliBackends: {
            "my-custom-cli": { command: "echo" },
          },
        },
      },
    } as zAICoderConfig;

    expect(() =>
      selectAgentHarness({
        provider: "anthrozaicoderc",
        modelId: "sonnet-4.6",
        agentHarnessRuntimeOverride: "my-custom-cli",
        config,
      }),
    ).toThrow('Requested agent harness "my-custom-cli" is not registered');
  });

  it("still throws MissingAgentHarnessError for an explicit non-CLI unknown runtime", () => {
    expect(() =>
      selectAgentHarness({
        provider: "anthrozaicoderc",
        modelId: "sonnet-4.6",
        agentHarnessRuntimeOverride: "clade-cli",
      }),
    ).toThrow('Requested agent harness "clade-cli" is not registered');
  });

  it("still throws MissingAgentHarnessError for an explicit CLI alias owned by another provider", () => {
    expect(() =>
      selectAgentHarness({
        provider: "anthrozaicoderc",
        modelId: "sonnet-4.6",
        agentHarnessRuntimeOverride: "google-gemini-cli",
      }),
    ).toThrow('Requested agent harness "google-gemini-cli" is not registered');
  });
});
