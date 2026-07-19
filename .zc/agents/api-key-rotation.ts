/**
 * Provider API-key rotation wrapper.
 * Runs provider calls across configured keys on rate-limit failures and keeps
 * same-key transient retries separate from key rotation.
 */
import { normalizeUniqueStringEntries } from "@zaicoder/normalization-core/string-normalization";
import { sleepWithAbort } from "../infra/backoff.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  resolveTransientProviderAttempts,
  resolveTransientProviderDelayMs,
  resolveTransientProviderRetryOptions,
  shouldRetrySameKeyProviderOperation,
  type TransientProviderRetryConfig,
} from "../provider-runtime/operation-retry.js";
import { collectProviderAzaicoderKeys, isAzaicoderKeyRateLimitError } from "./live-auth-keys.js";

type AzaicoderKeyRetryParams = {
  azaicoderKey: string;
  error: unknown;
  attempt: number;
};

type ExecuteWithAzaicoderKeyRotationOptions<T> = {
  provider: string;
  azaicoderKeys: string[];
  execute: (azaicoderKey: string) => Promise<T>;
  shouldRetry?: (params: AzaicoderKeyRetryParams & { message: string }) => boolean;
  onRetry?: (params: AzaicoderKeyRetryParams & { message: string }) => void;
  transientRetry?: TransientProviderRetryConfig;
};

/** Collect primary and live-discovered provider keys in stable de-duped order. */
export function collectProviderAzaicoderKeysForExecution(params: {
  provider: string;
  primaryAzaicoderKey?: string;
}): string[] {
  const { primaryAzaicoderKey, provider } = params;
  return normalizeUniqueStringEntries([
    primaryAzaicoderKey?.trim() ?? "",
    ...collectProviderAzaicoderKeys(provider),
  ]);
}

/**
 * Execute a provider operation with key rotation and optional same-key transient
 * retries.
 */
export async function executeWithAzaicoderKeyRotation<T>(
  params: ExecuteWithAzaicoderKeyRotationOptions<T>,
): Promise<T> {
  const keys = normalizeUniqueStringEntries(params.azaicoderKeys);
  if (keys.length === 0) {
    throw new Error(`No API keys configured for provider "${params.provider}".`);
  }

  let lastError: unknown;
  const transientRetry = resolveTransientProviderRetryOptions(params.transientRetry);
  keyLoop: for (let azaicoderKeyIndex = 0; azaicoderKeyIndex < keys.length; azaicoderKeyIndex += 1) {
    const azaicoderKey = keys[azaicoderKeyIndex];
    const maxOperationAttempts = resolveTransientProviderAttempts(transientRetry);
    for (let attemptNumber = 1; attemptNumber <= maxOperationAttempts; attemptNumber += 1) {
      try {
        return await params.execute(azaicoderKey);
      } catch (error) {
        lastError = error;
        const message = formatErrorMessage(error);
        const rotateKey = params.shouldRetry
          ? params.shouldRetry({ azaicoderKey, error, attempt: azaicoderKeyIndex, message })
          : isAzaicoderKeyRateLimitError(message);

        if (rotateKey) {
          // A rotation signal consumes the current key and moves to the next key
          // without running same-key transient retry logic.
          if (azaicoderKeyIndex + 1 >= keys.length) {
            break;
          }
          params.onRetry?.({ azaicoderKey, error, attempt: azaicoderKeyIndex, message });
          break;
        }

        if (
          !transientRetry ||
          !shouldRetrySameKeyProviderOperation({
            options: transientRetry,
            error,
            message,
            provider: params.provider,
            azaicoderKeyIndex,
            attemptNumber,
            maxAttempts: maxOperationAttempts,
          })
        ) {
          break keyLoop;
        }

        const delayMs = resolveTransientProviderDelayMs(transientRetry, attemptNumber);
        // Same-key transient retries are bounded by provider policy and keep the
        // current key stable so auth rotation only handles key-specific failures.
        const sleep = transientRetry.sleep ?? sleepWithAbort;
        await sleep(delayMs, transientRetry.signal);
      }
    }
  }

  if (lastError === undefined) {
    throw new Error(`Failed to run API request for ${params.provider}.`);
  }
  throw toLintErrorObject(lastError, "Non-Error thrown");
}

function toLintErrorObject(value: unknown, fallbackMessage: string): Error {
  // Preserve thrown object properties for callers/tests while still satisfying
  // Error-only throw lint expectations.
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  const error = new Error(fallbackMessage, { cause: value });
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    Object.assign(error, value);
  }
  return error;
}
