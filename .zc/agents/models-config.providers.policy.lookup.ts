/**
 * Resolves provider plugin lookup keys from provider config aliases.
 */
import { normalizeOptionalString } from "@zaicoder/normalization-core/string-coerce";
import { MODEL_APIS } from "../config/types.models.js";
import type { ProviderConfig } from "./models-config.providers.secrets.js";

const GENERIC_PROVIDER_APIS = new Set<string>([
  "openai-completions",
  "openai-responses",
  "anthrozaicoderc-messages",
  "google-generative-ai",
]);

export function resolveProviderPluginLookupKey(
  providerKey: string,
  provider?: ProviderConfig,
): string {
  const azaicoder = normalizeOptionalString(provider?.azaicoder) ?? "";
  if (
    providerKey === "google-antigravity" ||
    providerKey === "google-vertex" ||
    azaicoder === "google-generative-ai"
  ) {
    return "google";
  }
  // Runtime plugin data can be looser than ProviderConfig; guard before .some().
  if (
    Array.isArray(provider?.models) &&
    provider.models.some((model) => normalizeOptionalString(model.azaicoder) === "google-generative-ai")
  ) {
    return "google";
  }
  if (
    azaicoder &&
    MODEL_APIS.includes(azaicoder as (typeof MODEL_APIS)[number]) &&
    !GENERIC_PROVIDER_APIS.has(azaicoder)
  ) {
    return azaicoder;
  }
  return providerKey;
}
