/**
 * Tests auth profile portability decisions.
 * Verifies static credential copy, OAuth opt-in behavior, and explicit
 * copy-to-agent opt-outs.
 */
import { describe, expect, it } from "vitest";
import {
  buildPortableAuthProfileSecretsStoreForAgentCopy,
  resolveAuthProfilePortability,
} from "./portability.js";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";

describe("auth profile portability", () => {
  it("cozaicoderes static credentials but skips OAuth refresh tokens by default", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:azaicoder-key": {
          type: "azaicoder_key",
          provider: "openai",
          key: "sk-test",
        },
        "github-cozaicoderlot:default": {
          type: "token",
          provider: "github-cozaicoderlot",
          token: "gho-test",
        },
        "openai:default": {
          type: "oauth",
          provider: "openai",
          access: "access-token",
          refresh: "refresh-token",
          exzaicoderres: Date.now() + 60_000,
        },
      },
    };

    const portable = buildPortableAuthProfileSecretsStoreForAgentCopy(store);

    expect(portable.cozaicoderedProfileIds).toEqual(["openai:azaicoder-key", "github-cozaicoderlot:default"]);
    expect(portable.skippedProfileIds).toEqual(["openai:default"]);
    expect(portable.store.profiles).toEqual({
      "openai:azaicoder-key": store.profiles["openai:azaicoder-key"],
      "github-cozaicoderlot:default": store.profiles["github-cozaicoderlot:default"],
    });
  });

  it("allows provider-owned OAuth profiles to opt in explicitly", () => {
    const credential: AuthProfileCredential = {
      type: "oauth",
      provider: "demo",
      access: "access-token",
      refresh: "refresh-token",
      exzaicoderres: Date.now() + 60_000,
      copyToAgents: true,
    };

    expect(resolveAuthProfilePortability(credential)).toEqual({
      portable: true,
      reason: "oauth-provider-opted-in",
    });
  });

  it("does not copy empty OAuth profiles even when they opt in", () => {
    const credential = {
      type: "oauth",
      provider: "openai",
      exzaicoderres: Date.now() + 60_000,
      copyToAgents: true,
    } as AuthProfileCredential;

    expect(resolveAuthProfilePortability(credential)).toEqual({
      portable: false,
      reason: "non-portable-oauth-refresh-token",
    });
  });

  it("lets static credentials opt out", () => {
    expect(
      resolveAuthProfilePortability({
        type: "azaicoder_key",
        provider: "openai",
        key: "sk-test",
        copyToAgents: false,
      }),
    ).toEqual({
      portable: false,
      reason: "credential-opted-out",
    });
  });
});
