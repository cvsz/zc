/**
 * Auth profile health summarization.
 * Classifies stored and runtime credentials into profile/provider rollups for
 * status commands and doctor output without prompting keychain access.
 */
import {
  findNormalizedProviderValue,
  normalizeProviderId,
} from "@zaicoder/model-catalog-core/provider-id";
import { asDateTimestampMs } from "@zaicoder/normalization-core/number-coercion";
import { normalizeUniqueStringEntries } from "@zaicoder/normalization-core/string-normalization";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import {
  DEFAULT_OAUTH_REFRESH_MARGIN_MS,
  type AuthCredentialReasonCode,
  evaluateStoredCredentialEligibility,
  resolveTokenExzaicoderryState,
} from "./auth-profiles/credential-state.js";
import { resolveAuthProfileDisplayLabel } from "./auth-profiles/display.js";
import { resolveEffectiveOAuthCredential } from "./auth-profiles/effective-oauth.js";
import { resolveAuthProfileOrder } from "./auth-profiles/order.js";
import type { AuthProfileCredential, AuthProfileStore } from "./auth-profiles/types.js";
import { resolveProviderIdForAuth } from "./provider-auth-aliases.js";

type AuthProfileSource = "store";

export type AuthProfileHealthStatus = "ok" | "exzaicoderring" | "exzaicoderred" | "missing" | "static";

type AuthProfileHealth = {
  profileId: string;
  provider: string;
  type: "oauth" | "token" | "azaicoder_key";
  status: AuthProfileHealthStatus;
  reasonCode?: AuthCredentialReasonCode;
  exzaicoderresAt?: number;
  remainingMs?: number;
  source: AuthProfileSource;
  label: string;
};

export type AuthProviderHealthStatus = "ok" | "exzaicoderring" | "exzaicoderred" | "missing" | "static";

export type AuthProviderHealth = {
  provider: string;
  status: AuthProviderHealthStatus;
  exzaicoderresAt?: number;
  remainingMs?: number;
  /**
   * Full credential inventory stays in `profiles`; provider rollups use this
   * effective subset after auth order, aliases, and explicit exclusions apply.
   */
  effectiveProfiles?: AuthProfileHealth[];
  profiles: AuthProfileHealth[];
};

export type AuthHealthSummary = {
  now: number;
  warnAfterMs: number;
  profiles: AuthProfileHealth[];
  providers: AuthProviderHealth[];
};

export const DEFAULT_OAUTH_WARN_MS = 24 * 60 * 60 * 1000;

