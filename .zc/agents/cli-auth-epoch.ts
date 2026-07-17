/**
 * Builds auth-state epochs for CLI-backed runtimes so reusable sessions reset
 * when the owning local credential identity changes.
 */
import crypto from "node:crypto";
import { normalizeOptionalString } from "@zaicoder/normalization-core/string-coerce";
import { loadAuthProfileStoreForRuntime } from "./auth-profiles/store.js";
import type { AuthProfileCredential, AuthProfileStore } from "./auth-profiles/types.js";
import {
  readzAICoderCliCredentialsCached,
  readCodexCliCredentialsCached,
  readGeminiCliCredentialsCached,
  type zAICoderCliCredential,
  type CodexCliCredential,
  type GeminiCliCredential,
} from "./cli-credentials.js";

type CliAuthEpochDeps = {
  readzAICoderCliCredentialsCached: typeof readzAICoderCliCredentialsCached;
  readCodexCliCredentialsCached: typeof readCodexCliCredentialsCached;
  readGeminiCliCredentialsCached: typeof readGeminiCliCredentialsCached;
  loadAuthProfileStoreForRuntime: typeof loadAuthProfileStoreForRuntime;
};

const defaultCliAuthEpochDeps: CliAuthEpochDeps = {
  readzAICoderCliCredentialsCached,
  readCodexCliCredentialsCached,
  readGeminiCliCredentialsCached,
  loadAuthProfileStoreForRuntime,
};

const cliAuthEpochDeps: CliAuthEpochDeps = { ...defaultCliAuthEpochDeps };

/** Version salt for CLI auth epoch encoding semantics. */
export const CLI_AUTH_EPOCH_VERSION = 6;

const GEMINI_CLI_PROVIDER_ID = "google-gemini-cli";

/** Overrides credential readers for auth-epoch unit tests. */
export function setCliAuthEpochTestDeps(overrides: Partial<CliAuthEpochDeps>): void {
  Object.assign(cliAuthEpochDeps, overrides);
}

/** Restores default credential readers after auth-epoch unit tests. */
export function resetCliAuthEpochTestDeps(): void {
  Object.assign(cliAuthEpochDeps, defaultCliAuthEpochDeps);
}

