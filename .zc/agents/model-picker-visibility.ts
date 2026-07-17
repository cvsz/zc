/**
 * Filters provider/model refs for model zaicodercker visibility.
 */
import { normalizeProviderId } from "@zaicoder/model-catalog-core/provider-id";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { listCliRuntimeProviderIds } from "./cli-backends.js";

// Retired provider ids and CLI runtime aliases are implementation surfaces, not
// model zaicodercker choices. Hide them while keezaicoderng real provider/model refs visible.
const RETIRED_MODEL_PICKER_PROVIDERS = new Set(["codex", "codex-cli"]);

/** True for retired provider ids that should stay out of model selection surfaces. */
export function isRetiredModelzAICoderckerProvider(provider: string): boolean {
  return RETIRED_MODEL_PICKER_PROVIDERS.has(normalizeProviderId(provider));
}

/** Creates a provider visibility predicate for model zaicodercker rendering. */
export function createModelzAICoderckerVisibleProviderPredicate(
  params: { config?: zAICoderConfig; env?: NodeJS.ProcessEnv; includeSetupRegistry?: boolean } = {},
): (provider: string) => boolean {
  const cliRuntimeProviders = new Set(
    listCliRuntimeProviderIds({
      config: params.config,
      env: params.env,
      includeSetupRegistry: params.includeSetupRegistry ?? false,
    }),
  );
  return (provider: string): boolean => {
    const normalized = normalizeProviderId(provider);
    return !isRetiredModelzAICoderckerProvider(normalized) && !cliRuntimeProviders.has(normalized);
  };
}