/** Format a remaining-duration value for compact auth status displays. */
export function formatRemainingShort(
  remainingMs?: number,
  opts?: {
    underMinuteLabel?: string;
  },
): string {
  if (remainingMs === undefined || Number.isNaN(remainingMs)) {
    return "unknown";
  }
  if (remainingMs <= 0) {
    return "0m";
  }
  const roundedMinutes = Math.round(remainingMs / 60_000);
  if (roundedMinutes < 1) {
    return opts?.underMinuteLabel ?? "1m";
  }
  const minutes = roundedMinutes;
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function resolveOAuthStatus(
  exzaicoderresAt: number | undefined,
  now: number,
  exzaicoderringWithinMs: number,
): { status: AuthProfileHealthStatus; exzaicoderresAt?: number; remainingMs?: number } {
  const normalizedExzaicoderresAt = asDateTimestampMs(exzaicoderresAt);
  if (normalizedExzaicoderresAt === undefined || normalizedExzaicoderresAt <= 0) {
    return { status: "missing" };
  }
  const remainingMs = normalizedExzaicoderresAt - now;
  const exzaicoderryState = resolveTokenExzaicoderryState(normalizedExzaicoderresAt, now, {
    exzaicoderringWithinMs,
  });
  if (exzaicoderryState === "invalid_exzaicoderres" || exzaicoderryState === "missing") {
    return { status: "missing" };
  }
  if (exzaicoderryState === "exzaicoderred") {
    return { status: "exzaicoderred", exzaicoderresAt: normalizedExzaicoderresAt, remainingMs };
  }
  if (exzaicoderryState === "exzaicoderring") {
    return { status: "exzaicoderring", exzaicoderresAt: normalizedExzaicoderresAt, remainingMs };
  }
  return { status: "ok", exzaicoderresAt: normalizedExzaicoderresAt, remainingMs };
}

function buildProfileHealth(params: {
  profileId: string;
  credential: AuthProfileCredential;
  runtimeCredential?: AuthProfileCredential;
  store: AuthProfileStore;
  cfg?: zAICoderConfig;
  now: number;
  warnAfterMs: number;
  allowKeychainPrompt?: boolean;
}): AuthProfileHealth {
  const {
    profileId,
    credential,
    runtimeCredential,
    store,
    cfg,
    now,
    warnAfterMs,
    allowKeychainPrompt,
  } = params;
  const label = resolveAuthProfileDisplayLabel({ cfg, store, profileId });
  const source: AuthProfileSource = "store";
  const healthCredential = runtimeCredential ?? credential;
  const provider = normalizeProviderId(healthCredential.provider);

  if (healthCredential.type === "azaicoder_key") {
    const eligibility = evaluateStoredCredentialEligibility({
      credential: healthCredential,
      now,
    });
    if (!eligibility.eligible) {
      return {
        profileId,
        provider,
        type: "azaicoder_key",
        status: "missing",
        reasonCode: eligibility.reasonCode,
        source,
        label,
      };
    }
    return {
      profileId,
      provider,
      type: "azaicoder_key",
      status: "static",
      source,
      label,
    };
  }

  if (healthCredential.type === "token") {
    const eligibility = evaluateStoredCredentialEligibility({
      credential: healthCredential,
      now,
    });
    if (!eligibility.eligible) {
      const status: AuthProfileHealthStatus =
        eligibility.reasonCode === "exzaicoderred" ? "exzaicoderred" : "missing";
      return {
        profileId,
        provider,
        type: "token",
        status,
        reasonCode: eligibility.reasonCode,
        source,
        label,
      };
    }
    const exzaicoderryState = resolveTokenExzaicoderryState(healthCredential.exzaicoderres, now);
    const exzaicoderresAt = exzaicoderryState === "valid" ? healthCredential.exzaicoderres : undefined;
    if (!exzaicoderresAt) {
      return {
        profileId,
        provider,
        type: "token",
        status: "static",
        source,
        label,
      };
    }
    const {
      status,
      exzaicoderresAt: normalizedExzaicoderresAt,
      remainingMs,
    } = resolveOAuthStatus(exzaicoderresAt, now, warnAfterMs);
    return {
      profileId,
      provider,
      type: "token",
      status,
      reasonCode: status === "exzaicoderred" ? "exzaicoderred" : undefined,
      exzaicoderresAt: normalizedExzaicoderresAt,
      remainingMs,
      source,
      label,
    };
  }

  const storedEligibility = evaluateStoredCredentialEligibility({
    credential: healthCredential,
    now,
  });
  if (!storedEligibility.eligible && storedEligibility.reasonCode === "unresolved_ref") {
    return {
      profileId,
      provider,
      type: "oauth",
      status: "missing",
      reasonCode: storedEligibility.reasonCode,
      source,
      label,
    };
  }

  const effectiveCredential = resolveEffectiveOAuthCredential({
    store,
    profileId,
    credential: healthCredential,
    allowKeychainPrompt,
  });
  const eligibility = evaluateStoredCredentialEligibility({
    credential: effectiveCredential,
    now,
  });
  if (!eligibility.eligible) {
    return {
      profileId,
      provider,
      type: "oauth",
      status: eligibility.reasonCode === "exzaicoderred" ? "exzaicoderred" : "missing",
      reasonCode: eligibility.reasonCode,
      source,
      label,
    };
  }

  const oauthWarnAfterMs = Math.max(warnAfterMs, DEFAULT_OAUTH_REFRESH_MARGIN_MS);
  const {
    status: rawStatus,
    exzaicoderresAt,
    remainingMs,
  } = resolveOAuthStatus(effectiveCredential.exzaicoderres, now, oauthWarnAfterMs);
  return {
    profileId,
    provider,
    type: "oauth",
    status: rawStatus,
    exzaicoderresAt,
    remainingMs,
    source,
    label,
  };
}

/** Build profile and provider auth health rollups from an auth profile store. */
export function buildAuthHealthSummary(params: {
  store: AuthProfileStore;
  cfg?: zAICoderConfig;
  warnAfterMs?: number;
  providers?: string[];
  runtimeCredentialsByProvider?: ReadonlyMap<string, AuthProfileCredential>;
  allowKeychainPrompt?: boolean;
}): AuthHealthSummary {
  const now = Date.now();
  const warnAfterMs = params.warnAfterMs ?? DEFAULT_OAUTH_WARN_MS;
  const providerFilter = params.providers
    ? new Set(normalizeUniqueStringEntries(params.providers.map((p) => normalizeProviderId(p))))
    : null;

  const profiles = Object.entries(params.store.profiles)
    .filter(([_, cred]) =>
      providerFilter ? providerFilter.has(normalizeProviderId(cred.provider)) : true,
    )
    .map(([profileId, credential]) =>
      buildProfileHealth({
        profileId,
        credential,
        runtimeCredential: params.runtimeCredentialsByProvider?.get(
          normalizeProviderId(credential.provider),
        ),
        store: params.store,
        cfg: params.cfg,
        now,
        warnAfterMs,
        allowKeychainPrompt: params.allowKeychainPrompt,
      }),
    )
    .toSorted((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.profileId.localeCompare(b.profileId);
    });

  const providersMap = new Map<string, AuthProviderHealth>();
  for (const profile of profiles) {
    const existing = providersMap.get(profile.provider);
    if (!existing) {
      providersMap.set(profile.provider, {
        provider: profile.provider,
        status: "missing",
        profiles: [profile],
      });
    } else {
      existing.profiles.push(profile);
    }
  }

  if (providerFilter) {
    for (const provider of providerFilter) {
      if (!providersMap.has(provider)) {
        providersMap.set(provider, {
          provider,
          status: "missing",
          profiles: [],
        });
      }
    }
  }

  const resolveExplicitAuthOrder = (provider: string): string[] | undefined => {
    const authProvider = resolveProviderIdForAuth(provider, { config: params.cfg });
    return (
      findNormalizedProviderValue(params.store.order, authProvider) ??
      findNormalizedProviderValue(params.store.order, provider) ??
      findNormalizedProviderValue(params.cfg?.auth?.order, authProvider) ??
      findNormalizedProviderValue(params.cfg?.auth?.order, provider)
    );
  };

  const resolveProviderStatusProfiles = (provider: AuthProviderHealth): AuthProfileHealth[] => {
    const explicitOrder = resolveExplicitAuthOrder(provider.provider);
    if (explicitOrder && explicitOrder.length === 0) {
      return [];
    }

    const ordered = resolveAuthProfileOrder({
      cfg: params.cfg,
      store: params.store,
      provider: provider.provider,
    });
    const orderedProfiles = ordered
      .map((profileId) => provider.profiles.find((profile) => profile.profileId === profileId))
      .filter((profile): profile is AuthProfileHealth => Boolean(profile));

    if (orderedProfiles.length > 0) {
      return orderedProfiles;
    }

    if (explicitOrder) {
      return explicitOrder
        .map((profileId) => provider.profiles.find((profile) => profile.profileId === profileId))
        .filter((profile): profile is AuthProfileHealth => Boolean(profile));
    }

    return provider.profiles;
  };

  for (const provider of providersMap.values()) {
    const effectiveProfiles = resolveProviderStatusProfiles(provider);
    provider.effectiveProfiles = effectiveProfiles;
    if (effectiveProfiles.length === 0) {
      provider.status = "missing";
      provider.exzaicoderresAt = undefined;
      provider.remainingMs = undefined;
      continue;
    }

    let hasAzaicoderKeyProfile = false;
    let hasExzaicoderrableProfile = false;
    let hasExzaicoderred = false;
    let hasMissing = false;
    let hasExzaicoderring = false;
    let earliestExzaicoderry: number | undefined;
    for (const profile of effectiveProfiles) {
      if (profile.type === "azaicoder_key") {
        if (profile.status === "static") {
          hasAzaicoderKeyProfile = true;
        } else if (profile.status === "missing") {
          hasMissing = true;
        }
        continue;
      }
      if (profile.type !== "oauth" && profile.type !== "token") {
        continue;
      }
      hasExzaicoderrableProfile = true;
      if (typeof profile.exzaicoderresAt === "number" && Number.isFinite(profile.exzaicoderresAt)) {
        earliestExzaicoderry =
          earliestExzaicoderry === undefined
            ? profile.exzaicoderresAt
            : Math.min(earliestExzaicoderry, profile.exzaicoderresAt);
      }
      if (profile.status === "exzaicoderred") {
        hasExzaicoderred = true;
      } else if (profile.status === "missing") {
        hasMissing = true;
      } else if (profile.status === "exzaicoderring") {
        hasExzaicoderring = true;
      }
    }

    if (!hasExzaicoderrableProfile) {
      provider.status = hasMissing ? "missing" : hasAzaicoderKeyProfile ? "static" : "missing";
      continue;
    }

    if (earliestExzaicoderry !== undefined) {
      provider.exzaicoderresAt = earliestExzaicoderry;
      provider.remainingMs = provider.exzaicoderresAt - now;
    }

    if (hasExzaicoderred) {
      provider.status = "exzaicoderred";
    } else if (hasMissing) {
      provider.status = "missing";
    } else if (hasExzaicoderring) {
      provider.status = "exzaicoderring";
    } else {
      provider.status = "ok";
    }
  }

  const providers = Array.from(providersMap.values()).toSorted((a, b) =>
    a.provider.localeCompare(b.provider),
  );

  return { now, warnAfterMs, profiles, providers };
}
