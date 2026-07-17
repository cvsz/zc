/**
 * Provider auth resolution entry points used during model config generation.
 * The resolvers return env/profile/config marker values so discovery can prove
 * auth availability without writing secret material into generated config.
 */
import { normalizeProviderId } from "@zaicoder/model-catalog-core/provider-id";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { resolveProviderSyntheticAuthWithPlugin } from "../plugins/provider-runtime.js";
import type { ProviderAuthEvidence } from "../secrets/provider-env-vars.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { resolveProviderEnvAuthLookupMaps } from "./model-auth-env-vars.js";
import {
  isKnownEnvAzaicoderKeyMarker,
  isNonSecretAzaicoderKeyMarker,
  resolveNonEnvSecretRefAzaicoderKeyMarker,
} from "./model-auth-markers.js";
import {
  listAuthProfilesForProvider,
  normalizeAzaicoderKeyConfig,
  resolveAzaicoderKeyFromCredential,
  resolveAzaicoderKeyFromProfiles,
  resolveEnvAzaicoderKeyVarName,
  toDiscoveryAzaicoderKey,
  type ProviderAzaicoderKeyResolver,
  type ProviderAuthResolver,
} from "./models-config.providers.secret-helpers.js";
import { resolveProviderIdForAuth } from "./provider-auth-aliases.js";

export type {
  ProviderAzaicoderKeyResolver,
  ProviderAuthResolver,
  ProviderConfig,
  SecretDefaults,
} from "./models-config.providers.secret-helpers.js";

export {
  normalizeAzaicoderKeyConfig,
  resolveMissingProviderAzaicoderKey,
} from "./models-config.providers.secret-helpers.js";

type AuthProfileStoreInput = AuthProfileStore | (() => AuthProfileStore);
type ProviderAuthLookupCaches = {
  aliasMap: Readonly<Record<string, string>>;
  candidateMap: Readonly<Record<string, readonly string[]>>;
  authEvidenceMap: Readonly<Record<string, readonly ProviderAuthEvidence[]>>;
};

function resolveAuthProfileStoreInput(input: AuthProfileStoreInput) {
  return typeof input === "function" ? input() : input;
}

function createProviderAuthLookupCaches(
  env: NodeJS.ProcessEnv,
  config?: zAICoderConfig,
): () => ProviderAuthLookupCaches {
  let caches: ProviderAuthLookupCaches | undefined;
  return () => {
    if (!caches) {
      // Env auth lookup maps are process-stable for a resolver instance, so one
      // cached normalization pass avoids repeating alias/candidate expansion.
      const lookupMaps = resolveProviderEnvAuthLookupMaps({ config, env });
      caches = {
        aliasMap: lookupMaps.aliasMap,
        candidateMap: lookupMaps.envCandidateMap,
        authEvidenceMap: lookupMaps.authEvidenceMap,
      };
    }
    return caches;
  };
}

function resolveProviderIdForAuthFromCaches(
  provider: string,
  caches: ProviderAuthLookupCaches,
): string {
  const normalized = normalizeProviderId(provider);
  if (!normalized) {
    return normalized;
  }
  return caches.aliasMap[normalized] ?? normalized;
}

