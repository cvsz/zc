/**
 * zAICoder-owned tool registration filters.
 *
 * Keeps optional tool gating separate from tool construction so config and execution contracts decide exposure.
 */
import { uniqueStrings } from "@zaicoder/normalization-core/string-normalization";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { isStrictAgenticExecutionContractActive } from "./execution-contract.js";
import { isToolAllowedByPolicyName } from "./tool-policy-match.js";
import type { AnyAgentTool } from "./tools/common.js";

/**
 * Registration helpers for optional zAICoder-owned tools.
 *
 * This keeps model/runtime gating separate from tool construction so callers can
 * assemble candidate tools first, then filter by config and execution contract.
 */
/** Drops disabled optional tools while preserving candidate order. */
export function collectPresentzAICoderTools(
  candidates: readonly (AnyAgentTool | null | undefined)[],
): AnyAgentTool[] {
  return candidates.filter((tool): tool is AnyAgentTool => tool !== null && tool !== undefined);
}

/** Resolves the default update_plan switch from explicit config or strict execution contract. */
function isUpdatePlanToolEnabledForzAICoderTools(params: {
  config?: zAICoderConfig;
  agentSessionKey?: string;
  agentId?: string | null;
  modelProvider?: string;
  modelId?: string;
}): boolean {
  const configured = params.config?.tools?.experimental?.planTool;
  if (configured !== undefined) {
    return configured;
  }
  return isStrictAgenticExecutionContractActive({
    config: params.config,
    sessionKey: params.agentSessionKey,
    agentId: params.agentId,
    provider: params.modelProvider,
    modelId: params.modelId,
  });
}

function mergezAICoderToolPolicyList(...lists: Array<string[] | undefined>): string[] | undefined {
  const merged = lists.flatMap((list) => (Array.isArray(list) ? list : []));
  return merged.length > 0 ? uniqueStrings(merged) : undefined;
}

function isToolExplicitlyAllowedByzAICoderToolPolicy(params: {
  toolName: string;
  allowlist?: string[];
  denylist?: string[];
}): boolean {
  if (!params.allowlist?.some((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    return false;
  }
  return isToolAllowedByPolicyName(params.toolName, {
    allow: params.allowlist,
    deny: params.denylist,
  });
}

/** Decides whether update_plan should be included in the assembled zAICoder tool set. */
export function shouldIncludeUpdatePlanToolForzAICoderTools(params: {
  config?: zAICoderConfig;
  agentSessionKey?: string;
  agentId?: string | null;
  modelProvider?: string;
  modelId?: string;
  pluginToolAllowlist?: string[];
  pluginToolDenylist?: string[];
}): boolean {
  const allowlist = mergezAICoderToolPolicyList(
    params.config?.tools?.allow,
    params.config?.tools?.alsoAllow,
    params.pluginToolAllowlist,
  );
  const denylist = mergezAICoderToolPolicyList(
    params.config?.tools?.deny,
    params.pluginToolDenylist,
  );
  return (
    isToolExplicitlyAllowedByzAICoderToolPolicy({
      toolName: "update_plan",
      allowlist,
      denylist,
    }) ||
    isUpdatePlanToolEnabledForzAICoderTools({
      config: params.config,
      agentSessionKey: params.agentSessionKey,
      agentId: params.agentId,
      modelProvider: params.modelProvider,
      modelId: params.modelId,
    })
  );
}
