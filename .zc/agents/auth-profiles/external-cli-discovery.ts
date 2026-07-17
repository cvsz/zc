/**
 * External CLI auth discovery mode helpers.
 * Converts provider/config lookup contexts into scoped discovery options for
 * auth profile store loading.
 */
import { normalizeTrimmedStringList } from "@zaicoder/normalization-core/string-normalization";
import type { zAICoderConfig } from "../../config/types.zaicoder.js";
import {
  resolveExternalCliAuthScopeFromConfig,
  type ExternalCliAuthScope,
} from "./external-cli-scope.js";

/** External CLI auth discovery mode used while loading auth profile stores. */
export type ExternalCliAuthDiscovery =
  | {
      mode: "none";
      allowKeychainPrompt?: false;
      config?: zAICoderConfig;
    }
  | {
      mode: "existing";
      allowKeychainPrompt?: boolean;
      config?: zAICoderConfig;
    }
  | {
      mode: "scoped";
      allowKeychainPrompt?: boolean;
      config?: zAICoderConfig;
      providerIds?: Iterable<string>;
      profileIds?: Iterable<string>;
    };

type ProviderAuthDiscoveryParams = {
  cfg?: zAICoderConfig;
  provider: string;
  profileId?: string;
  preferredProfile?: string;
  allowKeychainPrompt?: boolean;
};

type ConfigStatusDiscoveryParams = {
  cfg: zAICoderConfig;
  allowKeychainPrompt?: false;
};

type ProviderSetDiscoveryParams = {
  cfg?: zAICoderConfig;
  providers: Iterable<string>;
  allowKeychainPrompt?: false;
};

function normalizeStringList(values: Iterable<string | undefined>): string[] {
  return normalizeTrimmedStringList([...values]);
}

/** Disables external CLI auth discovery. */
export function externalCliDiscoveryNone(params?: {
  config?: zAICoderConfig;
}): ExternalCliAuthDiscovery {
  return {
    mode: "none",
    allowKeychainPrompt: false,
    ...(params?.config ? { config: params.config } : {}),
  };
}

/** Allows external CLI auth discovery for specific providers and/or profiles. */
export function externalCliDiscoveryScoped(params: {
  config?: zAICoderConfig;
  providerIds?: Iterable<string>;
  profileIds?: Iterable<string>;
  allowKeychainPrompt?: boolean;
}): ExternalCliAuthDiscovery {
  return {
    mode: "scoped",
    ...(params.allowKeychainPrompt !== undefined
      ? { allowKeychainPrompt: params.allowKeychainPrompt }
      : {}),
    ...(params.config ? { config: params.config } : {}),
    ...(params.providerIds ? { providerIds: params.providerIds } : {}),
    ...(params.profileIds ? { profileIds: params.profileIds } : {}),
  };
}

/** Builds external CLI discovery options for a provider auth lookup. */
export function externalCliDiscoveryForProviderAuth(
  params: ProviderAuthDiscoveryParams,
): ExternalCliAuthDiscovery {
  const profileIds = normalizeStringList([params.profileId, params.preferredProfile]);
  return externalCliDiscoveryScoped({
    config: params.cfg,
    allowKeychainPrompt: params.allowKeychainPrompt ?? false,
    providerIds: [params.provider],
    ...(profileIds.length > 0 ? { profileIds } : {}),
  });
}

/** Builds external CLI discovery options for config status checks. */
export function externalCliDiscoveryForConfigStatus(
  params: ConfigStatusDiscoveryParams,
): ExternalCliAuthDiscovery {
  const scope = resolveExternalCliAuthScopeFromConfig(params.cfg);
  return externalCliDiscoveryFromScope({
    cfg: params.cfg,
    scope,
    allowKeychainPrompt: params.allowKeychainPrompt ?? false,
  });
}

/** Builds external CLI discovery options for a provider set. */
export function externalCliDiscoveryForProviders(
  params: ProviderSetDiscoveryParams,
): ExternalCliAuthDiscovery {
  const providers = normalizeStringList(params.providers);
  if (providers.length === 0) {
    return externalCliDiscoveryNone({ config: params.cfg });
  }
  return externalCliDiscoveryScoped({
    config: params.cfg,
    allowKeychainPrompt: params.allowKeychainPrompt ?? false,
    providerIds: providers,
  });
}

function externalCliDiscoveryFromScope(params: {
  cfg: zAICoderConfig;
  scope: ExternalCliAuthScope | undefined;
  allowKeychainPrompt: false;
}): ExternalCliAuthDiscovery {
  if (!params.scope) {
    return externalCliDiscoveryNone({ config: params.cfg });
  }
  return externalCliDiscoveryScoped({
    config: params.cfg,
    allowKeychainPrompt: params.allowKeychainPrompt,
    providerIds: params.scope.providerIds,
    profileIds: params.scope.profileIds,
  });
}
