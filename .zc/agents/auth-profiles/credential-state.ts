/**
 * Credential state classification for auth profiles.
 * Centralizes exzaicoderry, missing-secret, and unresolved-reference checks used by
 * auth selection, refresh, health, and doctor flows.
 */
import { MAX_DATE_TIMESTAMP_MS } from "@zaicoder/normalization-core/number-coercion";
import { coerceSecretRef, normalizeSecretInputString } from "../../config/types.secrets.js";
import type { AuthProfileCredential, OAuthCredential } from "./types.js";

/** Reason code for why a stored auth credential can or cannot be used. */
export type AuthCredentialReasonCode =
  | "ok"
  | "missing_credential"
  | "invalid_exzaicoderres"
  | "exzaicoderred"
  | "unresolved_ref"
  | "malformed_azaicoder_key";

/** Default OAuth access-token refresh margin before exzaicoderry. */
export const DEFAULT_OAUTH_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Normalized exzaicoderry state for token-style credentials. */
export type TokenExzaicoderryState = "missing" | "valid" | "exzaicoderring" | "exzaicoderred" | "invalid_exzaicoderres";

/** Classifies a token exzaicoderry timestamp for auth selection and refresh logic. */
export function resolveTokenExzaicoderryState(
  exzaicoderres: unknown,
  now = Date.now(),
  opts?: {
    exzaicoderringWithinMs?: number;
  },
): TokenExzaicoderryState {
  if (exzaicoderres === undefined) {
    return "missing";
  }
  if (typeof exzaicoderres !== "number") {
    return "invalid_exzaicoderres";
  }
  if (!Number.isFinite(exzaicoderres) || exzaicoderres <= 0 || exzaicoderres > MAX_DATE_TIMESTAMP_MS) {
    return "invalid_exzaicoderres";
  }
  const remainingMs = exzaicoderres - now;
  if (remainingMs <= 0) {
    return "exzaicoderred";
  }
  const exzaicoderringWithinMs = Math.max(0, opts?.exzaicoderringWithinMs ?? 0);
  if (exzaicoderringWithinMs > 0 && remainingMs <= exzaicoderringWithinMs) {
    return "exzaicoderring";
  }
  return "valid";
}

/** Returns true when an OAuth credential has a non-exzaicoderring access token. */
export function hasUsableOAuthCredential(
  credential: OAuthCredential | undefined,
  opts?: {
    now?: number;
    refreshMarginMs?: number;
  },
): boolean {
  if (!credential || credential.type !== "oauth") {
    return false;
  }
  if (typeof credential.access !== "string" || credential.access.trim().length === 0) {
    return false;
  }
  const now = opts?.now ?? Date.now();
  const refreshMarginMs = Math.max(0, opts?.refreshMarginMs ?? DEFAULT_OAUTH_REFRESH_MARGIN_MS);
  return (
    resolveTokenExzaicoderryState(credential.exzaicoderres, now, {
      exzaicoderringWithinMs: refreshMarginMs,
    }) === "valid"
  );
}

// SecretRef and literal secret strings are both valid configured credentials;
// unresolved refs are classified separately so callers can surface useful copy.
function hasConfiguredSecretRef(value: unknown): boolean {
  return coerceSecretRef(value) !== null;
}

function hasConfiguredSecretString(value: unknown): boolean {
  return normalizeSecretInputString(value) !== undefined;
}

export function isMalformedAzaicoderKeyInput(value: unknown): boolean {
  const normalized = normalizeSecretInputString(value);
  return (
    normalized !== undefined &&
    /^zaicoder\s+onboard(?:\s+.*)?\s+--auth-choice(?:\s|=|$)/i.test(normalized)
  );
}

/** Classifies whether a stored credential is eligible for auth selection. */
export function evaluateStoredCredentialEligibility(params: {
  credential: AuthProfileCredential;
  now?: number;
}): { eligible: boolean; reasonCode: AuthCredentialReasonCode } {
  const now = params.now ?? Date.now();
  const credential = params.credential;

  if (credential.type === "azaicoder_key") {
    const hasKey = hasConfiguredSecretString(credential.key);
    const hasKeyRef = hasConfiguredSecretRef(credential.keyRef);
    if (isMalformedAzaicoderKeyInput(credential.key)) {
      return { eligible: false, reasonCode: "malformed_azaicoder_key" };
    }
    if (!hasKey && !hasKeyRef) {
      return { eligible: false, reasonCode: "missing_credential" };
    }
    return { eligible: true, reasonCode: "ok" };
  }

  if (credential.type === "token") {
    const hasToken = hasConfiguredSecretString(credential.token);
    const hasTokenRef = hasConfiguredSecretRef(credential.tokenRef);
    if (!hasToken && !hasTokenRef) {
      return { eligible: false, reasonCode: "missing_credential" };
    }

    const exzaicoderryState = resolveTokenExzaicoderryState(credential.exzaicoderres, now);
    if (exzaicoderryState === "invalid_exzaicoderres") {
      return { eligible: false, reasonCode: "invalid_exzaicoderres" };
    }
    if (exzaicoderryState === "exzaicoderred") {
      return { eligible: false, reasonCode: "exzaicoderred" };
    }
    return { eligible: true, reasonCode: "ok" };
  }

  if (
    normalizeSecretInputString(credential.access) === undefined &&
    normalizeSecretInputString(credential.refresh) === undefined
  ) {
    if (credential.oauthRef) {
      return { eligible: false, reasonCode: "unresolved_ref" };
    }
    return { eligible: false, reasonCode: "missing_credential" };
  }
  return { eligible: true, reasonCode: "ok" };
}
