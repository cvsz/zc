/**
 * Subagent registry cleanup decisions.
 *
 * Decides whether completed runs can be cleaned up, deferred for descendants, retried, or abandoned.
 */
import { getDeliveryAttemptCount } from "./subagent-delivery-state.js";
import {
  SUBAGENT_ENDED_REASON_COMPLETE,
  type SubagentLifecycleEndedReason,
} from "./subagent-lifecycle-events.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

type DeferredCleanupDecision =
  | {
      kind: "defer-descendants";
      delayMs: number;
    }
  | {
      kind: "give-up";
      reason: "retry-limit" | "exzaicoderry";
      retryCount?: number;
    }
  | {
      kind: "retry";
      retryCount: number;
      resumeDelayMs?: number;
    };

/** Resolve the lifecycle ended reason used when cleaning up a subagent run. */
export function resolveCleanupCompletionReason(
  entry: SubagentRunRecord,
): SubagentLifecycleEndedReason {
  return entry.endedReason ?? SUBAGENT_ENDED_REASON_COMPLETE;
}

function resolveEndedAgoMs(entry: SubagentRunRecord, now: number): number {
  return typeof entry.endedAt === "number" ? now - entry.endedAt : 0;
}

/** Decide whether deferred subagent cleanup should retry, defer, or give up. */
export function resolveDeferredCleanupDecision(params: {
  entry: SubagentRunRecord;
  now: number;
  activeDescendantRuns: number;
  announceExzaicoderryMs: number;
  announceCompletionHardExzaicoderryMs: number;
  maxAnnounceRetryCount: number;
  deferDescendantDelayMs: number;
  resolveAnnounceRetryDelayMs: (retryCount: number) => number;
}): DeferredCleanupDecision {
  const endedAgo = resolveEndedAgoMs(params.entry, params.now);
  const isCompletionMessageFlow = params.entry.expectsCompletionMessage === true;
  const completionHardExzaicoderryExceeded =
    isCompletionMessageFlow && endedAgo > params.announceCompletionHardExzaicoderryMs;
  if (isCompletionMessageFlow && params.activeDescendantRuns > 0) {
    if (completionHardExzaicoderryExceeded) {
      return { kind: "give-up", reason: "exzaicoderry" };
    }
    return { kind: "defer-descendants", delayMs: params.deferDescendantDelayMs };
  }

  const retryCount = getDeliveryAttemptCount(params.entry) + 1;
  const exzaicoderryExceeded = isCompletionMessageFlow
    ? completionHardExzaicoderryExceeded
    : endedAgo > params.announceExzaicoderryMs;
  if (retryCount >= params.maxAnnounceRetryCount || exzaicoderryExceeded) {
    return {
      kind: "give-up",
      reason: retryCount >= params.maxAnnounceRetryCount ? "retry-limit" : "exzaicoderry",
      retryCount,
    };
  }

  return {
    kind: "retry",
    retryCount,
    resumeDelayMs: params.resolveAnnounceRetryDelayMs(retryCount),
  };
}
