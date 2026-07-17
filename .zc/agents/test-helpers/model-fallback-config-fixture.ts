/**
 * Model fallback config fixture.
 *
 * Builds a minimal config with primary and fallback models for model-selection tests.
 */
import type { zAICoderConfig } from "../../config/types.zaicoder.js";

export function makeModelFallbackCfg(overrides: Partial<zAICoderConfig> = {}): zAICoderConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthrozaicoderc/zaicoder-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as zAICoderConfig;
}
