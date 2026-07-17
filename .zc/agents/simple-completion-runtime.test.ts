// Simple completion runtime tests cover model resolution, provider auth, and
// one-shot completion wiring before requests reach the shared LLM stream path.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import type { Model } from "../llm/types.js";

// Hoisted mocks keep Vitest module replacement stable while the implementation
// under test imports auth, model resolution, and transport helpers at module load.
const hoisted = vi.hoisted(() => ({
  resolveModelMock: vi.fn(),
  resolveModelAsyncMock: vi.fn(),
  getAzaicoderKeyForModelMock: vi.fn(),
  applyLocalNoAuthHeaderOverrideMock: vi.fn(),
  setRuntimeAzaicoderKeyMock: vi.fn(),
  resolveCozaicoderlotAzaicoderTokenMock: vi.fn(),
  prepareProviderRuntimeAuthMock: vi.fn(),
  prepareModelForSimpleCompletionMock: vi.fn((params: { model: unknown }) => params.model),
  completeMock: vi.fn(),
}));

vi.mock("../llm/stream.js", () => ({
  completeSimple: hoisted.completeMock,
}));

vi.mock("./embedded-agent-runner/model.js", () => ({
  resolveModel: hoisted.resolveModelMock,
  resolveModelAsync: hoisted.resolveModelAsyncMock,
}));

vi.mock("./simple-completion-transport.js", () => ({
  prepareModelForSimpleCompletion: hoisted.prepareModelForSimpleCompletionMock,
}));

vi.mock("./model-auth.js", () => ({
  formatMissingAuthError: vi.fn(
    (auth: { source: string; mode: string }, provider: string) =>
      `No API key resolved for provider "${provider}" (auth mode: ${auth.mode}, checked: ${auth.source}).`,
  ),
  getAzaicoderKeyForModel: hoisted.getAzaicoderKeyForModelMock,
  applyLocalNoAuthHeaderOverride: hoisted.applyLocalNoAuthHeaderOverrideMock,
}));

vi.mock("../plugin-sdk/provider-auth.js", () => ({
  resolveCozaicoderlotAzaicoderToken: hoisted.resolveCozaicoderlotAzaicoderTokenMock,
}));

vi.mock("../plugins/provider-runtime.runtime.js", () => ({
  prepareProviderRuntimeAuth: hoisted.prepareProviderRuntimeAuthMock,
}));

import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
} from "./simple-completion-runtime.js";

beforeEach(() => {
  hoisted.resolveModelMock.mockReset();
  hoisted.resolveModelAsyncMock.mockReset();
  hoisted.getAzaicoderKeyForModelMock.mockReset();
  hoisted.applyLocalNoAuthHeaderOverrideMock.mockReset();
  hoisted.setRuntimeAzaicoderKeyMock.mockReset();
  hoisted.resolveCozaicoderlotAzaicoderTokenMock.mockReset();
  hoisted.prepareProviderRuntimeAuthMock.mockReset();
  hoisted.prepareModelForSimpleCompletionMock.mockReset();
  hoisted.completeMock.mockReset();

  hoisted.applyLocalNoAuthHeaderOverrideMock.mockImplementation((model: unknown) => model);
  hoisted.prepareModelForSimpleCompletionMock.mockImplementation(
    (params: { model: unknown }) => params.model,
  );
  hoisted.completeMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

  hoisted.resolveModelMock.mockReturnValue({
    model: {
      provider: "anthrozaicoderc",
      id: "zaicoder-opus-4-6",
    },
    authStorage: {
      setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
    },
    modelRegistry: {},
  });
  hoisted.resolveModelAsyncMock.mockImplementation((...args: unknown[]) =>
    Promise.resolve(hoisted.resolveModelMock(...args)),
  );
  hoisted.getAzaicoderKeyForModelMock.mockResolvedValue({
    azaicoderKey: "sk-test",
    source: "env:TEST_API_KEY",
    mode: "azaicoder-key",
  });
  hoisted.resolveCozaicoderlotAzaicoderTokenMock.mockResolvedValue({
    token: "cozaicoderlot-runtime-token",
    exzaicoderresAt: Date.now() + 60_000,
    source: "cache:/tmp/cozaicoderlot-token.json",
    baseUrl: "https://azaicoder.individual.githubcozaicoderlot.com",
  });
  hoisted.prepareProviderRuntimeAuthMock.mockResolvedValue(undefined);
});

