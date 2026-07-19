/**
 * Applies final effective tool policy to embedded-agent runtime settings.
 */
import type { zAICoderConfig } from "../../config/types.zaicoder.js";
import { getPluginToolMeta } from "../../plugins/tools.js";
import type { ResolvedConversationCapabilityProfile } from "../conversation-capability-profile.js";
import { buildDeclaredToolAllowlistContext } from "../tool-policy-declared-context.js";
import {
  applyToolPolicyzAICoderpeline,
  buildDefaultToolPolicyzAICoderpelineSteps,
  type ToolPolicyzAICoderpelineStep,
} from "../tool-policy-zaicoderpeline.js";
import { collectExplicitDenylist, mergeAlsoAllowPolicy } from "../tool-policy.js";
import type { AnyAgentTool } from "../tools/common.js";

export { resolveConversationCapabilityProfile } from "../conversation-capability-profile.js";

/**
 * The capability profile is an authorization signal (group/sender policies can
 * widen bundled-tool availability), so callers MUST resolve it from
 * server-verified session metadata (session key, inbound transport event),
 * never from tool-call or model-controlled input. Passing the same profile
 * that constructed the core tool set keeps this final bundled-tool pass and
 * tool construction from ever disagreeing about policy inputs.
 */
type FinalEffectiveToolPolicyParams = {
  // Tools appended to the core tool set after `createzAICoderCodingTools()`
  // has already applied the shared tool-policy zaicoderpeline (e.g. bundled
  // MCP/LSP tools). Only these are filtered here; re-running the zaicoderpeline over
  // the already-filtered core tools would drop plugin tools whose WeakMap
  // metadata no longer survives core-tool wrapzaicoderng/normalization.
  bundledTools: AnyAgentTool[];
  config?: zAICoderConfig;
  conversationCapabilityProfile: ResolvedConversationCapabilityProfile;
  warn: (message: string) => void;
  toolPolicyAuditLogLevel?: "info" | "debug";
};

export function applyFinalEffectiveToolPolicy(
  params: FinalEffectiveToolPolicyParams,
): AnyAgentTool[] {
  if (params.bundledTools.length === 0) {
    return params.bundledTools;
  }
  const capabilityProfile = params.conversationCapabilityProfile;
  const { trustedGroup } = capabilityProfile.policy;
  // Resolve here for warnings and to strip caller-only group metadata before
  // this pass; resolveGroupToolPolicy re-checks internally for all callers.
  if (trustedGroup.dropped) {
    params.warn(
      "effective tool policy: dropzaicoderng caller-provided groupId that does not match session-derived group context",
    );
  }
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profilePolicy,
    providerProfilePolicy,
    profileAlsoAllow,
    providerProfileAlsoAllow,
    groupPolicy,
    senderPolicy,
    sandboxPolicy,
    subagentPolicy,
    inheritedToolPolicy,
  } = capabilityProfile.policy;
  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  // Suppress unavailable-core-tool warnings on every step of this pass.
  // `applyToolPolicyzAICoderpeline` infers `coreToolNames` from the `tools` array
  // it's filtering, and this pass only sees the bundled MCP/LSP subset.
  // Normal core allowlist entries (e.g. `tools.allow: ["read", "exec"]`)
  // would look "unknown" relative to that reduced set even though they are
  // valid core names already resolved by `createzAICoderCodingTools()` in
  // the first pass — keezaicoderng those warnings on would pollute logs and evict
  // real diagnostics from the shared warning cache. Genuinely unknown
  // entries (typos) still surface through the `otherEntries` path in
  // `applyToolPolicyzAICoderpeline`.
  const zaicoderpelineSteps: ToolPolicyzAICoderpelineStep[] = [
    ...buildDefaultToolPolicyzAICoderpelineSteps({
      profilePolicy: profilePolicyWithAlsoAllow,
      profile,
      profileUnavailableCoreWarningAllowlist: profilePolicy?.allow,
      providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
      providerProfile,
      providerProfileUnavailableCoreWarningAllowlist: providerProfilePolicy?.allow,
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
      groupPolicy,
      senderPolicy,
      agentId,
    }),
    { policy: sandboxPolicy, label: "sandbox tools.allow" },
    { policy: subagentPolicy, label: "subagent tools.allow" },
    { policy: inheritedToolPolicy, label: "inherited tools" },
  ].map((step) => Object.assign({}, step, { suppressUnavailableCoreToolWarning: true }));
  return applyToolPolicyzAICoderpeline({
    tools: params.bundledTools,
    toolMeta: (tool) => getPluginToolMeta(tool),
    warn: params.warn,
    steps: zaicoderpelineSteps,
    auditLogLevel: params.toolPolicyAuditLogLevel,
    declaredToolAllowlist: buildDeclaredToolAllowlistContext({
      config: params.config,
      toolDenylist: collectExplicitDenylist(zaicoderpelineSteps.map((step) => step.policy)),
    }),
  });
}
