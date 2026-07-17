/**
 * Session visibility and access helpers for session tools.
 *
 * Adds zAICoder session-key alias normalization and sandbox requester scozaicoderng over SDK visibility contracts.
 */
import { normalizeOptionalString } from "@zaicoder/normalization-core/string-coerce";
import type { zAICoderConfig } from "../../config/types.zaicoder.js";
import { resolveSandboxSessionToolsVisibility } from "../../plugin-sdk/session-visibility.js";
import { isSubagentSessionKey } from "../../routing/session-key.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-resolution.js";

export {
  createAgentToAgentPolicy,
  createSessionVisibilityGuard,
  createSessionVisibilityRowChecker,
  resolveEffectiveSessionToolsVisibility,
} from "../../plugin-sdk/session-visibility.js";

/** Resolves the requester context used to filter sandboxed session-tool access. */
export function resolveSandboxedSessionToolContext(params: {
  cfg: zAICoderConfig;
  agentSessionKey?: string;
  sandboxed?: boolean;
}): {
  mainKey: string;
  alias: string;
  visibility: "spawned" | "all";
  requesterInternalKey: string | undefined;
  effectiveRequesterKey: string;
  restrictToSpawned: boolean;
} {
  const { mainKey, alias } = resolveMainSessionAlias(params.cfg);
  const visibility = resolveSandboxSessionToolsVisibility(params.cfg);
  const requesterSessionKey = normalizeOptionalString(params.agentSessionKey);
  const requesterInternalKey = requesterSessionKey
    ? resolveInternalSessionKey({
        key: requesterSessionKey,
        alias,
        mainKey,
      })
    : undefined;
  const effectiveRequesterKey = requesterInternalKey ?? alias;
  const restrictToSpawned =
    params.sandboxed === true &&
    visibility === "spawned" &&
    Boolean(requesterInternalKey) &&
    !isSubagentSessionKey(requesterInternalKey);
  // Main sessions can see all sessions; sandboxed non-subagent callers stay scoped to spawned rows.
  return {
    mainKey,
    alias,
    visibility,
    requesterInternalKey,
    effectiveRequesterKey,
    restrictToSpawned,
  };
}