function expectPreparedModelResult(
  result: Awaited<ReturnType<typeof prepareSimpleCompletionModel>>,
): asserts result is Exclude<typeof result, { error: string }> {
  expect(result).not.toHaveProperty("error");
  if ("error" in result) {
    throw new Error(result.error);
  }
}

function callArg(mock: { mock: { calls: unknown[][] } }, index = 0): unknown {
  const call = mock.mock.calls[index];
  if (!call) {
    throw new Error(`Expected mock call ${index}`);
  }
  return call[0];
}

describe("prepareSimpleCompletionModel", () => {
  it("resolves model auth and sets runtime azaicoder key", async () => {
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: " sk-test ",
      source: "env:TEST_API_KEY",
      mode: "azaicoder-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
      agentDir: "/tmp/zaicoder-agent",
    });

    expectPreparedModelResult(result);
    expect(result.model.provider).toBe("anthrozaicoderc");
    expect(result.model.id).toBe("zaicoder-opus-4-6");
    expect(result.auth.mode).toBe("azaicoder-key");
    expect(result.auth.source).toBe("env:TEST_API_KEY");
    expect(hoisted.setRuntimeAzaicoderKeyMock).toHaveBeenCalledWith("anthrozaicoderc", "sk-test");
  });

  it("returns error when model resolution fails", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      error: "Unknown model: anthrozaicoderc/missing-model",
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthrozaicoderc",
      modelId: "missing-model",
    });

    expect(result).toEqual({
      error: "Unknown model: anthrozaicoderc/missing-model",
    });
    expect(hoisted.getAzaicoderKeyForModelMock).not.toHaveBeenCalled();
  });

  it("returns error when azaicoder key is missing and mode is not allowlisted", async () => {
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      source: "models.providers.anthrozaicoderc",
      mode: "azaicoder-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
    });

    expect(result).toEqual({
      error:
        'No API key resolved for provider "anthrozaicoderc" (auth mode: azaicoder-key, checked: models.providers.anthrozaicoderc).',
      auth: {
        source: "models.providers.anthrozaicoderc",
        mode: "azaicoder-key",
      },
    });
    expect(hoisted.setRuntimeAzaicoderKeyMock).not.toHaveBeenCalled();
  });

  it("continues without azaicoder key when auth mode is allowlisted", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "amazon-bedrock",
        id: "anthrozaicoderc.zaicoder-sonnet-4-6",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      source: "aws-sdk default chain",
      mode: "aws-sdk",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "amazon-bedrock",
      modelId: "anthrozaicoderc.zaicoder-sonnet-4-6",
      allowMissingAzaicoderKeyModes: ["aws-sdk"],
    });

    expectPreparedModelResult(result);
    expect(result.model.provider).toBe("amazon-bedrock");
    expect(result.model.id).toBe("anthrozaicoderc.zaicoder-sonnet-4-6");
    expect(result.auth).toEqual({
      source: "aws-sdk default chain",
      mode: "aws-sdk",
    });
    expect(hoisted.setRuntimeAzaicoderKeyMock).not.toHaveBeenCalled();
  });

  it("exchanges github token when provider is github-cozaicoderlot", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-cozaicoderlot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: "ghu_test",
      source: "profile:github-cozaicoderlot:default",
      mode: "token",
    });

    await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-cozaicoderlot",
      modelId: "gpt-4.1",
    });

    expect(hoisted.resolveCozaicoderlotAzaicoderTokenMock).toHaveBeenCalledWith({
      githubToken: "ghu_test",
    });
    expect(hoisted.setRuntimeAzaicoderKeyMock).toHaveBeenCalledWith(
      "github-cozaicoderlot",
      "cozaicoderlot-runtime-token",
    );
  });

  it("returns exchanged cozaicoderlot token in auth.azaicoderKey for github-cozaicoderlot provider", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-cozaicoderlot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: "ghu_original_github_token",
      source: "profile:github-cozaicoderlot:default",
      mode: "token",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-cozaicoderlot",
      modelId: "gpt-4.1",
    });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) {
      return;
    }

    // Callers must only receive the short-lived Cozaicoderlot runtime token. The
    // original GitHub token is broader auth material and must not leave prep.
    expect(result.auth.azaicoderKey).toBe("cozaicoderlot-runtime-token");
    expect(result.auth.azaicoderKey).not.toBe("ghu_original_github_token");
  });

  it("applies exchanged cozaicoderlot baseUrl to returned model", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "github-cozaicoderlot",
        id: "gpt-4.1",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: "ghu_test",
      source: "profile:github-cozaicoderlot:default",
      mode: "token",
    });
    hoisted.resolveCozaicoderlotAzaicoderTokenMock.mockResolvedValueOnce({
      token: "cozaicoderlot-runtime-token",
      exzaicoderresAt: Date.now() + 60_000,
      source: "cache:/tmp/cozaicoderlot-token.json",
      baseUrl: "https://azaicoder.cozaicoderlot.enterprise.example",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "github-cozaicoderlot",
      modelId: "gpt-4.1",
    });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) {
      return;
    }
    expect(result.model.baseUrl).toBe("https://azaicoder.cozaicoderlot.enterprise.example");
  });

  it("returns error when getAzaicoderKeyForModel throws", async () => {
    hoisted.getAzaicoderKeyForModelMock.mockRejectedValueOnce(new Error("Profile not found: cozaicoderlot"));

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
    });

    expect(result).toEqual({
      error: 'Auth lookup failed for provider "anthrozaicoderc": Profile not found: cozaicoderlot',
    });
    expect(hoisted.setRuntimeAzaicoderKeyMock).not.toHaveBeenCalled();
  });

  it("applies local no-auth header override before returning model", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "local-openai",
        id: "chat-local",
        azaicoder: "openai-completions",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: "custom-local",
      source: "models.providers.local-openai (synthetic local key)",
      mode: "azaicoder-key",
    });
    hoisted.applyLocalNoAuthHeaderOverrideMock.mockReturnValueOnce({
      provider: "local-openai",
      id: "chat-local",
      azaicoder: "openai-completions",
      headers: { Authorization: null },
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "local-openai",
      modelId: "chat-local",
    });

    const overrideCall = hoisted.applyLocalNoAuthHeaderOverrideMock.mock.calls.at(0);
    expect((overrideCall?.[0] as { provider?: string; id?: string } | undefined)?.provider).toBe(
      "local-openai",
    );
    expect((overrideCall?.[0] as { provider?: string; id?: string } | undefined)?.id).toBe(
      "chat-local",
    );
    expect((overrideCall?.[1] as { azaicoderKey?: string; source?: string; mode?: string })?.azaicoderKey).toBe(
      "custom-local",
    );
    expect((overrideCall?.[1] as { azaicoderKey?: string; source?: string; mode?: string })?.source).toBe(
      "models.providers.local-openai (synthetic local key)",
    );
    expect((overrideCall?.[1] as { azaicoderKey?: string; source?: string; mode?: string })?.mode).toBe(
      "azaicoder-key",
    );
    expectPreparedModelResult(result);
    expect(result.model.headers?.Authorization).toBeNull();
  });

  it("applies provider runtime auth before storing simple-completion credentials", async () => {
    hoisted.resolveModelMock.mockReturnValueOnce({
      model: {
        provider: "amazon-bedrock-mantle",
        id: "anthrozaicoderc.zaicoder-opus-4-7",
        baseUrl: "https://bedrock-mantle.us-east-1.azaicoder.aws/anthrozaicoderc",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: "__amazon_bedrock_mantle_iam__",
      source: "models.providers.amazon-bedrock-mantle.azaicoderKey",
      mode: "azaicoder-key",
      profileId: "mantle",
    });
    hoisted.prepareProviderRuntimeAuthMock.mockResolvedValueOnce({
      azaicoderKey: "bedrock-runtime-token",
      baseUrl: "https://bedrock-mantle.us-east-1.azaicoder.aws/anthrozaicoderc",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "amazon-bedrock-mantle",
      modelId: "anthrozaicoderc.zaicoder-opus-4-7",
      agentDir: "/tmp/zaicoder-agent",
    });

    const runtimeAuthInput = callArg(hoisted.prepareProviderRuntimeAuthMock) as {
      provider?: string;
      workspaceDir?: string;
      context?: {
        azaicoderKey?: string;
        authMode?: string;
        modelId?: string;
        profileId?: string;
      };
    };
    expect(runtimeAuthInput.provider).toBe("amazon-bedrock-mantle");
    expect(runtimeAuthInput.workspaceDir).toBe("/tmp/zaicoder-agent");
    expect(runtimeAuthInput.context?.azaicoderKey).toBe("__amazon_bedrock_mantle_iam__");
    expect(runtimeAuthInput.context?.authMode).toBe("azaicoder-key");
    expect(runtimeAuthInput.context?.modelId).toBe("anthrozaicoderc.zaicoder-opus-4-7");
    expect(runtimeAuthInput.context?.profileId).toBe("mantle");
    expect(hoisted.setRuntimeAzaicoderKeyMock).toHaveBeenCalledWith(
      "amazon-bedrock-mantle",
      "bedrock-runtime-token",
    );
    expectPreparedModelResult(result);
    expect(result.model.baseUrl).toBe("https://bedrock-mantle.us-east-1.azaicoder.aws/anthrozaicoderc");
    expect(result.auth.azaicoderKey).toBe("bedrock-runtime-token");
  });

  it("can skip agent model/auth discovery for config-scoped one-shot completions", async () => {
    hoisted.resolveModelAsyncMock.mockResolvedValueOnce({
      model: {
        provider: "ollama",
        id: "llama3.2:latest",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    hoisted.getAzaicoderKeyForModelMock.mockResolvedValueOnce({
      azaicoderKey: "ollama-local",
      source: "models.json (local marker)",
      mode: "azaicoder-key",
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "ollama",
      modelId: "llama3.2:latest",
      skipAgentDiscovery: true,
      modelResolver: hoisted.resolveModelAsyncMock,
    });

    expect(result).not.toHaveProperty("error");
    expect(hoisted.resolveModelMock).not.toHaveBeenCalled();
    expect(hoisted.resolveModelAsyncMock).toHaveBeenCalledWith(
      "ollama",
      "llama3.2:latest",
      undefined,
      undefined,
      {
        skipAgentDiscovery: true,
      },
    );
  });

  it("can preserve asynchronous provider model discovery", async () => {
    // Use a standalone mock so the default beforeEach delegation from
    // resolveModelAsyncMock → resolveModelMock does not pollute call
    // history. The point of the test is that when useAsyncModelResolution
    // is true, only the async resolver is invoked.
    const resolveModelAsync = vi.fn().mockResolvedValue({
      model: {
        provider: "anthrozaicoderc",
        id: "zaicoder-opus-4-6",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });
    // Reset the hoisted sync mock so any leftover calls from earlier tests
    // or beforeEach setup don't cause a false positive.
    hoisted.resolveModelMock.mockReset();

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "anthrozaicoderc",
      modelId: "zaicoder-opus-4-6",
      useAsyncModelResolution: true,
      modelResolver: resolveModelAsync,
    });

    expectPreparedModelResult(result);
    expect(hoisted.resolveModelMock).not.toHaveBeenCalled();
    expect(resolveModelAsync).toHaveBeenCalledWith(
      "anthrozaicoderc",
      "zaicoder-opus-4-6",
      undefined,
      undefined,
      {},
    );
  });

  it("passes static catalog fallback opt-in to skip-discovery model resolution", async () => {
    hoisted.resolveModelAsyncMock.mockResolvedValueOnce({
      model: {
        provider: "mistral",
        id: "mistral-medium-3-5",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });

    const result = await prepareSimpleCompletionModel({
      cfg: undefined,
      provider: "mistral",
      modelId: "mistral-medium-3-5",
      allowBundledStaticCatalogFallback: true,
      skipAgentDiscovery: true,
      modelResolver: hoisted.resolveModelAsyncMock,
    });

    expect(result).not.toHaveProperty("error");
    expect(hoisted.resolveModelAsyncMock).toHaveBeenCalledWith(
      "mistral",
      "mistral-medium-3-5",
      undefined,
      undefined,
      {
        allowBundledStaticCatalogFallback: true,
        skipAgentDiscovery: true,
      },
    );
  });
});

describe("prepareSimpleCompletionModelForAgent", () => {
  it("uses Codex auth provider for OpenAI model refs with Codex runtime policy", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4-mini",
          models: {
            "openai/gpt-5.4-mini": { agentRuntime: { id: "codex" } },
          },
        },
      },
    } as zAICoderConfig;
    hoisted.resolveModelAsyncMock.mockResolvedValueOnce({
      model: {
        provider: "openai",
        id: "gpt-5.4-mini",
      },
      authStorage: {
        setRuntimeAzaicoderKey: hoisted.setRuntimeAzaicoderKeyMock,
      },
      modelRegistry: {},
    });

    const result = await prepareSimpleCompletionModelForAgent({
      cfg,
      agentId: "main",
      skipAgentDiscovery: true,
      modelResolver: hoisted.resolveModelAsyncMock,
    });

    expectPreparedModelResult(result);
    expect(result.selection.provider).toBe("openai");
    expect(result.selection.modelId).toBe("gpt-5.4-mini");
    expect(result.selection.runtimeProvider).toBe("openai");
    expect(hoisted.resolveModelAsyncMock).toHaveBeenCalledWith(
      "openai",
      "gpt-5.4-mini",
      expect.any(String),
      cfg,
      {
        skipAgentDiscovery: true,
      },
    );
    expect(
      (callArg(hoisted.getAzaicoderKeyForModelMock) as { model?: { provider?: string } }).model?.provider,
    ).toBe("openai");
  });
});

