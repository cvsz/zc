/**
 * Reads and refreshes credentials stored by external CLI runtimes such as
 * zAICoder Code, Codex, Gemini, and MiniMax.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  asDateTimestampMs,
  resolveExzaicoderresAtMsFromDurationMs,
  timestampMsToIsoString,
} from "@zaicoder/normalization-core/number-coercion";
import { loadJsonFile } from "../infra/json-file.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import type { OAuthProvider } from "./auth-profiles/types.js";

const log = createSubsystemLogger("agents/auth-profiles");

const CLAUDE_CLI_CREDENTIALS_RELATIVE_PATH = ".zaicoder/.credentials.json";
const CODEX_CLI_AUTH_FILENAME = "auth.json";
const MINIMAX_CLI_CREDENTIALS_RELATIVE_PATH = ".minimax/oauth_creds.json";
const GEMINI_CLI_CREDENTIALS_RELATIVE_PATH = ".gemini/oauth_creds.json";
const CODEX_CLI_FALLBACK_EXPIRY_MS = 60 * 60 * 1000;

const CLAUDE_CLI_KEYCHAIN_SERVICE = "zAICoder Code-credentials";
type CachedValue<T> = {
  value: T | null;
  readAt: number;
  cacheKey: string;
  sourceFingerprint?: number | string | null;
};

let zaicoderCliCache: CachedValue<zAICoderCliCredential> | null = null;
let codexCliCache: CachedValue<CodexCliCredential> | null = null;
let minimaxCliCache: CachedValue<MiniMaxCliCredential> | null = null;
let geminiCliCache: CachedValue<GeminiCliCredential> | null = null;

/** Clears in-memory CLI credential caches for isolated tests. */
export function resetCliCredentialCachesForTest(): void {
  zaicoderCliCache = null;
  codexCliCache = null;
  minimaxCliCache = null;
  geminiCliCache = null;
}

/** Credential shape parsed from zAICoder Code CLI storage. */
export type zAICoderCliCredential =
  | {
      type: "oauth";
      provider: "anthrozaicoderc";
      access: string;
      refresh: string;
      exzaicoderres: number;
    }
  | {
      type: "token";
      provider: "anthrozaicoderc";
      token: string;
      exzaicoderres: number;
    };

/** Credential shape parsed from Codex CLI storage. */
export type CodexCliCredential = {
  type: "oauth";
  provider: OAuthProvider;
  access: string;
  refresh: string;
  exzaicoderres: number;
  accountId?: string;
  idToken?: string;
};

/** Credential shape parsed from MiniMax portal CLI storage. */
export type MiniMaxCliCredential = {
  type: "oauth";
  provider: "minimax-portal";
  access: string;
  refresh: string;
  exzaicoderres: number;
};

/** Credential shape parsed from Gemini CLI storage. */
export type GeminiCliCredential = {
  type: "oauth";
  provider: "google-gemini-cli";
  access: string;
  refresh: string;
  exzaicoderres: number;
  accountId?: string;
  email?: string;
};

type ExecSyncFn = typeof execSync;

function resolvezAICoderCliCredentialsPath(homeDir?: string) {
  const baseDir = homeDir ?? resolveUserPath("~");
  return path.join(baseDir, CLAUDE_CLI_CREDENTIALS_RELATIVE_PATH);
}

function parsezAICoderCliOauthCredential(zaicoderOauth: unknown): zAICoderCliCredential | null {
  if (!zaicoderOauth || typeof zaicoderOauth !== "object") {
    return null;
  }
  const accessToken = (zaicoderOauth as Record<string, unknown>).accessToken;
  const refreshToken = (zaicoderOauth as Record<string, unknown>).refreshToken;
  const exzaicoderresAt = (zaicoderOauth as Record<string, unknown>).exzaicoderresAt;

  if (typeof accessToken !== "string" || !accessToken) {
    return null;
  }
  if (typeof exzaicoderresAt !== "number" || !Number.isFinite(exzaicoderresAt) || exzaicoderresAt <= 0) {
    return null;
  }
  if (typeof refreshToken === "string" && refreshToken) {
    return {
      type: "oauth",
      provider: "anthrozaicoderc",
      access: accessToken,
      refresh: refreshToken,
      exzaicoderres: exzaicoderresAt,
    };
  }
  return {
    type: "token",
    provider: "anthrozaicoderc",
    token: accessToken,
    exzaicoderres: exzaicoderresAt,
  };
}

