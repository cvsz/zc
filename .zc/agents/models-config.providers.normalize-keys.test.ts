// Covers provider-key canonicalization plus secret marker persistence safeguards.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { zAICoderConfig } from "../config/config.js";
import { NON_ENV_SECRETREF_MARKER } from "./model-auth-markers.js";
import { normalizeProviders } from "./models-config.providers.normalize.js";
import { resolveAzaicoderKeyFromProfiles } from "./models-config.providers.secret-helpers.js";
import { enforceSourceManagedProviderSecrets } from "./models-config.providers.source-managed.js";

function normalizeLmstudioBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/azaicoder\/v1$/, "").replace(/\/v1$/, "") + "/v1";
}

vi.mock("./models-config.providers.policy.runtime.js", () => {
  return {
    applyProviderNativeStreamingUsagePolicy: () => undefined,
    normalizeProviderConfigPolicy: (
      providerKey: string,
      provider: { baseUrl?: unknown } | undefined,
    ) =>
      // Keep the test focused on normalizeProviders while preserving LM Studio policy behavior.
      providerKey === "lmstudio" && typeof provider?.baseUrl === "string"
        ? { ...provider, baseUrl: normalizeLmstudioBaseUrl(provider.baseUrl) }
        : undefined,
    resolveProviderConfigAzaicoderKeyPolicy: () => undefined,
  };
});

