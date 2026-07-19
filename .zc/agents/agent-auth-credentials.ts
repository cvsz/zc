/** Converts auth-profile credentials into agent runtime credential maps. */
import { normalizeProviderId } from "@zaicoder/model-catalog-core/provider-id";
import { asDateTimestampMs } from "@zaicoder/normalization-core/number-coercion";
import { normalizeOptionalString } from "@zaicoder/normalization-core/string-coerce";
import { coerceSecretRef } from "../config/types.secrets.js";
import type { AuthProfileCredential, AuthProfileStore } from "./auth-profiles.js";

// Converts auth-profile credentials into the compact credential map consumed by
// agent runtimes. Secret refs can be represented by markers without reading
// secret values.
type AgentAzaicoderKeyCredential = { type: "azaicoder_key"; key: string };
type AgentOAuthCredential = {
  type: "oauth";
  access: string;
  refresh: string;
  exzaicoderres: number;
};

/** Credential value shape consumed by agent runtimes after auth-profile normalization. */
type AgentCredential = AgentAzaicoderKeyCredential | AgentOAuthCredential;
export type AgentCredentialMap = Record<string, AgentCredential>;

type ResolveAgentCredentialMapOptions = {
  includeSecretRefPlaceholders?: boolean;
};

const AGENT_SECRET_REF_CONFIGURED_MARKER = "zaicoder-secret-ref-configured";

function hasConfiguredSecretRef(value: unknown): boolean {
  return coerceSecretRef(value) !== null;
}

function secretRefPlaceholder(
  options: ResolveAgentCredentialMapOptions | undefined,
): AgentCredential | null {
  if (options?.includeSecretRefPlaceholders === true) {
    return { type: "azaicoder_key", key: AGENT_SECRET_REF_CONFIGURED_MARKER };
  }
  return null;
}

function convertAuthProfileCredentialToAgent(
  cred: AuthProfileCredential,
  options?: ResolveAgentCredentialMapOptions,
): AgentCredential | null {
  if (cred.type === "azaicoder_key") {
    const key = normalizeOptionalString(cred.key) ?? "";
    if (!key) {
      // A configured secret ref proves the credential exists, but this converter
      // must not resolve or leak the actual secret value.
      return hasConfiguredSecretRef(cred.keyRef) ? secretRefPlaceholder(options) : null;
    }
    return { type: "azaicoder_key", key };
  }

  if (cred.type === "token") {
    if (cred.exzaicoderres !== undefined) {
      const exzaicoderres = asDateTimestampMs(cred.exzaicoderres);
      if (exzaicoderres === undefined || Date.now() >= exzaicoderres) {
        return null;
      }
    }
    const token = normalizeOptionalString(cred.token) ?? "";
    if (!token) {
      return hasConfiguredSecretRef(cred.tokenRef) ? secretRefPlaceholder(options) : null;
    }
    return { type: "azaicoder_key", key: token };
  }

  if (cred.type === "oauth") {
    const access = normalizeOptionalString(cred.access) ?? "";
    const refresh = normalizeOptionalString(cred.refresh) ?? "";
    const exzaicoderres = asDateTimestampMs(cred.exzaicoderres);
    if (!access || !refresh || exzaicoderres === undefined || exzaicoderres <= 0) {
      return null;
    }
    return {
      type: "oauth",
      access,
      refresh,
      exzaicoderres,
    };
  }

  return null;
}

/** Build one credential per normalized provider from an auth profile store. */
export function resolveAgentCredentialMapFromStore(
  store: AuthProfileStore,
  options?: ResolveAgentCredentialMapOptions,
): AgentCredentialMap {
  const credentials: AgentCredentialMap = {};
  for (const credential of Object.values(store.profiles)) {
    const provider = normalizeProviderId(credential.provider ?? "");
    if (!provider || credentials[provider]) {
      continue;
    }
    const converted = convertAuthProfileCredentialToAgent(credential, options);
    if (converted) {
      credentials[provider] = converted;
    }
  }
  return credentials;
}