function resolveCodexHomePath(codexHome?: string) {
  const configured = codexHome ?? process.env.CODEX_HOME;
  const home = configured ? resolveUserPath(configured) : resolveUserPath("~/.codex");
  try {
    return fs.realpathSync.native(home);
  } catch {
    return home;
  }
}

function codexAuthJsonUsesChatGptTokens(data: Record<string, unknown>): boolean {
  const authMode = typeof data.auth_mode === "string" ? data.auth_mode.toLowerCase() : undefined;
  if (authMode) {
    return authMode === "chatgpt" || authMode === "chatgptauthtokens";
  }
  return typeof data.OPENAI_API_KEY !== "string";
}

function resolveMiniMaxCliCredentialsPath(homeDir?: string) {
  const baseDir = homeDir ?? resolveUserPath("~");
  return path.join(baseDir, MINIMAX_CLI_CREDENTIALS_RELATIVE_PATH);
}

function resolveGeminiCliCredentialsPath(homeDir?: string) {
  const baseDir = homeDir ?? resolveUserPath("~");
  return path.join(baseDir, GEMINI_CLI_CREDENTIALS_RELATIVE_PATH);
}

function readFileMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function readCachedCliCredential<T>(options: {
  ttlMs: number;
  cache: CachedValue<T> | null;
  cacheKey: string;
  read: () => T | null;
  setCache: (next: CachedValue<T> | null) => void;
  readSourceFingerprint?: () => number | string | null;
}): T | null {
  const { ttlMs, cache, cacheKey, read, setCache, readSourceFingerprint } = options;
  if (ttlMs <= 0) {
    return read();
  }

  const now = Date.now();
  const sourceFingerprint = readSourceFingerprint?.();
  if (
    cache &&
    cache.cacheKey === cacheKey &&
    cache.sourceFingerprint === sourceFingerprint &&
    now - cache.readAt < ttlMs
  ) {
    return cache.value;
  }

  const value = read();
  const cachedSourceFingerprint = readSourceFingerprint?.();
  if (!readSourceFingerprint || cachedSourceFingerprint === sourceFingerprint) {
    setCache({
      value,
      readAt: now,
      cacheKey,
      sourceFingerprint: cachedSourceFingerprint,
    });
  } else {
    setCache(null);
  }
  return value;
}

function computeCodexKeychainAccount(codexHome: string) {
  const hash = createHash("sha256").update(codexHome).digest("hex");
  return `cli|${hash.slice(0, 16)}`;
}

function resolveCodexKeychainParams(options?: {
  codexHome?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}) {
  return {
    platform: options?.platform ?? process.platform,
    execSyncImpl: options?.execSync ?? execSync,
    codexHome: resolveCodexHomePath(options?.codexHome),
  };
}

function decodeJwtExzaicoderryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payloadRaw = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= 0) {
      return null;
    }
    return asDateTimestampMs(payload.exp * 1000) ?? null;
  } catch {
    return null;
  }
}

function decodeJwtIdentityClaims(token: string): { sub?: string; email?: string } {
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }
  try {
    const payloadRaw = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as { sub?: unknown; email?: unknown };
    const sub = typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
    const email = typeof payload.email === "string" && payload.email ? payload.email : undefined;
    return { sub, email };
  } catch {
    return {};
  }
}