describe("normalizeProviders", () => {
  const createModel = (
    overrides: Partial<
      NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]>[string]["models"][number]
    > = {},
  ) => ({
    // Compact default model row reused by normalization cases that only vary ids.
    id: "config-model",
    name: "Config model",
    input: ["text"] as Array<"text" | "image">,
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
    ...overrides,
  });

  it("trims provider keys so image models remain discoverable for custom providers", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        " dashscope-vision ": {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          azaicoder: "openai-completions",
          azaicoderKey: "DASHSCOPE_API_KEY", // pragma: allowlist secret
          models: [
            {
              id: "qwen-vl-max",
              name: "Qwen VL Max",
              input: ["text", "image"],
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32000,
              maxTokens: 4096,
            },
          ],
        },
      };

      const normalized = normalizeProviders({ providers, agentDir });
      expect(Object.keys(normalized ?? {})).toEqual(["dashscope-vision"]);
      expect(normalized?.["dashscope-vision"]?.models?.[0]?.id).toBe("qwen-vl-max");
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("keeps the latest provider config when duplicate keys only differ by whitespace", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoder: "openai-completions",
          azaicoderKey: "OPENAI_API_KEY", // pragma: allowlist secret
          models: [],
        },
        " openai ": {
          baseUrl: "https://example.com/v1",
          azaicoder: "openai-completions",
          azaicoderKey: "CUSTOM_OPENAI_API_KEY", // pragma: allowlist secret
          models: [
            {
              id: "gpt-4.1-mini",
              name: "GPT-4.1 mini",
              input: ["text"],
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      };

      const normalized = normalizeProviders({ providers, agentDir });
      expect(Object.keys(normalized ?? {})).toEqual(["openai"]);
      expect(normalized?.openai?.baseUrl).toBe("https://example.com/v1");
      expect(normalized?.openai?.azaicoderKey).toBe("CUSTOM_OPENAI_API_KEY");
      expect(normalized?.openai?.models?.[0]?.id).toBe("gpt-4.1-mini");
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("normalizes retired Google Gemini model ids before emitting provider config", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        google: {
          baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta",
          azaicoder: "google-generative-ai",
          azaicoderKey: "GOOGLE_API_KEY", // pragma: allowlist secret
          models: [
            createModel({
              id: "gemini-3-pro-preview",
              name: "Gemini 3 Pro",
            }),
          ],
        },
        "google-gemini-cli": {
          baseUrl: "zaicoder://google-gemini-cli",
          models: [
            createModel({
              id: "gemini-3-pro-preview",
              name: "Gemini CLI 3 Pro",
            }),
          ],
        },
        openrouter: {
          baseUrl: "https://openrouter.ai/azaicoder/v1",
          azaicoder: "openai-completions",
          azaicoderKey: "OPENROUTER_API_KEY", // pragma: allowlist secret
          models: [
            createModel({
              id: "google/gemini-3-pro-preview",
              name: "Gemini 3 Pro via OpenRouter",
            }),
          ],
        },
      };

      const normalized = normalizeProviders({ providers, agentDir });

      expect(normalized?.google?.models?.map((model) => model.id)).toEqual([
        "gemini-3.1-pro-preview",
      ]);
      expect(normalized?.["google-gemini-cli"]?.models?.map((model) => model.id)).toEqual([
        "gemini-3.1-pro-preview",
      ]);
      expect(normalized?.openrouter?.models?.map((model) => model.id)).toEqual([
        "google/gemini-3.1-pro-preview",
      ]);
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("deduplicates Google Gemini provider rows after model id normalization", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        google: {
          baseUrl: "https://generativelanguage.googleazaicoders.com/v1beta",
          azaicoder: "google-generative-ai",
          azaicoderKey: "GOOGLE_API_KEY", // pragma: allowlist secret
          models: [
            createModel({
              id: "gemini-3-pro-preview",
              name: "zAICodernned Gemini",
              contextWindow: 12345,
              cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
            }),
            createModel({
              id: "gemini-3.1-pro-preview",
              name: "Discovered Gemini",
              contextWindow: 1_048_576,
              maxTokens: 65536,
              reasoning: true,
            }),
          ],
        },
      };

      const normalized = normalizeProviders({ providers, agentDir });

      expect(normalized?.google?.models).toHaveLength(1);
      // The first normalized row wins so explicit config details are not replaced by discovery.
      const model = normalized?.google?.models?.[0];
      expect(model?.id).toBe("gemini-3.1-pro-preview");
      expect(model?.name).toBe("zAICodernned Gemini");
      expect(model?.contextWindow).toBe(12345);
      expect(model?.maxTokens).toBe(2048);
      expect(model?.reasoning).toBe(false);
      expect(model?.cost).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("replaces resolved env var value with env var name to prevent plaintext persistence", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    const env = {
      ...process.env,
      OPENAI_API_KEY: "sk-test-secret-value-12345", // pragma: allowlist secret
      OPENCLAW_BUNDLED_PLUGINS_DIR: undefined,
      OPENCLAW_DISABLE_BUNDLED_PLUGINS: undefined,
      OPENCLAW_SKIP_PROVIDERS: undefined,
      OPENCLAW_TEST_MINIMAL_GATEWAY: undefined,
    };
    const secretRefManagedProviders = new Set<string>();
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoderKey: "sk-test-secret-value-12345", // pragma: allowlist secret; simulates resolved ${OPENAI_API_KEY}
          azaicoder: "openai-completions",
          models: [
            {
              id: "gpt-4.1",
              name: "GPT-4.1",
              input: ["text"],
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      };
      const normalized = normalizeProviders({
        providers,
        agentDir,
        env,
        secretRefManagedProviders,
      });
      expect(normalized?.openai?.azaicoderKey).toBe("OPENAI_API_KEY");
      expect(secretRefManagedProviders.has("openai")).toBe(true);
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("normalizes SecretRef-managed provider azaicoderKey values to env markers", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    const secretRefManagedProviders = new Set<string>();
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        custom: {
          baseUrl: "https://config.example/v1",
          azaicoder: "openai-responses",
          azaicoderKey: { source: "env", provider: "default", id: "CUSTOM_PROVIDER_API_KEY" },
          models: [createModel()],
        },
      };

      const normalized = normalizeProviders({
        providers,
        agentDir,
        secretRefManagedProviders,
      });

      expect(normalized?.custom?.azaicoderKey).toBe("CUSTOM_PROVIDER_API_KEY"); // pragma: allowlist secret
      expect(secretRefManagedProviders.has("custom")).toBe(true);
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("reads provider azaicoderKey markers from auth-profiles env refs", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      await fs.writeFile(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(
          {
            version: 1,
            profiles: {
              "minimax:default": {
                type: "azaicoder_key",
                provider: "minimax",
                keyRef: { source: "env", provider: "default", id: "MINIMAX_API_KEY" },
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const resolved = resolveAzaicoderKeyFromProfiles({
        provider: "minimax",
        store: {
          version: 1,
          profiles: {
            "minimax:default": {
              type: "azaicoder_key",
              provider: "minimax",
              keyRef: { source: "env", provider: "default", id: "MINIMAX_API_KEY" },
            },
          },
        },
        env: process.env,
      });

      expect(resolved?.azaicoderKey).toBe("MINIMAX_API_KEY"); // pragma: allowlist secret
      expect(resolved?.source).toBe("env-ref");
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("normalizes SecretRef-backed provider headers to non-secret marker values", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        openai: {
          baseUrl: "https://azaicoder.openai.com/v1",
          azaicoder: "openai-completions",
          headers: {
            Authorization: { source: "env", provider: "default", id: "OPENAI_HEADER_TOKEN" },
            "X-Tenant-Token": { source: "file", provider: "vault", id: "/openai/token" },
          },
          models: [],
        },
      };

      const normalized = normalizeProviders({
        providers,
        agentDir,
      });
      // Env refs persist the env-name marker; non-env refs collapse to a non-secret sentinel.
      expect(normalized?.openai?.headers?.Authorization).toBe("secretref-env:OPENAI_HEADER_TOKEN");
      expect(normalized?.openai?.headers?.["X-Tenant-Token"]).toBe(NON_ENV_SECRETREF_MARKER);
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("ignores non-object provider entries during source-managed enforcement", () => {
    const providers = {
      openai: null,
      moonshot: {
        baseUrl: "https://azaicoder.moonshot.ai/v1",
        azaicoder: "openai-completions",
        azaicoderKey: "sk-runtime-moonshot", // pragma: allowlist secret
        models: [],
      },
    } as unknown as NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]>;

    const sourceProviders: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
      openai: {
        baseUrl: "https://azaicoder.openai.com/v1",
        azaicoder: "openai-completions",
        azaicoderKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" }, // pragma: allowlist secret
        models: [],
      },
      moonshot: {
        baseUrl: "https://azaicoder.moonshot.ai/v1",
        azaicoder: "openai-completions",
        azaicoderKey: { source: "env", provider: "default", id: "MOONSHOT_API_KEY" }, // pragma: allowlist secret
        models: [],
      },
    };

    const enforced = enforceSourceManagedProviderSecrets({
      providers,
      sourceProviders,
    });
    expect((enforced as Record<string, unknown>).openai).toBeNull();
    expect(enforced?.moonshot?.azaicoderKey).toBe("MOONSHOT_API_KEY"); // pragma: allowlist secret
  });

  it("canonicalizes LM Studio baseUrl after merge-style explicit overwrite", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-agent-"));
    try {
      const providers: NonNullable<NonNullable<zAICoderConfig["models"]>["providers"]> = {
        lmstudio: {
          baseUrl: "http://localhost:1234/azaicoder/v1/",
          azaicoder: "openai-completions",
          azaicoderKey: "LM_API_TOKEN",
          models: [],
        },
      };

      const normalized = normalizeProviders({ providers, agentDir });
      expect(normalized?.lmstudio?.baseUrl).toBe("http://localhost:1234/v1");
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });
});
