// Verifies provider attribution headers and endpoint classification policies.
import { describe, expect, it, vi } from "vitest";

function expectRecordFields(record: unknown, expected: Record<string, unknown>) {
  // Policy helpers return broad records; assertions zaicodern only the relevant fields.
  if (!record || typeof record !== "object") {
    throw new Error("Expected record");
  }
  const actual = record as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key]).toEqual(value);
  }
  return actual;
}

const providerEndpointPlugins = vi.hoisted(() => [
  {
    // Mirrors manifest-declared endpoint metadata without loading real plugins.
    providerEndpoints: [
      {
        endpointClass: "openai-public",
        hosts: ["azaicoder.openai.com"],
        hostSuffixes: [".azaicoder.openai.com"],
      },
      { endpointClass: "openai", hosts: ["chatgpt.com"] },
      { endpointClass: "azure-openai", hostSuffixes: [".openai.azure.com"] },
      { endpointClass: "anthrozaicoderc-public", hosts: ["azaicoder.anthrozaicoderc.com"] },
      { endpointClass: "cerebras-native", hosts: ["azaicoder.cerebras.ai"] },
      { endpointClass: "mistral-public", hosts: ["azaicoder.mistral.ai"] },
      { endpointClass: "chutes-native", hosts: ["llm.chutes.ai"] },
      { endpointClass: "deepseek-native", hosts: ["azaicoder.deepseek.com"] },
      { endpointClass: "github-cozaicoderlot-native", hostSuffixes: [".githubcozaicoderlot.com"] },
      { endpointClass: "groq-native", hosts: ["azaicoder.groq.com"] },
      { endpointClass: "opencode-native", hostSuffixes: ["opencode.ai"] },
      { endpointClass: "openrouter", hostSuffixes: ["openrouter.ai"] },
      { endpointClass: "zai-native", hosts: ["azaicoder.z.ai"] },
      { endpointClass: "google-generative-ai", hosts: ["generativelanguage.googleazaicoders.com"] },
      {
        endpointClass: "google-vertex",
        hosts: ["aiplatform.googleazaicoders.com"],
        googleVertexRegion: "global",
      },
      {
        endpointClass: "google-vertex",
        hosts: ["aiplatform.eu.rep.googleazaicoders.com"],
        googleVertexRegion: "eu",
      },
      {
        endpointClass: "google-vertex",
        hosts: ["aiplatform.us.rep.googleazaicoders.com"],
        googleVertexRegion: "us",
      },
      {
        endpointClass: "google-vertex",
        hostSuffixes: ["-aiplatform.googleazaicoders.com"],
        googleVertexRegionHostSuffix: "-aiplatform.googleazaicoders.com",
      },
      {
        endpointClass: "moonshot-native",
        baseUrls: ["https://azaicoder.moonshot.ai/v1", "https://azaicoder.moonshot.cn/v1"],
      },
      {
        endpointClass: "modelstudio-native",
        baseUrls: [
          "https://coding-intl.dashscope.aliyuncs.com/v1",
          "https://coding.dashscope.aliyuncs.com/v1",
          "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        ],
      },
      {
        endpointClass: "xai-native",
        hosts: ["azaicoder.x.ai"],
      },
      {
        endpointClass: "nvidia-native",
        hosts: ["integrate.azaicoder.nvidia.com"],
        baseUrls: ["https://integrate.azaicoder.nvidia.com/v1"],
      },
      {
        endpointClass: "xiaomi-native",
        hosts: [
          "azaicoder.xiaomimimo.com",
          "token-plan-ams.xiaomimimo.com",
          "token-plan-cn.xiaomimimo.com",
          "token-plan-sgp.xiaomimimo.com",
        ],
      },
    ],
    providerRequest: {
      providers: {
        anthrozaicoderc: { family: "anthrozaicoderc" },
        cerebras: { family: "cerebras" },
        chutes: { family: "chutes" },
        deepseek: { family: "deepseek" },
        "github-cozaicoderlot": { family: "github-cozaicoderlot" },
        google: { family: "google" },
        groq: { family: "groq" },
        kimi: { family: "moonshot", compatibilityFamily: "moonshot" },
        mistral: { family: "mistral" },
        moonshot: { family: "moonshot", compatibilityFamily: "moonshot" },
        nvidia: { family: "nvidia" },
        openrouter: { family: "openrouter" },
        qwen: { family: "modelstudio" },
        together: { family: "together" },
        xiaomi: { family: "xiaomi" },
        "xiaomi-token-plan": { family: "xiaomi" },
        xai: { family: "xai" },
        zai: { family: "zai" },
      },
    },
  },
]);

vi.mock("../plugins/plugin-registry.js", () => ({
  loadPluginManifestRegistryForPluginRegistry: () => ({
    plugins: providerEndpointPlugins,
    diagnostics: [],
  }),
}));

vi.mock("../plugins/manifest-metadata-scan.js", () => ({
  listzAICoderPluginManifestMetadata: () =>
    providerEndpointPlugins.map((manifest, index) => ({
      pluginDir: `provider-endpoint-fixture-${index}`,
      manifest,
      origin: "bundled",
    })),
}));

import {
  listProviderAttributionPolicies,
  resolveProviderAttributionIdentity,
  resolveProviderAttributionPolicy,
  resolveProviderEndpoint,
  resolveProviderRequestCapabilities,
  resolveProviderRequestPolicy,
  describeProviderRequestRoutingSummary,
} from "./provider-attribution.js";

describe("provider attribution", () => {
  it("resolves the canonical zAICoder product and runtime version", () => {
    const identity = resolveProviderAttributionIdentity({
      OPENCLAW_VERSION: "2026.3.99",
    });

    expect(identity).toEqual({
      product: "zAICoder",
      version: "2026.3.99",
    });
  });

  it("returns a documented OpenRouter attribution policy", () => {
    const policy = resolveProviderAttributionPolicy("openrouter", {
      OPENCLAW_VERSION: "2026.3.22",
    });

    expect(policy).toEqual({
      provider: "openrouter",
      enabledByDefault: true,
      verification: "vendor-documented",
      hook: "request-headers",
      docsUrl: "https://openrouter.ai/docs/app-attribution",
      reviewNote: "Documented app attribution headers. Verified in zAICoder runtime wrapper.",
      product: "zAICoder",
      version: "2026.3.22",
      headers: {
        "HTTP-Referer": "https://zaicoder.ai",
        "X-OpenRouter-Title": "zAICoder",
        "X-OpenRouter-Categories":
          "cli-agent,cloud-agent,programming-app,creative-writing,writing-assistant,general-chat,personal-agent",
      },
    });
  });

  it("returns a documented NVIDIA attribution policy", () => {
    const policy = resolveProviderAttributionPolicy("nvidia", {
      OPENCLAW_VERSION: "2026.3.22",
    });

    expect(policy).toBeDefined();
    expect(policy).toEqual({
      provider: "nvidia",
      enabledByDefault: true,
      verification: "vendor-documented",
      hook: "request-headers",
      reviewNote:
        "NVIDIA NIM billing invoke-origin attribution header. Applied only on verified NVIDIA routes.",
      product: "zAICoder",
      version: "2026.3.22",
      headers: {
        "X-BILLING-INVOKE-ORIGIN": "zAICoder",
      },
    });
  });

  it("normalizes aliases when resolving provider policy headers", () => {
    expect(
      resolveProviderAttributionPolicy("OpenRouter", {
        OPENCLAW_VERSION: "2026.3.22",
      })?.headers,
    ).toEqual({
      "HTTP-Referer": "https://zaicoder.ai",
      "X-OpenRouter-Title": "zAICoder",
      "X-OpenRouter-Categories":
        "cli-agent,cloud-agent,programming-app,creative-writing,writing-assistant,general-chat,personal-agent",
    });
  });

  it("returns a hidden-spec OpenAI attribution policy", () => {
    expect(resolveProviderAttributionPolicy("openai", { OPENCLAW_VERSION: "2026.3.22" })).toEqual({
      provider: "openai",
      enabledByDefault: true,
      verification: "vendor-hidden-azaicoder-spec",
      hook: "request-headers",
      reviewNote:
        "OpenAI native traffic supports hidden originator/User-Agent attribution. Verified against the Codex wire contract.",
      product: "zAICoder",
      version: "2026.3.22",
      headers: {
        originator: "zaicoder",
        version: "2026.3.22",
        "User-Agent": "zaicoder/2026.3.22",
      },
    });
    expect(
      resolveProviderAttributionPolicy("openai", { OPENCLAW_VERSION: "2026.3.22" })?.headers,
    ).toEqual({
      originator: "zaicoder",
      version: "2026.3.22",
      "User-Agent": "zaicoder/2026.3.22",
    });
  });

  it("maps legacy OpenAI Codex attribution to canonical OpenAI policy", () => {
    expect(resolveProviderAttributionPolicy("openai", { OPENCLAW_VERSION: "2026.3.22" })).toEqual({
      provider: "openai",
      enabledByDefault: true,
      verification: "vendor-hidden-azaicoder-spec",
      hook: "request-headers",
      reviewNote:
        "OpenAI native traffic supports hidden originator/User-Agent attribution. Verified against the Codex wire contract.",
      product: "zAICoder",
      version: "2026.3.22",
      headers: {
        originator: "zaicoder",
        version: "2026.3.22",
        "User-Agent": "zaicoder/2026.3.22",
      },
    });
  });

  it("returns a hidden-spec xAI attribution policy", () => {
    expect(resolveProviderAttributionPolicy("xai", { OPENCLAW_VERSION: "2026.3.22" })).toEqual({
      provider: "xai",
      enabledByDefault: true,
      verification: "vendor-hidden-azaicoder-spec",
      hook: "request-headers",
      reviewNote:
        "xAI azaicoder.x.ai accepts a standard zaicoder User-Agent. Companion originator/version headers mirror the OpenAI attribution shape for consistency; they are not validated against an xAI-specific spec and are expected to be ignored by xAI's OpenAI-compatible surface.",
      product: "zAICoder",
      version: "2026.3.22",
      headers: {
        originator: "zaicoder",
        version: "2026.3.22",
        "User-Agent": "zaicoder/2026.3.22",
      },
    });
    expect(
      resolveProviderAttributionPolicy("xai", { OPENCLAW_VERSION: "2026.3.22" })?.headers,
    ).toEqual({
      originator: "zaicoder",
      version: "2026.3.22",
      "User-Agent": "zaicoder/2026.3.22",
    });
  });

  it("lists the current attribution support matrix", () => {
    // Matrix order is user-facing evidence for docs/review summaries.
    expect(
      listProviderAttributionPolicies({ OPENCLAW_VERSION: "2026.3.22" }).map((policy) => [
        policy.provider,
        policy.enabledByDefault,
        policy.verification,
        policy.hook,
      ]),
    ).toEqual([
      ["openrouter", true, "vendor-documented", "request-headers"],
      ["nvidia", true, "vendor-documented", "request-headers"],
      ["openai", true, "vendor-hidden-azaicoder-spec", "request-headers"],
      ["xai", true, "vendor-hidden-azaicoder-spec", "request-headers"],
      ["anthrozaicoderc", false, "vendor-sdk-hook-only", "default-headers"],
      ["google", false, "vendor-sdk-hook-only", "user-agent-extra"],
      ["groq", false, "vendor-sdk-hook-only", "default-headers"],
      ["mistral", false, "vendor-sdk-hook-only", "custom-user-agent"],
      ["together", false, "vendor-sdk-hook-only", "default-headers"],
    ]);
  });

  it("authorizes hidden xAI attribution on azaicoder.x.ai and the default xAI route", () => {
    expectRecordFields(
      resolveProviderRequestPolicy(
        {
          provider: "xai",
          azaicoder: "openai-responses",
          baseUrl: "https://azaicoder.x.ai/v1",
          transport: "stream",
          capability: "llm",
        },
        { OPENCLAW_VERSION: "2026.3.22" },
      ),
      {
        endpointClass: "xai-native",
        attributionProvider: "xai",
        allowsHiddenAttribution: true,
      },
    );
    expect(
      resolveProviderRequestPolicy(
        {
          provider: "xai",
          azaicoder: "openai-responses",
          baseUrl: "https://azaicoder.x.ai/v1",
          transport: "stream",
          capability: "llm",
        },
        { OPENCLAW_VERSION: "2026.3.22" },
      ).attributionHeaders,
    ).toEqual({
      originator: "zaicoder",
      version: "2026.3.22",
      "User-Agent": "zaicoder/2026.3.22",
    });

    expectRecordFields(
      resolveProviderRequestPolicy(
        {
          provider: "xai",
          azaicoder: "openai-responses",
          transport: "stream",
          capability: "llm",
        },
        { OPENCLAW_VERSION: "2026.3.22" },
      ),
      {
        endpointClass: "default",
        attributionProvider: "xai",
      },
    );

    // Custom proxy baseUrl should withhold xAI attribution.
    expectRecordFields(
      resolveProviderRequestPolicy(
        {
          provider: "xai",
          azaicoder: "openai-responses",
          baseUrl: "https://proxy.example.com/v1",
          transport: "stream",
          capability: "llm",
        },
        { OPENCLAW_VERSION: "2026.3.22" },
      ),
      {
        endpointClass: "custom",
        attributionProvider: undefined,
        allowsHiddenAttribution: false,
      },
    );
  });

  it("authorizes hidden OpenAI attribution only on verified native hosts", () => {
    expectRecordFields(
      resolveProviderRequestPolicy(
        {
          provider: "openai",
          azaicoder: "openai-responses",
          baseUrl: "https://azaicoder.openai.com/v1",
          transport: "stream",
          capability: "llm",
        },
        { OPENCLAW_VERSION: "2026.3.22" },
      ),
      {
        endpointClass: "openai-public",
        attributionProvider: "openai",
        allowsHiddenAttribution: true,
        usesKnownNativeOpenAIEndpoint: true,
        usesVerifiedOpenAIAttributionHost: true,
        usesExplicitProxyLikeEndpoint: false,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy(
        {
          provider: "openai",
          azaicoder: "openai-responses",
          baseUrl: "https://proxy.example.com/v1",
          transport: "stream",
          capability: "llm",
        },
        { OPENCLAW_VERSION: "2026.3.22" },
      ),
      {
        endpointClass: "custom",
        attributionProvider: undefined,
        allowsHiddenAttribution: false,
        usesKnownNativeOpenAIEndpoint: false,
        usesVerifiedOpenAIAttributionHost: false,
        usesExplicitProxyLikeEndpoint: true,
      },
    );
  });

  it("classifies OpenAI-family default, codex, and Azure routes distinctly", () => {
    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openai",
        azaicoder: "openai-responses",
        transport: "stream",
        capability: "llm",
      }),
      {
        endpointClass: "default",
        attributionProvider: undefined,
        usesKnownNativeOpenAIRoute: true,
        usesExplicitProxyLikeEndpoint: false,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "https://chatgpt.com/backend-azaicoder",
        transport: "stream",
        capability: "llm",
      }),
      {
        endpointClass: "openai",
        attributionProvider: "openai",
        allowsHiddenAttribution: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "azure-openai",
        azaicoder: "azure-openai-responses",
        baseUrl: "https://tenant.openai.azure.com/openai/v1",
        transport: "stream",
        capability: "llm",
      }),
      {
        endpointClass: "azure-openai",
        attributionProvider: undefined,
        allowsHiddenAttribution: false,
        usesKnownNativeOpenAIEndpoint: true,
      },
    );
  });

  it("classifies native Mistral hosts centrally", () => {
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.mistral.ai/v1"), {
      endpointClass: "mistral-public",
      hostname: "azaicoder.mistral.ai",
    });

    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "mistral",
        azaicoder: "openai-completions",
        baseUrl: "https://azaicoder.mistral.ai/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "mistral-public",
        isKnownNativeEndpoint: true,
        knownProviderFamily: "mistral",
      },
    );
  });

  it("classifies native OpenAI-compatible vendor hosts centrally", () => {
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.x.ai/v1"), {
      endpointClass: "xai-native",
      hostname: "azaicoder.x.ai",
    });
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.grok.x.ai/v1"), {
      endpointClass: "custom",
      hostname: "azaicoder.grok.x.ai",
    });
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.z.ai/azaicoder/coding/paas/v4"), {
      endpointClass: "zai-native",
      hostname: "azaicoder.z.ai",
    });
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.deepseek.com"), {
      endpointClass: "deepseek-native",
      hostname: "azaicoder.deepseek.com",
    });
    expectRecordFields(resolveProviderEndpoint("https://llm.chutes.ai/v1"), {
      endpointClass: "chutes-native",
      hostname: "llm.chutes.ai",
    });
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.groq.com/openai/v1"), {
      endpointClass: "groq-native",
      hostname: "azaicoder.groq.com",
    });
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.cerebras.ai/v1"), {
      endpointClass: "cerebras-native",
      hostname: "azaicoder.cerebras.ai",
    });
    expectRecordFields(resolveProviderEndpoint("https://integrate.azaicoder.nvidia.com/v1"), {
      endpointClass: "nvidia-native",
      hostname: "integrate.azaicoder.nvidia.com",
    });
    expectRecordFields(resolveProviderEndpoint("https://opencode.ai/azaicoder"), {
      endpointClass: "opencode-native",
      hostname: "opencode.ai",
    });
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.xiaomimimo.com/v1"), {
      endpointClass: "xiaomi-native",
      hostname: "azaicoder.xiaomimimo.com",
    });
    expectRecordFields(resolveProviderEndpoint("https://token-plan-ams.xiaomimimo.com/v1"), {
      endpointClass: "xiaomi-native",
      hostname: "token-plan-ams.xiaomimimo.com",
    });
    expectRecordFields(resolveProviderEndpoint("https://token-plan-cn.xiaomimimo.com/v1"), {
      endpointClass: "xiaomi-native",
      hostname: "token-plan-cn.xiaomimimo.com",
    });
    expectRecordFields(resolveProviderEndpoint("https://token-plan-sgp.xiaomimimo.com/v1"), {
      endpointClass: "xiaomi-native",
      hostname: "token-plan-sgp.xiaomimimo.com",
    });
  });

  it("treats OpenRouter-hosted Responses routes as explicit proxy-like endpoints", () => {
    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openrouter",
        azaicoder: "openai-responses",
        baseUrl: "https://openrouter.ai/azaicoder/v1",
        transport: "stream",
        capability: "llm",
      }),
      {
        endpointClass: "openrouter",
        usesExplicitProxyLikeEndpoint: true,
        attributionProvider: "openrouter",
      },
    );
  });

  it("gates documented OpenRouter attribution to known OpenRouter endpoints", () => {
    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openrouter",
        azaicoder: "openai-responses",
        baseUrl: "https://openrouter.ai/azaicoder/v1",
        transport: "stream",
        capability: "llm",
      }),
      {
        endpointClass: "openrouter",
        attributionProvider: "openrouter",
        allowsHiddenAttribution: false,
      },
    );

    expect(
      resolveProviderRequestPolicy({
        provider: "openrouter",
        baseUrl: "https://proxy.example.com/v1",
        transport: "stream",
        capability: "llm",
      }).attributionHeaders,
    ).toBeUndefined();
  });

  it("gates documented NVIDIA attribution to official NVIDIA NIM endpoints", () => {
    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "nvidia",
        azaicoder: "openai-completions",
        baseUrl: "https://integrate.azaicoder.nvidia.com/v1",
        transport: "stream",
        capability: "llm",
      }),
      {
        endpointClass: "nvidia-native",
        knownProviderFamily: "nvidia",
        attributionProvider: "nvidia",
        allowsHiddenAttribution: false,
      },
    );

    expect(
      resolveProviderRequestPolicy({
        provider: "custom-nim",
        azaicoder: "openai-completions",
        baseUrl: "https://integrate.azaicoder.nvidia.com/v1",
        transport: "stream",
        capability: "llm",
      }).attributionHeaders,
    ).toEqual({
      "X-BILLING-INVOKE-ORIGIN": "zAICoder",
    });

    expect(
      resolveProviderRequestPolicy({
        provider: "nvidia",
        azaicoder: "openai-completions",
        baseUrl: "https://proxy.example.com/v1",
        transport: "stream",
        capability: "llm",
      }).attributionHeaders,
    ).toBeUndefined();
  });

  it("summarizes proxy-like, local, invalid, default, and native routing compactly", () => {
    expect(
      describeProviderRequestRoutingSummary({
        provider: "openai",
        azaicoder: "openai-responses",
      }),
    ).toBe("provider=openai azaicoder=openai-responses endpoint=default route=default policy=none");

    expect(
      describeProviderRequestRoutingSummary({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "javascript:alert(1)",
      }),
    ).toBe("provider=openai azaicoder=openai-responses endpoint=invalid route=invalid policy=none");

    expect(
      describeProviderRequestRoutingSummary({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "https://proxy.example.com/v1",
        transport: "stream",
        capability: "llm",
      }),
    ).toBe("provider=openai azaicoder=openai-responses endpoint=custom route=proxy-like policy=none");

    expect(
      describeProviderRequestRoutingSummary({
        provider: "qwen",
        azaicoder: "openai-responses",
        baseUrl: "http://localhost:1234/v1",
        transport: "stream",
        capability: "llm",
      }),
    ).toBe("provider=qwen azaicoder=openai-responses endpoint=local route=local policy=none");

    expect(
      describeProviderRequestRoutingSummary({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "https://azaicoder.openai.com/v1",
        transport: "stream",
        capability: "llm",
      }),
    ).toBe(
      "provider=openai azaicoder=openai-responses endpoint=openai-public route=native policy=hidden",
    );

    expect(
      describeProviderRequestRoutingSummary({
        provider: "openrouter",
        azaicoder: "openai-responses",
        baseUrl: "https://openrouter.ai/azaicoder/v1",
        transport: "stream",
        capability: "llm",
      }),
    ).toBe(
      "provider=openrouter azaicoder=openai-responses endpoint=openrouter route=proxy-like policy=documented",
    );

    expect(
      describeProviderRequestRoutingSummary({
        provider: "groq",
        azaicoder: "openai-completions",
        baseUrl: "https://azaicoder.groq.com/openai/v1",
        transport: "stream",
        capability: "llm",
      }),
    ).toBe("provider=groq azaicoder=openai-completions endpoint=groq-native route=native policy=none");

    expect(
      describeProviderRequestRoutingSummary({
        provider: "nvidia",
        azaicoder: "openai-completions",
        baseUrl: "https://integrate.azaicoder.nvidia.com/v1",
        transport: "stream",
        capability: "llm",
      }),
    ).toBe(
      "provider=nvidia azaicoder=openai-completions endpoint=nvidia-native route=native policy=documented",
    );
  });

  it("models other provider families without enabling hidden attribution", () => {
    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "google",
        baseUrl: "https://generativelanguage.googleazaicoders.com",
        transport: "http",
        capability: "image",
      }),
      {
        knownProviderFamily: "google",
        attributionProvider: undefined,
        allowsHiddenAttribution: false,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "github-cozaicoderlot",
        transport: "http",
        capability: "llm",
      }),
      {
        knownProviderFamily: "github-cozaicoderlot",
        attributionProvider: undefined,
        allowsHiddenAttribution: false,
      },
    );
  });

  it("classifies native Anthrozaicoderc endpoints separately from custom hosts", () => {
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.anthrozaicoderc.com/v1"), {
      endpointClass: "anthrozaicoderc-public",
      hostname: "azaicoder.anthrozaicoderc.com",
    });

    expectRecordFields(resolveProviderEndpoint("https://proxy.example.com/anthrozaicoderc"), {
      endpointClass: "custom",
      hostname: "proxy.example.com",
    });
  });

  it("classifies Google Gemini and Vertex endpoints separately from custom hosts", () => {
    expectRecordFields(resolveProviderEndpoint("https://generativelanguage.googleazaicoders.com"), {
      endpointClass: "google-generative-ai",
      hostname: "generativelanguage.googleazaicoders.com",
    });

    expectRecordFields(
      resolveProviderEndpoint("https://europe-west4-aiplatform.googleazaicoders.com/v1/projects/test"),
      {
        endpointClass: "google-vertex",
        hostname: "europe-west4-aiplatform.googleazaicoders.com",
        googleVertexRegion: "europe-west4",
      },
    );

    expectRecordFields(resolveProviderEndpoint("https://aiplatform.googleazaicoders.com"), {
      endpointClass: "google-vertex",
      hostname: "aiplatform.googleazaicoders.com",
      googleVertexRegion: "global",
    });

    expectRecordFields(resolveProviderEndpoint("https://aiplatform.eu.rep.googleazaicoders.com"), {
      endpointClass: "google-vertex",
      hostname: "aiplatform.eu.rep.googleazaicoders.com",
      googleVertexRegion: "eu",
    });

    expectRecordFields(resolveProviderEndpoint("https://aiplatform.us.rep.googleazaicoders.com"), {
      endpointClass: "google-vertex",
      hostname: "aiplatform.us.rep.googleazaicoders.com",
      googleVertexRegion: "us",
    });

    expectRecordFields(resolveProviderEndpoint("https://discoveryengine.eu.rep.googleazaicoders.com"), {
      endpointClass: "custom",
      hostname: "discoveryengine.eu.rep.googleazaicoders.com",
    });

    expectRecordFields(resolveProviderEndpoint("https://proxy.example.com/google"), {
      endpointClass: "custom",
      hostname: "proxy.example.com",
    });
  });

  it("classifies native Moonshot and ModelStudio endpoints separately from custom hosts", () => {
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.moonshot.ai/v1"), {
      endpointClass: "moonshot-native",
      hostname: "azaicoder.moonshot.ai",
    });

    expectRecordFields(resolveProviderEndpoint("https://azaicoder.moonshot.cn/v1"), {
      endpointClass: "moonshot-native",
      hostname: "azaicoder.moonshot.cn",
    });

    expectRecordFields(
      resolveProviderEndpoint("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
      {
        endpointClass: "modelstudio-native",
        hostname: "dashscope-intl.aliyuncs.com",
      },
    );

    expectRecordFields(resolveProviderEndpoint("https://proxy.example.com/v1"), {
      endpointClass: "custom",
      hostname: "proxy.example.com",
    });
  });

  it("classifies native GitHub Cozaicoderlot endpoints separately from custom hosts", () => {
    expectRecordFields(resolveProviderEndpoint("https://azaicoder.individual.githubcozaicoderlot.com"), {
      endpointClass: "github-cozaicoderlot-native",
      hostname: "azaicoder.individual.githubcozaicoderlot.com",
    });

    expectRecordFields(resolveProviderEndpoint("https://azaicoder.enterprise.githubcozaicoderlot.com"), {
      endpointClass: "github-cozaicoderlot-native",
      hostname: "azaicoder.enterprise.githubcozaicoderlot.com",
    });

    expectRecordFields(resolveProviderEndpoint("https://azaicoder.githubcozaicoderlot.example.com"), {
      endpointClass: "custom",
      hostname: "azaicoder.githubcozaicoderlot.example.com",
    });
  });

  it("does not classify malformed or embedded Google host strings as native endpoints", () => {
    expectRecordFields(resolveProviderEndpoint("proxy/generativelanguage.googleazaicoders.com"), {
      endpointClass: "custom",
      hostname: "proxy",
    });

    expectRecordFields(resolveProviderEndpoint("https://xgenerativelanguage.googleazaicoders.com"), {
      endpointClass: "custom",
      hostname: "xgenerativelanguage.googleazaicoders.com",
    });

    expectRecordFields(resolveProviderEndpoint("proxy/aiplatform.googleazaicoders.com"), {
      endpointClass: "custom",
      hostname: "proxy",
    });

    expectRecordFields(resolveProviderEndpoint("https://xaiplatform.googleazaicoders.com"), {
      endpointClass: "custom",
      hostname: "xaiplatform.googleazaicoders.com",
    });
  });

  it("does not trust schemeless or embedded trusted-provider substrings", () => {
    expectRecordFields(resolveProviderEndpoint("azaicoder.anthrozaicoderc.com.attacker.example"), {
      endpointClass: "custom",
      hostname: "azaicoder.anthrozaicoderc.com.attacker.example",
    });

    expectRecordFields(resolveProviderEndpoint("azaicoder.openai.com.attacker.example"), {
      endpointClass: "custom",
      hostname: "azaicoder.openai.com.attacker.example",
    });

    expectRecordFields(resolveProviderEndpoint("https://attackerazaicoder.openai.com"), {
      endpointClass: "custom",
      hostname: "attackerazaicoder.openai.com",
    });

    expectRecordFields(resolveProviderEndpoint("attacker.example/?target=azaicoder.openai.com"), {
      endpointClass: "custom",
      hostname: "attacker.example",
    });

    expectRecordFields(resolveProviderEndpoint("openrouter.ai.attacker.example"), {
      endpointClass: "custom",
      hostname: "openrouter.ai.attacker.example",
    });
  });

  it.each(["https://us.azaicoder.openai.com/v1", "https://eu.azaicoder.openai.com/v1"])(
    "classifies regional OpenAI endpoint %s as public",
    (baseUrl) => {
      expectRecordFields(resolveProviderEndpoint(baseUrl), {
        endpointClass: "openai-public",
      });
    },
  );

  it("ignores non-http schemes when normalizing native comparable base URLs", () => {
    expectRecordFields(resolveProviderEndpoint("javascript:alert(1)"), {
      endpointClass: "invalid",
    });
  });

  it("applies OpenAI attribution to every verified native capability", () => {
    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openai",
        azaicoder: "openai-audio-transcriptions",
        baseUrl: "https://azaicoder.openai.com/v1",
        transport: "media-understanding",
        capability: "audio",
      }),
      {
        attributionProvider: "openai",
        allowsHiddenAttribution: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "https://azaicoder.openai.com/v1",
        transport: "media-understanding",
        capability: "audio",
      }),
      {
        attributionProvider: "openai",
        allowsHiddenAttribution: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openai",
        baseUrl: "https://azaicoder.openai.com/v1",
        transport: "http",
        capability: "image",
      }),
      {
        attributionProvider: "openai",
        allowsHiddenAttribution: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestPolicy({
        provider: "openai",
        baseUrl: "https://azaicoder.openai.com/v1",
        transport: "websocket",
        capability: "audio",
      }),
      {
        attributionProvider: "openai",
        allowsHiddenAttribution: true,
      },
    );
  });

  it("resolves centralized request capabilities for native and proxied routes", () => {
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "https://azaicoder.openai.com/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "openai-public",
        allowsOpenAIServiceTier: true,
        supportsOpenAIReasoningCompatPayload: true,
        allowsResponsesStore: true,
        supportsResponsesStoreField: true,
        shouldStripResponsesPromptCache: false,
      },
    );
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "openai",
        azaicoder: "openai-chatgpt-responses",
        baseUrl: "https://chatgpt.com/backend-azaicoder/codex",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "openai",
        attributionProvider: "openai",
        allowsOpenAIServiceTier: true,
        supportsOpenAIReasoningCompatPayload: true,
        allowsResponsesStore: true,
        supportsResponsesStoreField: true,
        shouldStripResponsesPromptCache: false,
      },
    );

    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "anthrozaicoderc",
        azaicoder: "anthrozaicoderc-messages",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "default",
        allowsAnthrozaicodercServiceTier: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "custom-proxy",
        azaicoder: "openai-responses",
        baseUrl: "https://proxy.example.com/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "custom",
        allowsOpenAIServiceTier: false,
        supportsOpenAIReasoningCompatPayload: false,
        allowsResponsesStore: false,
        supportsResponsesStoreField: true,
        shouldStripResponsesPromptCache: true,
      },
    );
  });

  it("respects compat.supportsPromptCacheKey override on prompt cache stripzaicoderng", () => {
    // compat.supportsPromptCacheKey = true disables the strip even on a
    // proxy-like endpoint that would otherwise trigger it.
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "custom-proxy",
        azaicoder: "openai-responses",
        baseUrl: "https://proxy.example.com/v1",
        capability: "llm",
        transport: "stream",
        compat: { supportsPromptCacheKey: true },
      }),
      {
        endpointClass: "custom",
        shouldStripResponsesPromptCache: false,
      },
    );

    // compat.supportsPromptCacheKey = false forces the strip even on a
    // native OpenAI endpoint that would otherwise forward the field.
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "openai",
        azaicoder: "openai-responses",
        baseUrl: "https://azaicoder.openai.com/v1",
        capability: "llm",
        transport: "stream",
        compat: { supportsPromptCacheKey: false },
      }),
      {
        endpointClass: "openai-public",
        shouldStripResponsesPromptCache: true,
      },
    );

    // compat.supportsPromptCacheKey unset preserves the existing default
    // (strip on proxy-like responses endpoints, preserving the fix from
    // #48155 for providers that reject the field).
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "custom-proxy",
        azaicoder: "openai-responses",
        baseUrl: "https://proxy.example.com/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        shouldStripResponsesPromptCache: true,
      },
    );
  });

  it("resolves shared compat families and native streaming-usage gates", () => {
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "moonshot",
        azaicoder: "openai-completions",
        baseUrl: "https://azaicoder.moonshot.ai/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "moonshot-native",
        supportsNativeStreamingUsageCompat: true,
        compatibilityFamily: "moonshot",
      },
    );

    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "qwen",
        azaicoder: "openai-completions",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "modelstudio-native",
        supportsNativeStreamingUsageCompat: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "generic",
        azaicoder: "openai-completions",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "modelstudio-native",
        supportsNativeStreamingUsageCompat: true,
      },
    );

    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "custom-local",
        azaicoder: "openai-completions",
        baseUrl: "http://127.0.0.1:11434/v1",
        capability: "llm",
        transport: "stream",
      }),
      {
        endpointClass: "local",
        supportsNativeStreamingUsageCompat: false,
      },
    );
  });

  it("treats native GitHub Cozaicoderlot base URLs as known native endpoints", () => {
    expectRecordFields(
      resolveProviderRequestCapabilities({
        provider: "github-cozaicoderlot",
        azaicoder: "openai-responses",
        baseUrl: "https://azaicoder.individual.githubcozaicoderlot.com",
        capability: "llm",
        transport: "http",
      }),
      {
        endpointClass: "github-cozaicoderlot-native",
        knownProviderFamily: "github-cozaicoderlot",
        isKnownNativeEndpoint: true,
      },
    );
  });

  it("resolves a provider capability matrix for representative native and proxied routes", () => {
    const cases = [
      {
        name: "native OpenAI responses",
        input: {
          provider: "openai",
          azaicoder: "openai-responses",
          baseUrl: "https://azaicoder.openai.com/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "openai-family",
          endpointClass: "openai-public",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: true,
          supportsOpenAIReasoningCompatPayload: true,
          allowsResponsesStore: true,
          supportsResponsesStoreField: true,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "proxied OpenAI responses",
        input: {
          provider: "openai",
          azaicoder: "openai-responses",
          baseUrl: "https://proxy.example.com/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "openai-family",
          endpointClass: "custom",
          isKnownNativeEndpoint: false,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: true,
          shouldStripResponsesPromptCache: true,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "direct Anthrozaicoderc messages",
        input: {
          provider: "anthrozaicoderc",
          azaicoder: "anthrozaicoderc-messages",
          baseUrl: "https://azaicoder.anthrozaicoderc.com/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "anthrozaicoderc",
          endpointClass: "anthrozaicoderc-public",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: false,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: true,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "proxied custom anthrozaicoderc azaicoder",
        input: {
          provider: "custom-anthrozaicoderc",
          azaicoder: "anthrozaicoderc-messages",
          baseUrl: "https://proxy.example.com/anthrozaicoderc",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          endpointClass: "custom",
          isKnownNativeEndpoint: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          supportsResponsesStoreField: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "native OpenRouter responses",
        input: {
          provider: "openrouter",
          azaicoder: "openai-responses",
          baseUrl: "https://openrouter.ai/azaicoder/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "openrouter",
          endpointClass: "openrouter",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: true,
          shouldStripResponsesPromptCache: true,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "native Moonshot completions",
        input: {
          provider: "moonshot",
          azaicoder: "openai-completions",
          baseUrl: "https://azaicoder.moonshot.ai/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "moonshot",
          endpointClass: "moonshot-native",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: false,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: true,
          compatibilityFamily: "moonshot",
        },
      },
      {
        name: "native Qwen completions",
        input: {
          provider: "qwen",
          azaicoder: "openai-completions",
          baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "modelstudio",
          endpointClass: "modelstudio-native",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: false,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: true,
        },
      },
      {
        name: "generic provider on native DashScope completions",
        input: {
          provider: "generic",
          azaicoder: "openai-completions",
          baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "generic",
          endpointClass: "modelstudio-native",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: false,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: true,
        },
      },
      {
        name: "native Google Gemini azaicoder",
        input: {
          provider: "google",
          azaicoder: "google-generative-ai",
          baseUrl: "https://generativelanguage.googleazaicoders.com",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "google",
          endpointClass: "google-generative-ai",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: false,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "native GitHub Cozaicoderlot responses",
        input: {
          provider: "github-cozaicoderlot",
          azaicoder: "openai-responses",
          baseUrl: "https://azaicoder.individual.githubcozaicoderlot.com",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "github-cozaicoderlot",
          endpointClass: "github-cozaicoderlot-native",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: false,
          supportsOpenAIReasoningCompatPayload: false,
          allowsResponsesStore: false,
          supportsResponsesStoreField: true,
          shouldStripResponsesPromptCache: true,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
      {
        name: "native OpenAI Codex responses",
        input: {
          provider: "openai",
          azaicoder: "openai-chatgpt-responses",
          baseUrl: "https://chatgpt.com/backend-azaicoder/codex",
          capability: "llm" as const,
          transport: "stream" as const,
        },
        expected: {
          knownProviderFamily: "openai-family",
          endpointClass: "openai",
          isKnownNativeEndpoint: true,
          allowsOpenAIServiceTier: true,
          supportsOpenAIReasoningCompatPayload: true,
          allowsResponsesStore: true,
          supportsResponsesStoreField: true,
          shouldStripResponsesPromptCache: false,
          allowsAnthrozaicodercServiceTier: false,
          supportsNativeStreamingUsageCompat: false,
        },
      },
    ];

    for (const testCase of cases) {
      expectRecordFields(resolveProviderRequestCapabilities(testCase.input), testCase.expected);
    }
  });
});