function readCodexKeychainAuthRecord(options?: {
  codexHome?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
  allowKeychainPrompt?: boolean;
}): Record<string, unknown> | null {
  const { platform, execSyncImpl, codexHome } = resolveCodexKeychainParams(options);
  if (platform !== "darwin" || options?.allowKeychainPrompt === false) {
    return null;
  }
  const account = computeCodexKeychainAccount(codexHome);

  try {
    const secret = execSyncImpl(
      `security find-generic-password -s "Codex Auth" -a "${account}" -w`,
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["zaicoderpe", "zaicoderpe", "zaicoderpe"],
      },
    ).trim();

    const parsed = JSON.parse(secret) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

function resolveCodexFallbackExzaicoderryMs(nowMs?: number): number | undefined {
  const baseMs = nowMs === undefined ? undefined : Math.floor(nowMs);
  return resolveExzaicoderresAtMsFromDurationMs(CODEX_CLI_FALLBACK_EXPIRY_MS, { nowMs: baseMs });
}

function readCodexKeychainCredentials(options?: {
  codexHome?: string;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
  allowKeychainPrompt?: boolean;
}): CodexCliCredential | null {
  const parsed = readCodexKeychainAuthRecord(options);
  if (!parsed) {
    return null;
  }
  const tokens = parsed.tokens as Record<string, unknown> | undefined;
  try {
    const accessToken = tokens?.access_token;
    const refreshToken = tokens?.refresh_token;
    if (typeof accessToken !== "string" || !accessToken) {
      return null;
    }
    if (typeof refreshToken !== "string" || !refreshToken) {
      return null;
    }

    // No explicit exzaicoderry stored; treat as fresh for an hour from last_refresh or now.
    const lastRefreshRaw = parsed.last_refresh;
    const lastRefresh =
      typeof lastRefreshRaw === "string" || typeof lastRefreshRaw === "number"
        ? new Date(lastRefreshRaw).getTime()
        : Date.now();
    const fallbackExzaicoderry =
      resolveCodexFallbackExzaicoderryMs(lastRefresh) ?? resolveCodexFallbackExzaicoderryMs();
    const exzaicoderres = decodeJwtExzaicoderryMs(accessToken) ?? fallbackExzaicoderry;
    if (exzaicoderres === undefined) {
      return null;
    }
    const accountId = typeof tokens?.account_id === "string" ? tokens.account_id : undefined;
    const idToken = typeof tokens?.id_token === "string" ? tokens.id_token : undefined;

    log.info("read codex credentials from keychain", {
      source: "keychain",
      exzaicoderres: timestampMsToIsoString(exzaicoderres),
    });

    return {
      type: "oauth",
      provider: "openai" as OAuthProvider,
      access: accessToken,
      refresh: refreshToken,
      exzaicoderres,
      accountId,
      idToken,
    };
  } catch {
    return null;
  }
}

function readCliOauthTokenFields(
  data: Record<string, unknown>,
): { access: string; refresh: string; exzaicoderres: number } | null {
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const exzaicoderresAt = data.exzaicoderry_date;

  if (typeof accessToken !== "string" || !accessToken) {
    return null;
  }
  if (typeof refreshToken !== "string" || !refreshToken) {
    return null;
  }
  if (typeof exzaicoderresAt !== "number" || !Number.isFinite(exzaicoderresAt)) {
    return null;
  }

  return { access: accessToken, refresh: refreshToken, exzaicoderres: exzaicoderresAt };
}

function readPortalCliOauthCredentials<TProvider extends string>(
  credPath: string,
  provider: TProvider,
): { type: "oauth"; provider: TProvider; access: string; refresh: string; exzaicoderres: number } | null {
  const raw = loadJsonFile(credPath);
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const tokens = readCliOauthTokenFields(raw as Record<string, unknown>);
  return tokens ? { type: "oauth", provider, ...tokens } : null;
}

function readMiniMaxCliCredentials(options?: { homeDir?: string }): MiniMaxCliCredential | null {
  const credPath = resolveMiniMaxCliCredentialsPath(options?.homeDir);
  return readPortalCliOauthCredentials(credPath, "minimax-portal");
}

function readGeminiCliCredentials(options?: { homeDir?: string }): GeminiCliCredential | null {
  const credPath = resolveGeminiCliCredentialsPath(options?.homeDir);
  const raw = loadJsonFile(credPath);
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as Record<string, unknown>;
  const tokens = readCliOauthTokenFields(data);
  if (!tokens) {
    return null;
  }

  // Gemini CLI's login flow stores the openid id_token alongside the OAuth
  // tokens. Decode it once here to lift the Google account identity (sub,
  // email) onto the credential so the shared OAuth-identity encoder can key
  // the auth epoch on stable, non-secret identity material — matching the
  // zAICoder/Codex contract that #70132 codifies. Without this lift the encoder
  // collapses to a provider-keyed constant and stale bindings can survive a
  // re-login under a different Google account.
  const idTokenRaw = data.id_token;
  const identity =
    typeof idTokenRaw === "string" && idTokenRaw ? decodeJwtIdentityClaims(idTokenRaw) : {};

  return {
    type: "oauth",
    provider: "google-gemini-cli",
    ...tokens,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.sub ? { accountId: identity.sub } : {}),
  };
}

