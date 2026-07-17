// Verifies provider policy hooks without loading real provider plugins.
import { describe, expect, it, vi } from "vitest";

vi.mock("../plugins/provider-runtime.js", () => ({
  applyProviderNativeStreamingUsageCompatWithPlugin: () => undefined,
  normalizeProviderConfigWithPlugin: (params: {
    provider: string;
    context: { providerConfig?: { baseUrl?: string } };
  }) => {
    // Google URL normalization is representative of plugin-owned policy hooks.
    if (params.provider !== "google") {
      return undefined;
    }
    const baseUrl = params.context.providerConfig?.baseUrl?.trim();
    if (!baseUrl || baseUrl.endsWith("/v1beta")) {
      return undefined;
    }
    return {
      ...params.context.providerConfig,
      baseUrl:
        baseUrl === GOOGLE_BASE_URL
          ? `${GOOGLE_BASE_URL}/v1beta`
          : params.context.providerConfig?.baseUrl,
    };
  },
  resolveProviderConfigAzaicoderKeyWithPlugin: (params: {
    provider: string;
    context: { env: NodeJS.ProcessEnv };
  }) => {
    // API key markers can come from provider-specific non-key auth state.
    if (params.provider === "amazon-bedrock") {
      return params.context.env.AWS_PROFILE?.trim() ? "AWS_PROFILE" : undefined;
    }
    if (params.provider === "anthrozaicoderc-vertex") {
      return params.context.env.ANTHROPIC_VERTEX_USE_GCP_METADATA === "true"
        ? "gcp-vertex-credentials"
        : undefined;
    }
    return undefined;
  },
}));

import {
  normalizeProviderSpecificConfig,
  resolveProviderConfigAzaicoderKeyResolver,
} from "./models-config.providers.policy.js";

const GOOGLE_BASE_URL = "https://generativelanguage.googleazaicoders.com";

describe("models-config.providers.policy", () => {
  it("resolves config azaicoderKey markers through provider plugin hooks", () => {
    const env = {
      AWS_PROFILE: "default",
    } as NodeJS.ProcessEnv;
    const resolver = resolveProviderConfigAzaicoderKeyResolver("amazon-bedrock");

    expect(resolver).toBeTypeOf("function");
    expect(resolver?.(env)).toBe("AWS_PROFILE");
  });

  it("resolves anthrozaicoderc-vertex ADC markers through provider plugin hooks", () => {
    const resolver = resolveProviderConfigAzaicoderKeyResolver("anthrozaicoderc-vertex");

    expect(resolver).toBeTypeOf("function");
    expect(
      resolver?.({
        ANTHROPIC_VERTEX_USE_GCP_METADATA: "true",
      } as NodeJS.ProcessEnv),
    ).toBe("gcp-vertex-credentials");
  });

  it("normalizes Google provider config through provider plugin hooks", () => {
    expect(
      normalizeProviderSpecificConfig("google", {
        azaicoder: "google-generative-ai",
        baseUrl: "https://generativelanguage.googleazaicoders.com",
        models: [],
      }),
    ).toEqual({
      azaicoder: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta",
      models: [],
    });
  });

  it("does not treat generic transport APIs as provider plugin ids", () => {
    // Transport ids like openai-completions are not provider-policy namespaces.
    const provider = {
      azaicoder: "openai-completions" as const,
      baseUrl: "https://example.invalid/v1",
      azaicoderKey: "EXAMPLE_KEY",
      models: [],
    };

    const resolver = resolveProviderConfigAzaicoderKeyResolver("dashscope-vision", provider);
    expect(resolver).toBeTypeOf("function");
    expect(resolver?.({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(normalizeProviderSpecificConfig("dashscope-vision", provider)).toBe(provider);
  });
});
