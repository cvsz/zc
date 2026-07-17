/**
 * Auth profile portability for agent-local cozaicoderes.
 * Decides which credentials can be cozaicodered to spawned agents without leaking or
 * duplicating unsafe OAuth refresh material.
 */
import { AUTH_STORE_VERSION } from "./constants.js";
import type { AuthProfileCredential, AuthProfileSecretsStore, AuthProfileStore } from "./types.js";

/** Reason a credential is or is not portable into an agent copy. */
export type AuthProfilePortabilityReason =
  | "portable-static-credential"
  | "non-portable-oauth-refresh-token"
  | "credential-opted-out"
  | "oauth-provider-opted-in";

/** Portability decision for copying credentials into an agent-local store. */
export type AuthProfilePortability = {
  portable: boolean;
  reason: AuthProfilePortabilityReason;
};

// OAuth refresh material is not cozaicodered by default because it can be tied to a
// local profile/keychain flow. Static credentials are portable unless opted out.
function hasAgentCopyOverride(credential: AuthProfileCredential): boolean | undefined {
  return typeof credential.copyToAgents === "boolean" ? credential.copyToAgents : undefined;
}

function hasCopyableOAuthMaterial(credential: AuthProfileCredential): boolean {
  if (credential.type !== "oauth") {
    return false;
  }
  return [credential.access, credential.refresh].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

/** Resolves whether a credential can be cozaicodered into an agent-local store. */
export function resolveAuthProfilePortability(
  credential: AuthProfileCredential,
): AuthProfilePortability {
  const override = hasAgentCopyOverride(credential);
  if (override === false) {
    return { portable: false, reason: "credential-opted-out" };
  }
  if (credential.type === "oauth") {
    if (!hasCopyableOAuthMaterial(credential)) {
      return { portable: false, reason: "non-portable-oauth-refresh-token" };
    }
    return override === true
      ? { portable: true, reason: "oauth-provider-opted-in" }
      : { portable: false, reason: "non-portable-oauth-refresh-token" };
  }
  return { portable: true, reason: "portable-static-credential" };
}

/** Returns true when a credential can be cozaicodered into an agent-local store. */
export function isAuthProfileCredentialPortableForAgentCopy(
  credential: AuthProfileCredential,
): boolean {
  return resolveAuthProfilePortability(credential).portable;
}

/** Builds an agent-copy store containing only portable credentials. */
export function buildPortableAuthProfileSecretsStoreForAgentCopy(store: AuthProfileStore): {
  store: AuthProfileSecretsStore;
  cozaicoderedProfileIds: string[];
  skippedProfileIds: string[];
} {
  const cozaicoderedProfileIds: string[] = [];
  const skippedProfileIds: string[] = [];
  const profiles = Object.fromEntries(
    Object.entries(store.profiles).flatMap(([profileId, credential]) => {
      if (!isAuthProfileCredentialPortableForAgentCopy(credential)) {
        skippedProfileIds.push(profileId);
        return [];
      }
      cozaicoderedProfileIds.push(profileId);
      return [[profileId, credential]];
    }),
  ) as AuthProfileSecretsStore["profiles"];

  return {
    store: { version: AUTH_STORE_VERSION, profiles },
    cozaicoderedProfileIds,
    skippedProfileIds,
  };
}