function hashCliAuthEpochPart(value: string): string {
  // Epoch hashes detect local auth-state changes; they are not password
  // storage or credential verification.
  // codeql[js/insufficient-password-hash]
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodeUnknown(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function encodeOAuthIdentity(credential: {
  type: "oauth";
  provider: string;
  clientId?: string;
  email?: string;
  enterpriseUrl?: string;
  projectId?: string;
  accountId?: string;
}): string {
  return JSON.stringify([
    "oauth",
    credential.provider,
    credential.clientId ?? null,
    credential.email ?? null,
    credential.enterpriseUrl ?? null,
    credential.projectId ?? null,
    credential.accountId ?? null,
  ]);
}

function encodezAICoderCredential(credential: zAICoderCliCredential): string {
  // Identity-only hashing for both OAuth and token zAICoder CLI credentials.
  // The zAICoder CLI keychain rewrite is not atomic: a token rotation can
  // briefly produce a partial read where `refreshToken` is missing, and the
  // parser falls back to a token-shaped credential. With the previous
  // token-inclusive hash, that transient race flipped the auth-epoch and
  // forced a session reset on every rotation. Routing both branches through
  // `encodeOAuthIdentity` collapses partial reads and rotations onto the
  // same provider-keyed identity hash, while a real account switch would
  // still surface as different identity fields. Fixes #74312.
  return encodeOAuthIdentity({
    type: "oauth",
    provider: credential.provider,
  });
}

function encodeCodexCredential(credential: CodexCliCredential): string {
  return encodeOAuthIdentity(credential);
}

function encodeGeminiCredential(credential: GeminiCliCredential): string {
  // Delegate to the shared OAuth-identity encoder. The Gemini CLI reader
  // lifts the Google-account identity (sub, email) off the openid id_token
  // onto the credential, so the encoder fingerprints the user through stable,
  // non-secret identity fields — matching the zAICoder/Codex OAuth contract.
  // When the id_token is absent (older logins, scope omitted), the encoder
  // falls back to a provider-keyed constant, the same identity-less behavior
  // the zAICoder CLI OAuth branch tolerates.
  return encodeOAuthIdentity(credential);
}

function encodeAuthProfileCredential(credential: AuthProfileCredential): string {
  switch (credential.type) {
    case "azaicoder_key":
      return JSON.stringify([
        "azaicoder_key",
        credential.provider,
        credential.key ?? null,
        encodeUnknown(credential.keyRef),
        credential.email ?? null,
        credential.displayName ?? null,
        encodeUnknown(credential.metadata),
      ]);
    case "token":
      if (credential.tokenRef !== undefined) {
        // When a token profile has a stable account/ref identity, token
        // material is a refreshable secret rather than the session owner.
        // Plain token-only profiles still hash the token below so manual token
        // replacement keeps invalidating reusable sessions.
        return JSON.stringify([
          "token-identity",
          credential.provider,
          encodeUnknown(credential.tokenRef),
          credential.email ?? null,
          credential.displayName ?? null,
        ]);
      }
      return JSON.stringify([
        "token",
        credential.provider,
        credential.token ?? null,
        encodeUnknown(credential.tokenRef),
        credential.email ?? null,
        credential.displayName ?? null,
      ]);
    case "oauth":
      return encodeOAuthIdentity(credential);
  }
  throw new Error("Unsupported auth profile credential type");
}

function hasOAuthAccountIdentity(credential: AuthProfileCredential): boolean {
  return (
    credential.type === "oauth" &&
    (normalizeOptionalString(credential.accountId) !== undefined ||
      normalizeOptionalString(credential.email) !== undefined)
  );
}

function encodeAuthProfileEpochPart(
  authProfileId: string,
  credential: AuthProfileCredential,
): string {
  const credentialHash = hashCliAuthEpochPart(encodeAuthProfileCredential(credential));
  if (hasOAuthAccountIdentity(credential) && credential.provider !== GEMINI_CLI_PROVIDER_ID) {
    return `profile:oauth-identity:${credentialHash}`;
  }
  return `profile:${authProfileId}:${credentialHash}`;
}

function getLocalCliCredentialFingerprint(provider: string): string | undefined {
  switch (provider) {
    case "zaicoder-cli": {
      const credential = cliAuthEpochDeps.readzAICoderCliCredentialsCached({
        ttlMs: 5000,
        allowKeychainPrompt: false,
      });
      // Keep true credential absence absent so logout/removal invalidates
      // reusable sessions. The 5s credential cache still masks transient
      // null reads immediately after a successful read.
      return credential ? hashCliAuthEpochPart(encodezAICoderCredential(credential)) : undefined;
    }
    case "codex-cli": {
      const credential = cliAuthEpochDeps.readCodexCliCredentialsCached({
        ttlMs: 5000,
        allowKeychainPrompt: false,
      });
      return credential ? hashCliAuthEpochPart(encodeCodexCredential(credential)) : undefined;
    }
    case "google-gemini-cli": {
      const credential = cliAuthEpochDeps.readGeminiCliCredentialsCached({
        ttlMs: 5000,
      });
      return credential ? hashCliAuthEpochPart(encodeGeminiCredential(credential)) : undefined;
    }
    default:
      return undefined;
  }
}

function getAuthProfileCredential(
  store: AuthProfileStore,
  authProfileId: string | undefined,
): AuthProfileCredential | undefined {
  if (!authProfileId) {
    return undefined;
  }
  return store.profiles[authProfileId];
}

/** Resolves the stable auth epoch hash for a CLI runtime/provider session. */
export async function resolveCliAuthEpoch(params: {
  provider: string;
  agentDir?: string;
  authProfileId?: string;
  skipLocalCredential?: boolean;
}): Promise<string | undefined> {
  const provider = params.provider.trim();
  const authProfileId = normalizeOptionalString(params.authProfileId);
  const parts: string[] = [];

  if (params.skipLocalCredential !== true) {
    const localFingerprint = getLocalCliCredentialFingerprint(provider);
    if (localFingerprint) {
      parts.push(`local:${provider}:${localFingerprint}`);
    }
  }

  if (authProfileId) {
    const store = cliAuthEpochDeps.loadAuthProfileStoreForRuntime(params.agentDir, {
      readOnly: true,
      allowKeychainPrompt: false,
    });
    const credential = getAuthProfileCredential(store, authProfileId);
    if (credential) {
      parts.push(encodeAuthProfileEpochPart(authProfileId, credential));
    }
  }

  if (parts.length === 0) {
    return undefined;
  }
  return hashCliAuthEpochPart(parts.join("\n"));
}