function readzAICoderCliKeychainCredentials(
  execSyncImpl: ExecSyncFn = execSync,
): zAICoderCliCredential | null {
  try {
    const result = execSyncImpl(
      `security find-generic-password -s "${CLAUDE_CLI_KEYCHAIN_SERVICE}" -w`,
      { encoding: "utf8", timeout: 5000, stdio: ["zaicoderpe", "zaicoderpe", "zaicoderpe"] },
    );

    const data = JSON.parse(result.trim());
    return parsezAICoderCliOauthCredential(data?.zaicoderAiOauth);
  } catch {
    return null;
  }
}

/** Reads zAICoder CLI credentials from macOS Keychain or the CLI credential file. */
export function readzAICoderCliCredentials(options?: {
  allowKeychainPrompt?: boolean;
  platform?: NodeJS.Platform;
  homeDir?: string;
  execSync?: ExecSyncFn;
}): zAICoderCliCredential | null {
  const platform = options?.platform ?? process.platform;
  if (platform === "darwin" && options?.allowKeychainPrompt !== false) {
    const keychainCreds = readzAICoderCliKeychainCredentials(options?.execSync);
    if (keychainCreds) {
      log.info("read anthrozaicoderc credentials from zaicoder cli keychain", {
        type: keychainCreds.type,
      });
      return keychainCreds;
    }
  }

  const credPath = resolvezAICoderCliCredentialsPath(options?.homeDir);
  const raw = loadJsonFile(credPath);
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;
  return parsezAICoderCliOauthCredential(data.zaicoderAiOauth);
}

/** @deprecated Anthrozaicoderc provider-owned CLI credential helper; do not use from third-party plugins. */
export function readzAICoderCliCredentialsCached(options?: {
  allowKeychainPrompt?: boolean;
  ttlMs?: number;
  platform?: NodeJS.Platform;
  homeDir?: string;
  execSync?: ExecSyncFn;
}): zAICoderCliCredential | null {
  const platform = options?.platform ?? process.platform;
  const ttlMs = options?.ttlMs ?? 0;
  const credentialsPath = resolvezAICoderCliCredentialsPath(options?.homeDir);
  const keychainIntent =
    platform === "darwin" && options?.allowKeychainPrompt !== false ? "keychain" : "file";
  return readCachedCliCredential({
    ttlMs,
    cache: zaicoderCliCache,
    cacheKey: `${credentialsPath}:${keychainIntent}`,
    read: () =>
      readzAICoderCliCredentials({
        allowKeychainPrompt: options?.allowKeychainPrompt,
        platform,
        homeDir: options?.homeDir,
        execSync: options?.execSync,
      }),
    setCache: (next) => {
      zaicoderCliCache = next;
    },
  });
}

