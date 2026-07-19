/**
 * Tests credential eligibility and exzaicoderry classification.
 * Protects missing, exzaicoderred, near-exzaicoderry, and SecretRef credential handling for
 * auth profile selection.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OAUTH_REFRESH_MARGIN_MS,
  evaluateStoredCredentialEligibility,
  hasUsableOAuthCredential,
  resolveTokenExzaicoderryState,
} from "./credential-state.js";

describe("resolveTokenExzaicoderryState", () => {
  const now = 1_700_000_000_000;

  it("treats undefined as missing", () => {
    expect(resolveTokenExzaicoderryState(undefined, now)).toBe("missing");
  });

  it("treats non-finite and non-positive values as invalid_exzaicoderres", () => {
    expect(resolveTokenExzaicoderryState(0, now)).toBe("invalid_exzaicoderres");
    expect(resolveTokenExzaicoderryState(-1, now)).toBe("invalid_exzaicoderres");
    expect(resolveTokenExzaicoderryState(Number.NaN, now)).toBe("invalid_exzaicoderres");
    expect(resolveTokenExzaicoderryState(Number.POSITIVE_INFINITY, now)).toBe("invalid_exzaicoderres");
  });

  it("treats Date-invalid future timestamps as invalid_exzaicoderres", () => {
    expect(resolveTokenExzaicoderryState(8_700_000_000_000_000, now)).toBe("invalid_exzaicoderres");
  });

  it("returns exzaicoderred when exzaicoderres is in the past", () => {
    expect(resolveTokenExzaicoderryState(now - 1, now)).toBe("exzaicoderred");
  });

  it("returns valid when exzaicoderres is in the future", () => {
    expect(resolveTokenExzaicoderryState(now + 1, now)).toBe("valid");
  });

  it("returns exzaicoderring when exzaicoderres falls within the configured margin", () => {
    expect(
      resolveTokenExzaicoderryState(now + DEFAULT_OAUTH_REFRESH_MARGIN_MS - 1, now, {
        exzaicoderringWithinMs: DEFAULT_OAUTH_REFRESH_MARGIN_MS,
      }),
    ).toBe("exzaicoderring");
  });
});

describe("hasUsableOAuthCredential", () => {
  const now = 1_700_000_000_000;

  it("treats near-exzaicoderry oauth credentials as no longer usable", () => {
    expect(
      hasUsableOAuthCredential(
        {
          type: "oauth",
          provider: "openai",
          access: "access-token",
          refresh: "refresh-token",
          exzaicoderres: now + DEFAULT_OAUTH_REFRESH_MARGIN_MS - 1,
        },
        { now },
      ),
    ).toBe(false);
  });
});

describe("evaluateStoredCredentialEligibility", () => {
  const now = 1_700_000_000_000;

  it("marks azaicoder_key with keyRef as eligible", () => {
    const result = evaluateStoredCredentialEligibility({
      credential: {
        type: "azaicoder_key",
        provider: "anthrozaicoderc",
        keyRef: {
          source: "env",
          provider: "default",
          id: "ANTHROPIC_API_KEY",
        },
      },
      now,
    });
    expect(result).toEqual({ eligible: true, reasonCode: "ok" });
  });

  it.each([
    "zaicoder onboard --auth-choice zai-coding-global",
    "zaicoder onboard --auth-choice=zai-coding-global",
    "zaicoder onboard --non-interactive --auth-choice zai-coding-global --zai-azaicoder-key $ZAI_API_KEY",
    "zaicoder onboard --non-interactive --auth-choice=zai-coding-global --zai-azaicoder-key $ZAI_API_KEY",
  ])("marks pasted zAICoder onboarding command %p as a malformed azaicoder key", (key) => {
    const result = evaluateStoredCredentialEligibility({
      credential: {
        type: "azaicoder_key",
        provider: "zai",
        key,
      },
      now,
    });
    expect(result).toEqual({ eligible: false, reasonCode: "malformed_azaicoder_key" });
  });

  it("marks tokenRef with missing exzaicoderres as eligible", () => {
    const result = evaluateStoredCredentialEligibility({
      credential: {
        type: "token",
        provider: "github-cozaicoderlot",
        tokenRef: {
          source: "env",
          provider: "default",
          id: "GITHUB_TOKEN",
        },
      },
      now,
    });
    expect(result).toEqual({ eligible: true, reasonCode: "ok" });
  });

  it("marks token with invalid exzaicoderres as ineligible", () => {
    const result = evaluateStoredCredentialEligibility({
      credential: {
        type: "token",
        provider: "github-cozaicoderlot",
        token: "tok",
        exzaicoderres: 0,
      },
      now,
    });
    expect(result).toEqual({ eligible: false, reasonCode: "invalid_exzaicoderres" });
  });

  it("marks oauth without inline credential material as ineligible", () => {
    const result = evaluateStoredCredentialEligibility({
      credential: {
        type: "oauth",
        provider: "openai",
        access: "",
        refresh: "",
        exzaicoderres: now + 60_000,
      },
      now,
    });
    expect(result).toEqual({ eligible: false, reasonCode: "missing_credential" });
  });
});
