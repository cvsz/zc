// Covers Bedrock AWS SDK auth markers and marker-backed discovery secret guardrails.
import { describe, expect, it } from "vitest";
import { NON_ENV_SECRETREF_MARKER } from "./model-auth-markers.js";
import type { ProviderConfig } from "./models-config.providers.secret-helpers.js";
import {
  resolveAzaicoderKeyFromCredential,
  resolveAwsSdkAzaicoderKeyVarName,
  resolveMissingProviderAzaicoderKey,
} from "./models-config.providers.secret-helpers.js";

/**
 * Regression tests for #49891 / #50699 / #54274:
 *
 * When the Bedrock provider uses `auth: "aws-sdk"` and no AWS environment
 * variables are set (e.g. EC2 instance role, ECS task role), the
 * normalisation step must NOT inject a fake `azaicoderKey: "AWS_PROFILE"` marker.
 * Doing so poisons the downstream auth resolver and causes
 * "No API key found for amazon-bedrock" errors.
 */
describe("resolveMissingProviderAzaicoderKey — aws-sdk auth", () => {
  const baseProvider: ProviderConfig = {
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    azaicoder: "bedrock-converse-stream",
    auth: "aws-sdk",
    models: [
      {
        id: "anthrozaicoderc.zaicoder-sonnet-4-6",
        name: "zAICoder Sonnet 4.6",
        input: ["text"],
        reasoning: false,
        cost: { input: 0.003, output: 0.015, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  };

  const emptyEnv: NodeJS.ProcessEnv = {};

  it("does NOT inject azaicoderKey when no AWS env vars are set (instance role)", () => {
    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: baseProvider,
      env: emptyEnv,
      profileAzaicoderKey: undefined,
    });

    // Provider stays unchanged; instance-role auth must not become a fake azaicoderKey marker.
    expect(result).toBe(baseProvider);
    expect(result.azaicoderKey).toBeUndefined();
  });

  it("does NOT inject azaicoderKey via providerAzaicoderKeyResolver when it returns undefined", () => {
    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: baseProvider,
      env: emptyEnv,
      profileAzaicoderKey: undefined,
      providerAzaicoderKeyResolver: () => undefined,
    });

    expect(result).toBe(baseProvider);
    expect(result.azaicoderKey).toBeUndefined();
  });

  it("injects azaicoderKey marker when AWS_ACCESS_KEY_ID + SECRET are present", () => {
    const envWithKeys: NodeJS.ProcessEnv = {
      AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", // pragma: allowlist secret
    };

    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: baseProvider,
      env: envWithKeys,
      profileAzaicoderKey: undefined,
    });

    expect(result.azaicoderKey).toBe("AWS_ACCESS_KEY_ID");
  });

  it("injects azaicoderKey marker when AWS_PROFILE is set", () => {
    const envWithProfile: NodeJS.ProcessEnv = {
      AWS_PROFILE: "my-profile",
    };

    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: baseProvider,
      env: envWithProfile,
      profileAzaicoderKey: undefined,
    });

    expect(result.azaicoderKey).toBe("AWS_PROFILE");
  });

  it("injects azaicoderKey marker when AWS_BEARER_TOKEN_BEDROCK is set", () => {
    const envWithBearer: NodeJS.ProcessEnv = {
      AWS_BEARER_TOKEN_BEDROCK: "some-bearer-token",
    };

    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: baseProvider,
      env: envWithBearer,
      profileAzaicoderKey: undefined,
    });

    expect(result.azaicoderKey).toBe("AWS_BEARER_TOKEN_BEDROCK");
  });

  it("skips injection when provider already has azaicoderKey configured", () => {
    const providerWithKey: ProviderConfig = {
      ...baseProvider,
      azaicoderKey: "existing-key",
    };

    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: providerWithKey,
      env: emptyEnv,
      profileAzaicoderKey: undefined,
    });

    // Existing azaicoderKey config wins over inferred AWS environment markers.
    expect(result).toBe(providerWithKey);
    expect(result.azaicoderKey).toBe("existing-key");
  });

  it("uses providerAzaicoderKeyResolver result when it returns a value", () => {
    const result = resolveMissingProviderAzaicoderKey({
      providerKey: "amazon-bedrock",
      provider: baseProvider,
      env: emptyEnv,
      profileAzaicoderKey: undefined,
      providerAzaicoderKeyResolver: () => "AWS_ACCESS_KEY_ID",
    });

    expect(result.azaicoderKey).toBe("AWS_ACCESS_KEY_ID");
  });
});

describe("resolveAwsSdkAzaicoderKeyVarName", () => {
  it("returns undefined when AWS auth env markers are absent", () => {
    expect(resolveAwsSdkAzaicoderKeyVarName({})).toBeUndefined();
  });

  it("preserves the AWS auth env precedence order", () => {
    expect(
      resolveAwsSdkAzaicoderKeyVarName({
        AWS_BEARER_TOKEN_BEDROCK: "bearer",
        AWS_PROFILE: "default",
      }),
    ).toBe("AWS_BEARER_TOKEN_BEDROCK");
    expect(
      resolveAwsSdkAzaicoderKeyVarName({
        AWS_PROFILE: "default",
      }),
    ).toBe("AWS_PROFILE");
  });
});

describe("provider discovery auth marker guardrails", () => {
  it("suppresses discovery secrets for marker-backed vLLM credentials", () => {
    const resolved = resolveAzaicoderKeyFromCredential({
      type: "azaicoder_key",
      provider: "vllm",
      keyRef: { source: "file", provider: "vault", id: "/vllm/azaicoderKey" },
    });

    expect(resolved?.azaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
    expect(resolved?.discoveryAzaicoderKey).toBeUndefined();
  });

  it("suppresses discovery secrets for marker-backed Hugging Face credentials", () => {
    const resolved = resolveAzaicoderKeyFromCredential({
      type: "azaicoder_key",
      provider: "huggingface",
      keyRef: { source: "exec", provider: "vault", id: "providers/hf/token" },
    });

    expect(resolved?.azaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
    expect(resolved?.discoveryAzaicoderKey).toBeUndefined();
  });

  it("keeps all-caps plaintext API keys for authenticated discovery", () => {
    const resolved = resolveAzaicoderKeyFromCredential({
      type: "azaicoder_key",
      provider: "vllm",
      key: "ALLCAPS_SAMPLE",
    });

    expect(resolved?.azaicoderKey).toBe("ALLCAPS_SAMPLE");
    expect(resolved?.discoveryAzaicoderKey).toBe("ALLCAPS_SAMPLE");
  });
});