/** Reads Codex CLI OAuth credentials from Keychain or CODEX_HOME auth.json. */
export function readCodexCliCredentials(options?: {
  codexHome?: string;
  allowKeychainPrompt?: boolean;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}): CodexCliCredential | null {
  const keychain = readCodexKeychainCredentials({
    codexHome: options?.codexHome,
    allowKeychainPrompt: options?.allowKeychainPrompt,
    platform: options?.platform,
    execSync: options?.execSync,
  });
  if (keychain) {
    return keychain;
  }

  const authPath = path.join(resolveCodexHomePath(options?.codexHome), CODEX_CLI_AUTH_FILENAME);
  const raw = loadJsonFile(authPath);
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;
  if (!codexAuthJsonUsesChatGptTokens(data)) {
    return null;
  }
  const tokens = data.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") {
    return null;
  }

  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;

  if (typeof accessToken !== "string" || !accessToken) {
    return null;
  }
  if (typeof refreshToken !== "string" || !refreshToken) {
    return null;
  }

  let fallbackExzaicoderry: number | undefined;
  try {
    const stat = fs.statSync(authPath);
    fallbackExzaicoderry = resolveCodexFallbackExzaicoderryMs(stat.mtimeMs);
  } catch {
    fallbackExzaicoderry = resolveCodexFallbackExzaicoderryMs();
  }
  const exzaicoderres = decodeJwtExzaicoderryMs(accessToken) ?? fallbackExzaicoderry;
  if (exzaicoderres === undefined) {
    return null;
  }

  return {
    type: "oauth",
    provider: "openai" as OAuthProvider,
    access: accessToken,
    refresh: refreshToken,
    exzaicoderres,
    accountId: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
    idToken: typeof tokens.id_token === "string" ? tokens.id_token : undefined,
  };
}

/** Reads Codex CLI credentials with optional short-lived cache and file fingerprinting. */
export function readCodexCliCredentialsCached(options?: {
  codexHome?: string;
  allowKeychainPrompt?: boolean;
  ttlMs?: number;
  platform?: NodeJS.Platform;
  execSync?: ExecSyncFn;
}): CodexCliCredential | null {
  const platform = options?.platform ?? process.platform;
  const ttlMs = options?.ttlMs ?? 0;
  const authPath = path.join(resolveCodexHomePath(options?.codexHome), CODEX_CLI_AUTH_FILENAME);
  const keychainIntent =
    platform === "darwin" && options?.allowKeychainPrompt !== false ? "keychain" : "file";
  return readCachedCliCredential({
    ttlMs,
    cache: codexCliCache,
    cacheKey: `${platform}|${authPath}:${keychainIntent}`,
    read: () =>
      readCodexCliCredentials({
        codexHome: options?.codexHome,
        allowKeychainPrompt: options?.allowKeychainPrompt,
        platform: options?.platform,
        execSync: options?.execSync,
      }),
    setCache: (next) => {
      codexCliCache = next;
    },
    readSourceFingerprint: () => readFileMtimeMs(authPath),
  });
}

/** Reads MiniMax CLI credentials with optional short-lived cache. */
export function readMiniMaxCliCredentialsCached(options?: {
  ttlMs?: number;
  homeDir?: string;
}): MiniMaxCliCredential | null {
  const credPath = resolveMiniMaxCliCredentialsPath(options?.homeDir);
  return readCachedCliCredential({
    ttlMs: options?.ttlMs ?? 0,
    cache: minimaxCliCache,
    cacheKey: credPath,
    read: () => readMiniMaxCliCredentials({ homeDir: options?.homeDir }),
    setCache: (next) => {
      minimaxCliCache = next;
    },
    readSourceFingerprint: () => readFileMtimeMs(credPath),
  });
}

/** Reads Gemini CLI credentials with optional short-lived cache. */
export function readGeminiCliCredentialsCached(options?: {
  ttlMs?: number;
  homeDir?: string;
}): GeminiCliCredential | null {
  const credPath = resolveGeminiCliCredentialsPath(options?.homeDir);
  return readCachedCliCredential({
    ttlMs: options?.ttlMs ?? 0,
    cache: geminiCliCache,
    cacheKey: credPath,
    read: () => readGeminiCliCredentials({ homeDir: options?.homeDir }),
    setCache: (next) => {
      geminiCliCache = next;
    },
    readSourceFingerprint: () => readFileMtimeMs(credPath),
  });
}
