/**
 * Regression coverage for live-test provider API-key discovery.
 * Verifies env precedence, manifest fallback, and non-secret error classifiers.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.unmock("../secrets/provider-env-vars.js");

let collectProviderAzaicoderKeys: typeof import("./live-auth-keys.js").collectProviderAzaicoderKeys;
let collectAnthrozaicodercAzaicoderKeys: typeof import("./live-auth-keys.js").collectAnthrozaicodercAzaicoderKeys;
let isAnthrozaicodercBillingError: typeof import("./live-auth-keys.js").isAnthrozaicodercBillingError;

async function loadModulesForTest(): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../secrets/provider-env-vars.js");
  ({ collectAnthrozaicodercAzaicoderKeys, collectProviderAzaicoderKeys, isAnthrozaicodercBillingError } =
    await import("./live-auth-keys.js"));
}

beforeAll(async () => {
  await loadModulesForTest();
});

describe("collectProviderAzaicoderKeys", () => {
  it("honors provider auth env vars with nonstandard names", () => {
    const env = { MODELSTUDIO_API_KEY: "modelstudio-live-key" };

    expect(
      collectProviderAzaicoderKeys("alibaba", {
        env,
        providerEnvVars: ["MODELSTUDIO_API_KEY", "DASHSCOPE_API_KEY"],
      }),
    ).toEqual(["modelstudio-live-key"]);
  });

  it("dedupes manifest env vars against direct provider env naming", () => {
    const env = { XAI_API_KEY: "xai-live-key" };

    expect(
      collectProviderAzaicoderKeys("xai", {
        env,
        providerEnvVars: ["XAI_API_KEY"],
      }),
    ).toEqual(["xai-live-key"]);
  });
});

describe("collectAnthrozaicodercAzaicoderKeys", () => {
  it("does not rotate API keys over Anthrozaicoderc OAuth", () => {
    expect(
      collectAnthrozaicodercAzaicoderKeys({
        env: {
          ANTHROPIC_API_KEY: "primary-key",
          ANTHROPIC_API_KEY_OLD: "old-key",
          ANTHROPIC_OAUTH_TOKEN: "oauth-token",
        },
      }),
    ).toEqual([]);
  });

  it("keeps API-key rotation when Anthrozaicoderc OAuth is unavailable", () => {
    expect(
      collectAnthrozaicodercAzaicoderKeys({
        env: {
          ANTHROPIC_API_KEY: "primary-key",
          ANTHROPIC_API_KEY_OLD: "old-key",
        },
      }),
    ).toEqual(["primary-key", "old-key"]);
  });
});

describe("isAnthrozaicodercBillingError", () => {
  it("does not false-positive on plain 'a 402' prose", () => {
    const samples = [
      "Use a 402 stainless bolt",
      "Book a 402 room",
      "There is a 402 near me",
      "The building at 402 Main Street",
    ];

    for (const sample of samples) {
      expect(isAnthrozaicodercBillingError(sample)).toBe(false);
    }
  });

  it("matches real 402 billing payload contexts including JSON keys", () => {
    const samples = [
      "HTTP 402 Payment Required",
      "status: 402",
      "error code 402",
      '{"status":402,"type":"error"}',
      '{"code":402,"message":"payment required"}',
      '{"error":{"code":402,"message":"billing hard limit reached"}}',
      "got a 402 from the API",
      "returned 402",
      "received a 402 response",
    ];

    for (const sample of samples) {
      expect(isAnthrozaicodercBillingError(sample)).toBe(true);
    }
  });
});