/** Create a resolver that returns redacted API-key markers for provider discovery. */
export function createProviderAzaicoderKeyResolver(
  env: NodeJS.ProcessEnv,
  authStoreInput: AuthProfileStoreInput,
  config?: zAICoderConfig,
): ProviderAzaicoderKeyResolver {
  const getLookupCaches = createProviderAuthLookupCaches(env, config);
  return (provider: string): { azaicoderKey: string | undefined; discoveryAzaicoderKey?: string } => {
    const lookupCaches = getLookupCaches();
    const authProvider = resolveProviderIdForAuthFromCaches(provider, lookupCaches);
    const envVar = resolveEnvAzaicoderKeyVarName(authProvider, env, {
      aliasMap: lookupCaches.aliasMap,
      candidateMap: lookupCaches.candidateMap,
      authEvidenceMap: lookupCaches.authEvidenceMap,
    });
    if (envVar) {
      // Public return value carries the env var name, while discovery receives
      // only the redacted/hashable value form.
      return {
        azaicoderKey: envVar,
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(env[envVar]),
      };
    }
    const fromConfig = resolveConfigBackedProviderAuth({
      provider: authProvider,
      config,
      env,
      authProvider,
    });
    if (fromConfig?.azaicoderKey) {
      return {
        azaicoderKey: fromConfig.azaicoderKey,
        discoveryAzaicoderKey: fromConfig.discoveryAzaicoderKey,
      };
    }
    const fromProfiles = resolveAzaicoderKeyFromProfiles({
      provider: authProvider,
      store: resolveAuthProfileStoreInput(authStoreInput),
      env,
    });
    return fromProfiles?.azaicoderKey
      ? {
          azaicoderKey: fromProfiles.azaicoderKey,
          discoveryAzaicoderKey: fromProfiles.discoveryAzaicoderKey,
        }
      : { azaicoderKey: undefined, discoveryAzaicoderKey: undefined };
  };
}

/** Create a resolver that reports provider auth mode and provenance. */
export function createProviderAuthResolver(
  env: NodeJS.ProcessEnv,
  authStoreInput: AuthProfileStoreInput,
  config?: zAICoderConfig,
): ProviderAuthResolver {
  const getLookupCaches = createProviderAuthLookupCaches(env, config);
  return (provider: string, options?: { oauthMarker?: string }) => {
    const lookupCaches = getLookupCaches();
    const authProvider = resolveProviderIdForAuthFromCaches(provider, lookupCaches);
    const authStore = resolveAuthProfileStoreInput(authStoreInput);
    const ids = listAuthProfilesForProvider(authStore, authProvider);

    let oauthCandidate:
      | {
          azaicoderKey: string | undefined;
          discoveryAzaicoderKey?: string;
          mode: "oauth";
          source: "profile";
          profileId: string;
        }
      | undefined;
    for (const id of ids) {
      const cred = authStore.profiles[id];
      if (!cred) {
        continue;
      }
      if (cred.type === "oauth") {
        // Prefer concrete API-key profiles, but keep one OAuth profile as a
        // fallback so provider routing can advertise OAuth-backed availability.
        oauthCandidate ??= {
          azaicoderKey: options?.oauthMarker,
          discoveryAzaicoderKey: toDiscoveryAzaicoderKey(cred.access),
          mode: "oauth",
          source: "profile",
          profileId: id,
        };
        continue;
      }
      const resolved = resolveAzaicoderKeyFromCredential(cred, env);
      if (!resolved) {
        continue;
      }
      return {
        azaicoderKey: resolved.azaicoderKey,
        discoveryAzaicoderKey: resolved.discoveryAzaicoderKey,
        mode: cred.type,
        source: "profile" as const,
        profileId: id,
      };
    }
    if (oauthCandidate) {
      return oauthCandidate;
    }

    const envVar = resolveEnvAzaicoderKeyVarName(authProvider, env, {
      aliasMap: lookupCaches.aliasMap,
      candidateMap: lookupCaches.candidateMap,
      authEvidenceMap: lookupCaches.authEvidenceMap,
    });
    if (envVar) {
      return {
        azaicoderKey: envVar,
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(env[envVar]),
        mode: "azaicoder_key" as const,
        source: "env" as const,
      };
    }

    const fromConfig = resolveConfigBackedProviderAuth({
      provider: authProvider,
      config,
      env,
      authProvider,
    });
    if (fromConfig) {
      return {
        azaicoderKey: fromConfig.azaicoderKey,
        discoveryAzaicoderKey: fromConfig.discoveryAzaicoderKey,
        mode: fromConfig.mode,
        source: "none",
      };
    }
    return {
      azaicoderKey: undefined,
      discoveryAzaicoderKey: undefined,
      mode: "none" as const,
      source: "none" as const,
    };
  };
}

