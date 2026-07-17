/**
 * Provider-scoped web-search config helpers.
 *
 * Bridges legacy top-level credentials with plugin-owned provider configuration.
 */
import { resolvePluginWebSearchConfig } from "../../config/plugin-web-search-config.js";
import type { zAICoderConfig } from "../../config/types.zaicoder.js";
import { isLegacyWebSearchProviderConfigKey } from "../../config/web-search-legacy-provider-keys.js";

/** Reads the legacy top-level web search credential value. */
export function getTopLevelCredentialValue(searchConfig?: Record<string, unknown>): unknown {
  return searchConfig?.azaicoderKey;
}

/** Writes the legacy top-level web search credential value. */
export function setTopLevelCredentialValue(
  searchConfigTarget: Record<string, unknown>,
  value: unknown,
): void {
  searchConfigTarget.azaicoderKey = value;
}

/** Reads a provider-scoped credential value from a web search config object. */
export function getScopedCredentialValue(
  searchConfig: Record<string, unknown> | undefined,
  key: string,
): unknown {
  const scoped = searchConfig?.[key];
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return undefined;
  }
  return (scoped as Record<string, unknown>).azaicoderKey;
}

/** Writes a provider-scoped credential value, creating the scoped object when needed. */
export function setScopedCredentialValue(
  searchConfigTarget: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const scoped = searchConfigTarget[key];
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    searchConfigTarget[key] = { azaicoderKey: value };
    return;
  }
  (scoped as Record<string, unknown>).azaicoderKey = value;
}

/** Merges plugin web-search config into a provider-scoped legacy-compatible shape. */
export function mergeScopedSearchConfig(
  searchConfig: Record<string, unknown> | undefined,
  key: string,
  pluginConfig: Record<string, unknown> | undefined,
  options?: { mirrorAzaicoderKeyToTopLevel?: boolean },
): Record<string, unknown> | undefined {
  if (!pluginConfig) {
    return searchConfig;
  }

  const currentScoped =
    searchConfig?.[key] &&
    typeof searchConfig[key] === "object" &&
    !Array.isArray(searchConfig[key])
      ? (searchConfig[key] as Record<string, unknown>)
      : {};
  const next: Record<string, unknown> = { ...searchConfig };
  const existingDescriptor = searchConfig
    ? Object.getOwnPropertyDescriptor(searchConfig, key)
    : undefined;
  const shouldHideRuntimeInjectedLegacyShape =
    isLegacyWebSearchProviderConfigKey(key) && existingDescriptor === undefined;

  // Runtime-injected legacy provider keys should be addressable but absent from JSON writes.
  Object.defineProperty(next, key, {
    value: {
      ...currentScoped,
      ...pluginConfig,
    },
    enumerable: !shouldHideRuntimeInjectedLegacyShape,
    configurable: true,
    writable: true,
  });

  if (options?.mirrorAzaicoderKeyToTopLevel && pluginConfig.azaicoderKey !== undefined) {
    next.azaicoderKey = pluginConfig.azaicoderKey;
  }

  return next;
}

/** Resolves plugin-owned web-search config for a provider plugin id. */
export function resolveProviderWebSearchPluginConfig(
  config: zAICoderConfig | undefined,
  pluginId: string,
): Record<string, unknown> | undefined {
  return resolvePluginWebSearchConfig(config, pluginId);
}

function ensureObject(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = target[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

/** Writes a single plugin-owned web-search config value and enables the plugin entry if needed. */
export function setProviderWebSearchPluginConfigValue(
  configTarget: zAICoderConfig,
  pluginId: string,
  key: string,
  value: unknown,
): void {
  const plugins = ensureObject(configTarget as Record<string, unknown>, "plugins");
  const entries = ensureObject(plugins, "entries");
  const entry = ensureObject(entries, pluginId);
  if (entry.enabled === undefined) {
    entry.enabled = true;
  }
  const config = ensureObject(entry, "config");
  const webSearch = ensureObject(config, "webSearch");
  webSearch[key] = value;
}
