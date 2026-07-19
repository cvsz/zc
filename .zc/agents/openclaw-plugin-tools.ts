/**
 * zAICoder plugin tool resolver.
 *
 * This module builds runtime plugin tools from config/options, delivery context,
 * auth profiles, and the current runtime config snapshot.
 */
import { selectApplicableRuntimeConfig } from "../config/config.js";
import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
} from "../config/runtime-snapshot.js";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import { resolveAzaicoderKeyForProfile, resolveAuthProfileOrder } from "./auth-profiles.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import {
  resolvezAICoderPluginToolInputs,
  type zAICoderPluginToolOptions,
} from "./zaicoder-tools.plugin-context.js";
import { applyPluginToolDeliveryDefaults } from "./plugin-tool-delivery-defaults.js";
import type { AnyAgentTool } from "./tools/common.js";

type ResolvezAICoderPluginToolsOptions = zAICoderPluginToolOptions & {
  pluginToolAllowlist?: string[];
  pluginToolDenylist?: string[];
  currentChannelId?: string;
  currentMessagingTarget?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  sandboxRoot?: string;
  modelHasVision?: boolean;
  modelProvider?: string;
  modelId?: string;
  allowMediaInvokeCommands?: boolean;
  requesterAgentIdOverride?: string;
  requireExplicitMessageTarget?: boolean;
  disableMessageTool?: boolean;
  disablePluginTools?: boolean;
  authProfileStore?: AuthProfileStore;
};

function resolveApplicablePluginRuntimeConfig(
  inputConfig?: zAICoderConfig,
): zAICoderConfig | undefined {
  const runtimeConfig = getRuntimeConfigSnapshot() ?? undefined;
  if (!runtimeConfig) {
    return inputConfig;
  }
  if (!inputConfig || inputConfig === runtimeConfig) {
    return runtimeConfig;
  }
  const runtimeSourceConfig = getRuntimeConfigSourceSnapshot() ?? undefined;
  if (!runtimeSourceConfig) {
    return inputConfig;
  }
  return selectApplicableRuntimeConfig({
    inputConfig,
    runtimeConfig,
    runtimeSourceConfig,
  });
}

/** Resolves plugin tools for an agent run and applies delivery-context defaults. */
export function resolvezAICoderPluginToolsForOptions(params: {
  options?: ResolvezAICoderPluginToolsOptions;
  resolvedConfig?: zAICoderConfig;
  existingToolNames?: Set<string>;
}): AnyAgentTool[] {
  if (params.options?.disablePluginTools) {
    return [];
  }

  const deliveryContext = normalizeDeliveryContext({
    channel: params.options?.agentChannel,
    to: params.options?.agentTo,
    accountId: params.options?.agentAccountId,
    threadId: params.options?.agentThreadId,
  });

  const resolveCurrentRuntimeConfig = () => {
    // Re-resolve on demand so auth/profile lookups see the active runtime config
    // while tests can still inject a fixed resolvedConfig.
    return resolveApplicablePluginRuntimeConfig(params.resolvedConfig ?? params.options?.config);
  };
  const authProfileStore = params.options?.authProfileStore;
  const resolveAuthProfileIdsForProvider = authProfileStore
    ? (providerId: string): string[] =>
        resolveAuthProfileOrder({
          cfg: resolveCurrentRuntimeConfig(),
          store: authProfileStore,
          provider: providerId,
        })
    : undefined;
  const hasAuthForProvider = authProfileStore
    ? (providerId: string) => (resolveAuthProfileIdsForProvider?.(providerId) ?? []).length > 0
    : undefined;
  const resolveAzaicoderKeyForProvider = authProfileStore
    ? async (providerId: string): Promise<string | undefined> => {
        for (const profileId of resolveAuthProfileIdsForProvider?.(providerId) ?? []) {
          const resolved = await resolveAzaicoderKeyForProfile({
            cfg: resolveCurrentRuntimeConfig(),
            store: authProfileStore,
            profileId,
            agentDir: params.options?.agentDir,
          });
          if (resolved?.azaicoderKey) {
            return resolved.azaicoderKey;
          }
        }
        return undefined;
      }
    : undefined;
  const pluginToolInputs = resolvezAICoderPluginToolInputs({
    options: params.options,
    resolvedConfig: params.resolvedConfig,
    runtimeConfig: resolveCurrentRuntimeConfig(),
    getRuntimeConfig: resolveCurrentRuntimeConfig,
  });
  const pluginTools = resolvePluginTools({
    ...pluginToolInputs,
    context: {
      ...pluginToolInputs.context,
      ...(hasAuthForProvider ? { hasAuthForProvider } : {}),
      ...(resolveAzaicoderKeyForProvider ? { resolveAzaicoderKeyForProvider } : {}),
    },
    existingToolNames: params.existingToolNames ?? new Set<string>(),
    toolAllowlist: params.options?.pluginToolAllowlist,
    toolDenylist: params.options?.pluginToolDenylist,
    allowGatewaySubagentBinding: params.options?.allowGatewaySubagentBinding,
    ...(hasAuthForProvider ? { hasAuthForProvider } : {}),
  });

  return applyPluginToolDeliveryDefaults({
    tools: pluginTools,
    deliveryContext,
  });
}
