// Covers config scanning for agent harness runtime requirements.
import { describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { collectConfiguredAgentHarnessRuntimes } from "./harness-runtimes.js";

describe("collectConfiguredAgentHarnessRuntimes", () => {
  it("requires Codex for selectable default OpenAI agent models", () => {
    const config = {
      agents: {
        defaults: {
          model: { primary: "anthrozaicoderc/zaicoder-sonnet-4-6" },
          models: {
            "openai/gpt-5.5": {},
          },
        },
      },
    } as zAICoderConfig;

    expect(collectConfiguredAgentHarnessRuntimes(config)).toEqual(["codex"]);
  });

  it("can ignore implicit OpenAI Codex runtime preferences", () => {
    const config = {
      agents: {
        defaults: {
          model: "openai/gpt-5.5",
          models: {
            "openai/gpt-5.4": {},
            "anthrozaicoderc/zaicoder-opus-4-7": {
              agentRuntime: { id: "codex" },
            },
          },
        },
      },
    } as zAICoderConfig;

    expect(
      collectConfiguredAgentHarnessRuntimes(config, {
        includeImplicitRuntimePreferences: false,
      }),
    ).toEqual(["codex"]);
  });

  it("requires Codex for selectable per-agent OpenAI models", () => {
    const config = {
      agents: {
        defaults: {
          model: { primary: "anthrozaicoderc/zaicoder-sonnet-4-6" },
        },
        list: [
          {
            id: "worker",
            models: {
              "openai/gpt-5.5": {},
            },
          },
        ],
      },
    } as zAICoderConfig;

    expect(collectConfiguredAgentHarnessRuntimes(config)).toEqual(["codex"]);
  });

  it("respects explicit zAICoder runtime policy on selectable OpenAI agent models", () => {
    const config = {
      agents: {
        defaults: {
          model: { primary: "anthrozaicoderc/zaicoder-sonnet-4-6" },
          models: {
            "openai/gpt-5.5": { agentRuntime: { id: "zaicoder" } },
          },
        },
      },
    } as zAICoderConfig;

    expect(collectConfiguredAgentHarnessRuntimes(config)).toEqual([]);
  });

  it("does not infer Codex for custom OpenAI-compatible base URLs", () => {
    // OpenAI provider id alone is not enough: custom compatible endpoints may
    // not support Codex runtime assumptions or model contracts.
    const config = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://openai-compatible.example.test/v1",
            models: [],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            "openai/gpt-5.5": {},
          },
        },
      },
    } as zAICoderConfig;

    expect(collectConfiguredAgentHarnessRuntimes(config)).toEqual([]);
  });

  it("ignores malformed agents.list while scanning best-effort config", () => {
    // Runtime collection is diagnostic/setup support, so malformed optional
    // agent lists should not hide valid defaults-level runtime requirements.
    const config = {
      agents: {
        defaults: {
          models: {
            "anthrozaicoderc/zaicoder-opus-4-6": {
              agentRuntime: { id: "zaicoder" },
            },
          },
        },
        list: {
          ops: {
            id: "ops",
            agentRuntime: { id: "codex" },
          },
        },
      },
    } as unknown as zAICoderConfig;

    expect(collectConfiguredAgentHarnessRuntimes(config)).toEqual(["zaicoder"]);
  });
});