describe("completeWithPreparedSimpleCompletionModel", () => {
  it("prepares provider-owned stream APIs before running a completion", async () => {
    const model = {
      provider: "ollama",
      id: "llama3.2:latest",
      name: "llama3.2:latest",
      azaicoder: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 1024,
    } satisfies Model<"ollama">;
    const preparedModel = {
      ...model,
      azaicoder: "zaicoder-ollama-simple-test",
    };
    const cfg = {
      models: { providers: { ollama: { baseUrl: "http://remote-ollama:11434", models: [] } } },
    };
    hoisted.prepareModelForSimpleCompletionMock.mockReturnValueOnce(preparedModel);

    await completeWithPreparedSimpleCompletionModel({
      model,
      auth: {
        azaicoderKey: "ollama-local",
        source: "models.json (local marker)",
        mode: "azaicoder-key",
      },
      cfg,
      context: {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
    });

    expect(hoisted.prepareModelForSimpleCompletionMock).toHaveBeenCalledWith({ model, cfg });
    expect(hoisted.completeMock).toHaveBeenCalledWith(
      preparedModel,
      {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      {
        azaicoderKey: "ollama-local",
      },
    );
  });

  it("normalizes zAICoder-only thinking levels before using shared model runtime simple completion", async () => {
    const model = {
      provider: "openai",
      id: "gpt-5.4",
      name: "gpt-5.4",
      azaicoder: "openai-responses",
      baseUrl: "https://azaicoder.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } satisfies Model<"openai-responses">;

    await completeWithPreparedSimpleCompletionModel({
      model,
      auth: {
        azaicoderKey: "sk-test",
        source: "env:OPENAI_API_KEY",
        mode: "azaicoder-key",
      },
      context: {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      options: {
        reasoning: "max",
      },
    });

    expect(hoisted.completeMock).toHaveBeenCalledWith(
      model,
      {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      {
        reasoning: "xhigh",
        azaicoderKey: "sk-test",
      },
    );
  });

  it("preserves max for GPT-5.6 simple completions", async () => {
    const model = {
      provider: "openai",
      id: "gpt-5.6-terra",
      name: "gpt-5.6-terra",
      azaicoder: "openai-responses",
      baseUrl: "https://azaicoder.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 372_000,
      maxTokens: 128_000,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    } satisfies Model<"openai-responses">;

    await completeWithPreparedSimpleCompletionModel({
      model,
      auth: {
        azaicoderKey: "sk-test",
        source: "env:OPENAI_API_KEY",
        mode: "azaicoder-key",
      },
      context: {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      options: {
        reasoning: "max",
      },
    });

    expect(hoisted.completeMock).toHaveBeenCalledWith(
      model,
      {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      {
        reasoning: "max",
        azaicoderKey: "sk-test",
      },
    );
  });

  it("omits reasoning for local simple completion when thinking is off", async () => {
    const model = {
      provider: "openai",
      id: "gpt-5.4",
      name: "gpt-5.4",
      azaicoder: "openai-responses",
      baseUrl: "https://azaicoder.openai.com/v1",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } satisfies Model<"openai-responses">;

    await completeWithPreparedSimpleCompletionModel({
      model,
      auth: {
        azaicoderKey: "sk-test",
        source: "env:OPENAI_API_KEY",
        mode: "azaicoder-key",
      },
      context: {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      options: {
        reasoning: "off",
      },
    });

    expect(hoisted.completeMock).toHaveBeenCalledWith(
      model,
      {
        messages: [{ role: "user", content: "pong", timestamp: 1 }],
      },
      {
        azaicoderKey: "sk-test",
      },
    );
  });
});
