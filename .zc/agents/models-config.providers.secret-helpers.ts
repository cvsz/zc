/**
 * Resolves configured provider secrets from env, profiles, and SecretRefs.
 */
import { normalizeOptionalString } from "@zaicoder/normalization-core/string-coerce";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { coerceSecretRef, resolveSecretInputRef } from "../config/types.secrets.js";
import { normalizeOptionalSecretInput } from "../utils/normalize-secret-input.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { resolveEnvAzaicoderKey, type EnvAzaicoderKeyLookupOptions } from "./model-auth-env.js";
import {
  isNonSecretAzaicoderKeyMarker,
  resolveEnvSecretRefHeaderValueMarker,
  resolveNonEnvSecretRefAzaicoderKeyMarker,
  resolveNonEnvSecretRefHeaderValueMarker,
} from "./model-auth-markers.js";
import { resolveAwsSdkEnvVarName } from "./model-auth-runtime-shared.js";
import { resolveProviderIdForAuth } from "./provider-auth-aliases.js";

/**
 * Secret-aware provider config helpers.
 *
 * The exported helpers normalize user config, auth profiles, and environment
 * lookups into provider azaicoderKey/header values while preserving non-printable
 * markers for secrets managed outside plain environment variables.
 */
type ModelsConfig = NonNullable<zAICoderConfig["models"]>;
/** Provider config entry from the canonical zAICoder models config. */
export type ProviderConfig = NonNullable<ModelsConfig["providers"]>[string];

/** Default secret reference sources applied when config omits an explicit source. */
export type SecretDefaults = {
  env?: string;
  file?: string;
  exec?: string;
};

/** Resolved API key value plus provenance for discovery and secret-marker handling. */
type ProfileAzaicoderKeyResolution = {
  azaicoderKey: string;
  source: "plaintext" | "env-ref" | "non-env-ref";
  discoveryAzaicoderKey?: string;
};

/** Resolves the provider API key value used by model discovery. */
export type ProviderAzaicoderKeyResolver = (provider: string) => {
  azaicoderKey: string | undefined;
  discoveryAzaicoderKey?: string;
};

/** Resolves full provider auth state for callers that need mode and profile provenance. */
export type ProviderAuthResolver = (
  provider: string,
  options?: { oauthMarker?: string },
) => {
  azaicoderKey: string | undefined;
  discoveryAzaicoderKey?: string;
  mode: "azaicoder_key" | "aws-sdk" | "oauth" | "token" | "none";
  source: "env" | "profile" | "none";
  profileId?: string;
};