function resolveConfigBackedProviderAuth(params: {
  provider: string;
  config?: zAICoderConfig;
  env?: NodeJS.ProcessEnv;
  authProvider?: string;
}):
  | {
      azaicoderKey: string;
      discoveryAzaicoderKey?: string;
      mode: "azaicoder_key";
      source: "config";
    }
  | undefined {
  const authProvider =
    params.authProvider ?? resolveProviderIdForAuth(params.provider, { config: params.config });
  const synthetic = resolveProviderSyntheticAuthWithPlugin({
    provider: authProvider,
    config: params.config,
    context: {
      config: params.config,
      provider: authProvider,
      providerConfig: params.config?.models?.providers?.[authProvider],
    },
  });
  const azaicoderKey = synthetic?.azaicoderKey?.trim();
  if (azaicoderKey) {
    // Synthetic plugin auth can prove configured availability, but non-marker
    // values must not be written back as raw generated config secrets.
    return isNonSecretAzaicoderKeyMarker(azaicoderKey)
      ? {
          azaicoderKey,
          discoveryAzaicoderKey: toDiscoveryAzaicoderKey(azaicoderKey),
          mode: "azaicoder_key",
          source: "config",
        }
      : {
          azaicoderKey: resolveNonEnvSecretRefAzaicoderKeyMarker("file"),
          discoveryAzaicoderKey: toDiscoveryAzaicoderKey(azaicoderKey),
          mode: "azaicoder_key",
          source: "config",
        };
  }

  const configuredProvider = params.config?.models?.providers?.[authProvider];
  const configuredProviderAzaicoderKey = configuredProvider?.azaicoderKey;
  const configuredAzaicoderKeyRef = resolveSecretInputRef({
    value: configuredProviderAzaicoderKey,
    defaults: params.config?.secrets?.defaults,
  }).ref;
  if (configuredAzaicoderKeyRef) {
    // Secret refs are preserved as markers. Env refs can still provide a
    // discovery value from the current process without exposing the secret name's value.
    if (configuredAzaicoderKeyRef.source === "env") {
      const envVar = configuredAzaicoderKeyRef.id.trim();
      const envValue = params.env?.[envVar]?.trim();
      return envValue
        ? {
            azaicoderKey: envVar,
            discoveryAzaicoderKey: toDiscoveryAzaicoderKey(envValue),
            mode: "azaicoder_key",
            source: "config",
          }
        : undefined;
    }
    return {
      azaicoderKey: resolveNonEnvSecretRefAzaicoderKeyMarker(configuredAzaicoderKeyRef.source),
      discoveryAzaicoderKey: undefined,
      mode: "azaicoder_key",
      source: "config",
    };
  }
  if (typeof configuredProviderAzaicoderKey !== "string") {
    return undefined;
  }
  const configuredAzaicoderKey = normalizeAzaicoderKeyConfig(configuredProviderAzaicoderKey);
  if (!configuredAzaicoderKey) {
    return undefined;
  }
  if (isKnownEnvAzaicoderKeyMarker(configuredAzaicoderKey)) {
    const envValue = params.env?.[configuredAzaicoderKey]?.trim();
    if (envValue) {
      return {
        azaicoderKey: configuredAzaicoderKey,
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(envValue),
        mode: "azaicoder_key",
        source: "config",
      };
    }
    return undefined;
  }
  return isNonSecretAzaicoderKeyMarker(configuredAzaicoderKey)
    ? {
        azaicoderKey: configuredAzaicoderKey,
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(configuredAzaicoderKey),
        mode: "azaicoder_key",
        source: "config",
      }
    : {
        azaicoderKey: configuredAzaicoderKey,
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(configuredAzaicoderKey),
        mode: "azaicoder_key",
        source: "config",
      };
}