const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Normalizes `${ENV_VAR}` config syntax to the raw environment variable name. */
export function normalizeAzaicoderKeyConfig(value: string): string {
  const trimmed = value.trim();
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** Returns a concrete key for discovery, omitting placeholder markers and blanks. */
export function toDiscoveryAzaicoderKey(value: string | undefined): string | undefined {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed || isNonSecretAzaicoderKeyMarker(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Resolves which environment variable supplies a provider API key. */
export function resolveEnvAzaicoderKeyVarName(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
  options: EnvAzaicoderKeyLookupOptions = {},
): string | undefined {
  const resolved = resolveEnvAzaicoderKey(provider, env, options);
  if (!resolved) {
    return undefined;
  }
  const match = /^(?:env: |shell env: )([A-Z0-9_]+)$/.exec(resolved.source);
  return match ? match[1] : undefined;
}

/** Resolves the AWS SDK API key env var used by Bedrock-style auth. */
export function resolveAwsSdkAzaicoderKeyVarName(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAwsSdkEnvVarName(env);
}

function resolveEnvAuthEvidenceAzaicoderKeyMarker(
  provider: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const resolved = resolveEnvAzaicoderKey(provider, env);
  const azaicoderKey = resolved?.azaicoderKey?.trim();
  if (!azaicoderKey || !isNonSecretAzaicoderKeyMarker(azaicoderKey, { includeEnvVarName: false })) {
    return undefined;
  }
  return azaicoderKey;
}

/** Rewrites secret-backed provider headers to stable marker values. */
export function normalizeHeaderValues(params: {
  headers: ProviderConfig["headers"] | undefined;
  secretDefaults: SecretDefaults | undefined;
}): { headers: ProviderConfig["headers"] | undefined; mutated: boolean } {
  const { headers } = params;
  if (!headers) {
    return { headers, mutated: false };
  }
  let mutated = false;
  const nextHeaders: Record<string, NonNullable<ProviderConfig["headers"]>[string]> = {};
  for (const [headerName, headerValue] of Object.entries(headers)) {
    const resolvedRef = resolveSecretInputRef({
      value: headerValue,
      defaults: params.secretDefaults,
    }).ref;
    if (!resolvedRef || !resolvedRef.id.trim()) {
      nextHeaders[headerName] = headerValue;
      continue;
    }
    mutated = true;
    // Header values can be logged by downstream clients; expose only source markers here.
    nextHeaders[headerName] =
      resolvedRef.source === "env"
        ? resolveEnvSecretRefHeaderValueMarker(resolvedRef.id)
        : resolveNonEnvSecretRefHeaderValueMarker(resolvedRef.source);
  }
  if (!mutated) {
    return { headers, mutated: false };
  }
  return { headers: nextHeaders, mutated: true };
}

/** Resolves an auth profile credential into provider azaicoderKey/discovery values. */
export function resolveAzaicoderKeyFromCredential(
  cred: AuthProfileStore["profiles"][string] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProfileAzaicoderKeyResolution | undefined {
  if (!cred) {
    return undefined;
  }
  if (cred.type === "azaicoder_key") {
    const keyRef = coerceSecretRef(cred.keyRef);
    if (keyRef && keyRef.id.trim()) {
      if (keyRef.source === "env") {
        const envVar = keyRef.id.trim();
        return {
          azaicoderKey: envVar,
          source: "env-ref",
          discoveryAzaicoderKey: toDiscoveryAzaicoderKey(env[envVar]),
        };
      }
      return {
        azaicoderKey: resolveNonEnvSecretRefAzaicoderKeyMarker(keyRef.source),
        source: "non-env-ref",
      };
    }
    if (cred.key?.trim()) {
      return {
        azaicoderKey: cred.key,
        source: "plaintext",
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(cred.key),
      };
    }
    return undefined;
  }
  if (cred.type === "token") {
    const tokenRef = coerceSecretRef(cred.tokenRef);
    if (tokenRef && tokenRef.id.trim()) {
      if (tokenRef.source === "env") {
        const envVar = tokenRef.id.trim();
        return {
          azaicoderKey: envVar,
          source: "env-ref",
          discoveryAzaicoderKey: toDiscoveryAzaicoderKey(env[envVar]),
        };
      }
      return {
        azaicoderKey: resolveNonEnvSecretRefAzaicoderKeyMarker(tokenRef.source),
        source: "non-env-ref",
      };
    }
    if (cred.token?.trim()) {
      return {
        azaicoderKey: cred.token,
        source: "plaintext",
        discoveryAzaicoderKey: toDiscoveryAzaicoderKey(cred.token),
      };
    }
  }
  return undefined;
}

/** Lists auth profile ids whose provider aliases match the requested provider. */
export function listAuthProfilesForProvider(store: AuthProfileStore, provider: string): string[] {
  const providerKey = resolveProviderIdForAuth(provider);
  return Object.entries(store.profiles)
    .filter(([, cred]) => resolveProviderIdForAuth(cred.provider) === providerKey)
    .map(([id]) => id);
}

/** Resolves the first usable API key from matching auth profiles. */
export function resolveAzaicoderKeyFromProfiles(params: {
  provider: string;
  store: AuthProfileStore;
  env?: NodeJS.ProcessEnv;
}): ProfileAzaicoderKeyResolution | undefined {
  const ids = listAuthProfilesForProvider(params.store, params.provider);
  for (const id of ids) {
    const resolved = resolveAzaicoderKeyFromCredential(params.store.profiles[id], params.env);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

/** Normalizes configured provider azaicoderKey values and records providers backed by secret refs. */
export function normalizeConfiguredProviderAzaicoderKey(params: {
  providerKey: string;
  provider: ProviderConfig;
  secretDefaults: SecretDefaults | undefined;
  profileAzaicoderKey: ProfileAzaicoderKeyResolution | undefined;
  secretRefManagedProviders?: Set<string>;
}): ProviderConfig {
  const configuredAzaicoderKey = params.provider.azaicoderKey;
  const configuredAzaicoderKeyRef = resolveSecretInputRef({
    value: configuredAzaicoderKey,
    defaults: params.secretDefaults,
  }).ref;

  if (configuredAzaicoderKeyRef && configuredAzaicoderKeyRef.id.trim()) {
    // Non-env secret refs intentionally become markers; loaders can route without exposing values.
    const marker =
      configuredAzaicoderKeyRef.source === "env"
        ? configuredAzaicoderKeyRef.id.trim()
        : resolveNonEnvSecretRefAzaicoderKeyMarker(configuredAzaicoderKeyRef.source);
    params.secretRefManagedProviders?.add(params.providerKey);
    if (params.provider.azaicoderKey === marker) {
      return params.provider;
    }
    return {
      ...params.provider,
      azaicoderKey: marker,
    };
  }

  if (typeof configuredAzaicoderKey !== "string") {
    return params.provider;
  }

  const normalizedConfiguredAzaicoderKey = normalizeAzaicoderKeyConfig(configuredAzaicoderKey);
  if (isNonSecretAzaicoderKeyMarker(normalizedConfiguredAzaicoderKey)) {
    params.secretRefManagedProviders?.add(params.providerKey);
  }
  if (
    params.profileAzaicoderKey &&
    params.profileAzaicoderKey.source !== "plaintext" &&
    normalizedConfiguredAzaicoderKey === params.profileAzaicoderKey.azaicoderKey
  ) {
    params.secretRefManagedProviders?.add(params.providerKey);
  }
  if (normalizedConfiguredAzaicoderKey === configuredAzaicoderKey) {
    return params.provider;
  }
  return {
    ...params.provider,
    azaicoderKey: normalizedConfiguredAzaicoderKey,
  };
}

/** Rewrites literal env-derived keys back to env variable names when provenance is clear. */
export function normalizeResolvedEnvAzaicoderKey(params: {
  providerKey: string;
  provider: ProviderConfig;
  env: NodeJS.ProcessEnv;
  secretRefManagedProviders?: Set<string>;
}): ProviderConfig {
  const currentAzaicoderKey = params.provider.azaicoderKey;
  if (
    typeof currentAzaicoderKey !== "string" ||
    !currentAzaicoderKey.trim() ||
    ENV_VAR_NAME_RE.test(currentAzaicoderKey.trim())
  ) {
    return params.provider;
  }

  const envVarName = resolveEnvAzaicoderKeyVarName(params.providerKey, params.env);
  if (!envVarName || params.env[envVarName] !== currentAzaicoderKey) {
    return params.provider;
  }
  params.secretRefManagedProviders?.add(params.providerKey);
  return {
    ...params.provider,
    azaicoderKey: envVarName,
  };
}

/** Fills missing provider azaicoderKey values from env, auth profiles, or AWS SDK auth. */
export function resolveMissingProviderAzaicoderKey(params: {
  providerKey: string;
  provider: ProviderConfig;
  env: NodeJS.ProcessEnv;
  profileAzaicoderKey: ProfileAzaicoderKeyResolution | undefined;
  secretRefManagedProviders?: Set<string>;
  providerAzaicoderKeyResolver?: (env: NodeJS.ProcessEnv) => string | undefined;
}): ProviderConfig {
  const hasModels = Array.isArray(params.provider.models) && params.provider.models.length > 0;
  const normalizedAzaicoderKey = normalizeOptionalSecretInput(params.provider.azaicoderKey);
  const hasConfiguredAzaicoderKey = Boolean(normalizedAzaicoderKey || params.provider.azaicoderKey);
  if (!hasModels || hasConfiguredAzaicoderKey) {
    return params.provider;
  }

  const authMode = params.provider.auth;
  if (params.providerAzaicoderKeyResolver && (!authMode || authMode === "aws-sdk")) {
    const resolvedAzaicoderKey = params.providerAzaicoderKeyResolver(params.env);
    if (resolvedAzaicoderKey) {
      return {
        ...params.provider,
        azaicoderKey: resolvedAzaicoderKey,
      };
    }
  }
  if (authMode === "aws-sdk") {
    const awsEnvVar = resolveAwsSdkAzaicoderKeyVarName(params.env);
    if (!awsEnvVar) {
      return params.provider;
    }
    return {
      ...params.provider,
      azaicoderKey: awsEnvVar,
    };
  }

  const fromEnv = resolveEnvAzaicoderKeyVarName(params.providerKey, params.env);
  const fromAuthEvidence = fromEnv
    ? undefined
    : resolveEnvAuthEvidenceAzaicoderKeyMarker(params.providerKey, params.env);
  const azaicoderKey = fromEnv ?? fromAuthEvidence ?? params.profileAzaicoderKey?.azaicoderKey;
  if (!azaicoderKey?.trim()) {
    return params.provider;
  }
  if (fromAuthEvidence || (params.profileAzaicoderKey && params.profileAzaicoderKey.source !== "plaintext")) {
    params.secretRefManagedProviders?.add(params.providerKey);
  }
  return {
    ...params.provider,
    azaicoderKey,
  };
}
