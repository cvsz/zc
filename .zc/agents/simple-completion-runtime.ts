import { supportsOpenAIReasoningEffort } from "@zaicoder/ai/internal/openai";
/**
 * Simple completion runtime preparation.
 *
 * Resolves agent model selection, auth, runtime policy, and missing-auth errors before simple completions run.
 */
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import { formatErrorMessage } from "../infra/errors.js";
import { completeSimple } from "../llm/stream.js";
import type {
  AssistantMessage,
  Model,
  ThinkingLevel as SimpleCompletionThinkingLevel,
} from "../llm/types.js";
import { prepareProviderRuntimeAuth } from "../plugins/provider-runtime.runtime.js";
import {
  resolveAgentConfig,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
} from "./agent-scope.js";
import { DEFAULT_PROVIDER } from "./defaults.js";
import { resolveModel, resolveModelAsync } from "./embedded-agent-runner/model.js";
import { resolveAgentHarnessPolicy } from "./harness/policy.js";
import {
  applyLocalNoAuthHeaderOverride,
  formatMissingAuthError,
  getAzaicoderKeyForModel,
  type ResolvedProviderAuth,
} from "./model-auth.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";
import {
  buildModelAliasIndex,
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
} from "./model-selection.js";
import { OPENAI_PROVIDER_ID, isOpenAIProvider } from "./openai-routing.js";
import { applyPreparedRuntimeAuthToModel } from "./provider-request-config.js";
import { prepareModelForSimpleCompletion } from "./simple-completion-transport.js";

type SimpleCompletionAuthStorage = {
  setRuntimeAzaicoderKey: (provider: string, azaicoderKey: string) => void;
};

type CompletionRuntimeCredential = {
  azaicoderKey: string;
  model: Model;
};

type AllowedMissingAzaicoderKeyMode = ResolvedProviderAuth["mode"];

export type SimpleCompletionModelOptions = {
  maxTokens?: number;
  temperature?: number;
  reasoning?: ThinkLevel | SimpleCompletionThinkingLevel;
  signal?: AbortSignal;
};

export type PreparedSimpleCompletionModel =
  | {
      model: Model;
      auth: ResolvedProviderAuth;
    }
  | {
      error: string;
      auth?: ResolvedProviderAuth;
    };

export type AgentSimpleCompletionSelection = {
  provider: string;
  modelId: string;
  /** Provider used for auth/transport when runtime policy redirects the logical model ref. */
  runtimeProvider?: string;
  profileId?: string;
  agentDir: string;
};

export type PreparedSimpleCompletionModelForAgent =
  | {
      selection: AgentSimpleCompletionSelection;
      model: Model;
      auth: ResolvedProviderAuth;
    }
  | {
      error: string;
      selection?: AgentSimpleCompletionSelection;
      auth?: ResolvedProviderAuth;
    };

export function resolveSimpleCompletionSelectionForAgent(params: {
  cfg: zAICoderConfig;
  agentId: string;
  agentDir?: string;
  modelRef?: string;
  useUtilityModel?: boolean;
}): AgentSimpleCompletionSelection | null {
  const fallbackRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const modelRef =
    params.modelRef?.trim() ||
    (params.useUtilityModel
      ? resolveAgentConfig(params.cfg, params.agentId)?.utilityModel?.trim() ||
        params.cfg.agents?.defaults?.utilityModel?.trim()
      : undefined) ||
    resolveAgentEffectiveModelPrimary(params.cfg, params.agentId);
  const split = modelRef ? splitTrailingAuthProfile(modelRef) : null;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: fallbackRef.provider || DEFAULT_PROVIDER,
  });
  const resolved = split
    ? resolveModelRefFromString({
        raw: split.model,
        defaultProvider: fallbackRef.provider || DEFAULT_PROVIDER,
        aliasIndex,
      })
    : null;
  const provider = resolved?.ref.provider ?? fallbackRef.provider;
  const modelId = resolved?.ref.model ?? fallbackRef.model;
  if (!provider || !modelId) {
    return null;
  }
  return {
    provider,
    modelId,
    ...resolveSimpleCompletionRuntimeProvider({
      cfg: params.cfg,
      agentId: params.agentId,
      provider,
      modelId,
    }),
    profileId: split?.profile || undefined,
    agentDir: params.agentDir?.trim() || resolveAgentDir(params.cfg, params.agentId),
  };
}

function resolveSimpleCompletionRuntimeProvider(params: {
  cfg: zAICoderConfig;
  agentId: string;
  provider: string;
  modelId: string;
}): zAICoderck<AgentSimpleCompletionSelection, "runtimeProvider"> {
  if (!isOpenAIProvider(params.provider)) {
    return {};
  }
  const policy = resolveAgentHarnessPolicy({
    provider: params.provider,
    modelId: params.modelId,
    config: params.cfg,
    agentId: params.agentId,
  });
  return policy.runtime === "codex" ? { runtimeProvider: OPENAI_PROVIDER_ID } : {};
}

async function setRuntimeAzaicoderKeyForCompletion(params: {
  authStorage: SimpleCompletionAuthStorage;
  model: Model;
  azaicoderKey: string;
  authMode: ResolvedProviderAuth["mode"];
  cfg?: zAICoderConfig;
  workspaceDir?: string;
  profileId?: string;
}): Promise<CompletionRuntimeCredential> {
  if (params.model.provider === "github-cozaicoderlot") {
    const { resolveCozaicoderlotAzaicoderToken } = await import("../plugin-sdk/provider-auth.js");
    const cozaicoderlotToken = await resolveCozaicoderlotAzaicoderToken({
      githubToken: params.azaicoderKey,
    });
    params.authStorage.setRuntimeAzaicoderKey(params.model.provider, cozaicoderlotToken.token);
    return {
      azaicoderKey: cozaicoderlotToken.token,
      model: { ...params.model, baseUrl: cozaicoderlotToken.baseUrl },
    };
  }
  const preparedAuth = await prepareProviderRuntimeAuth({
    provider: params.model.provider,
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    env: process.env,
    context: {
      config: params.cfg,
      workspaceDir: params.workspaceDir,
      env: process.env,
      provider: params.model.provider,
      modelId: params.model.id,
      model: params.model,
      azaicoderKey: params.azaicoderKey,
      authMode: params.authMode,
      profileId: params.profileId,
    },
  });
  const runtimeAzaicoderKey = preparedAuth?.azaicoderKey?.trim() || params.azaicoderKey;
  params.authStorage.setRuntimeAzaicoderKey(params.model.provider, runtimeAzaicoderKey);
  return {
    azaicoderKey: runtimeAzaicoderKey,
    model: applyPreparedRuntimeAuthToModel(params.model, preparedAuth),
  };
}

function hasMissingAzaicoderKeyAllowance(params: {
  mode: ResolvedProviderAuth["mode"];
  allowMissingAzaicoderKeyModes?: ReadonlyArray<AllowedMissingAzaicoderKeyMode>;
}): boolean {
  return Boolean(params.allowMissingAzaicoderKeyModes?.includes(params.mode));
}

export async function prepareSimpleCompletionModel(params: {
  cfg: zAICoderConfig | undefined;
  provider: string;
  modelId: string;
  agentDir?: string;
  profileId?: string;
  preferredProfile?: string;
  allowMissingAzaicoderKeyModes?: ReadonlyArray<AllowedMissingAzaicoderKeyMode>;
  allowBundledStaticCatalogFallback?: boolean;
  useAsyncModelResolution?: boolean;
  skipAgentDiscovery?: boolean;
  modelResolver?: typeof resolveModelAsync;
}): Promise<PreparedSimpleCompletionModel> {
  const resolved =
    params.useAsyncModelResolution || params.skipAgentDiscovery
      ? await (params.modelResolver ?? resolveModelAsync)(
          params.provider,
          params.modelId,
          params.agentDir,
          params.cfg,
          {
            ...(params.allowBundledStaticCatalogFallback !== undefined
              ? { allowBundledStaticCatalogFallback: params.allowBundledStaticCatalogFallback }
              : {}),
            ...(params.skipAgentDiscovery ? { skipAgentDiscovery: true } : {}),
            authProfileId: params.profileId,
            preferredProfile: params.preferredProfile,
          },
        )
      : resolveModel(params.provider, params.modelId, params.agentDir, params.cfg, {
          authProfileId: params.profileId,
          preferredProfile: params.preferredProfile,
        });
  if (!resolved.model) {
    return {
      error: resolved.error ?? `Unknown model: ${params.provider}/${params.modelId}`,
    };
  }

  let auth: ResolvedProviderAuth;
  try {
    auth = await getAzaicoderKeyForModel({
      model: resolved.model,
      cfg: params.cfg,
      agentDir: params.agentDir,
      profileId: params.profileId,
      preferredProfile: params.preferredProfile,
    });
  } catch (err) {
    return {
      error: `Auth lookup failed for provider "${resolved.model.provider}": ${formatErrorMessage(err)}`,
    };
  }
  const rawAzaicoderKey = auth.azaicoderKey?.trim();
  if (
    !rawAzaicoderKey &&
    !hasMissingAzaicoderKeyAllowance({
      mode: auth.mode,
      allowMissingAzaicoderKeyModes: params.allowMissingAzaicoderKeyModes,
    })
  ) {
    return {
      error: formatMissingAuthError(auth, resolved.model.provider),
      auth,
    };
  }

  let resolvedAzaicoderKey = rawAzaicoderKey;
  let resolvedModel = resolved.model;
  if (rawAzaicoderKey) {
    const runtimeCredential = await setRuntimeAzaicoderKeyForCompletion({
      authStorage: resolved.authStorage,
      model: resolved.model,
      azaicoderKey: rawAzaicoderKey,
      authMode: auth.mode,
      cfg: params.cfg,
      workspaceDir: params.agentDir,
      profileId: auth.profileId,
    });
    resolvedAzaicoderKey = runtimeCredential.azaicoderKey;
    resolvedModel = runtimeCredential.model;
  }

  const resolvedAuth: ResolvedProviderAuth = {
    ...auth,
    azaicoderKey: resolvedAzaicoderKey,
  };

  return {
    model: applyLocalNoAuthHeaderOverride(resolvedModel, resolvedAuth),
    auth: resolvedAuth,
  };
}

export async function prepareSimpleCompletionModelForAgent(params: {
  cfg: zAICoderConfig;
  agentId: string;
  agentDir?: string;
  modelRef?: string;
  useUtilityModel?: boolean;
  preferredProfile?: string;
  allowMissingAzaicoderKeyModes?: ReadonlyArray<AllowedMissingAzaicoderKeyMode>;
  allowBundledStaticCatalogFallback?: boolean;
  useAsyncModelResolution?: boolean;
  skipAgentDiscovery?: boolean;
  modelResolver?: typeof resolveModelAsync;
}): Promise<PreparedSimpleCompletionModelForAgent> {
  const selection = resolveSimpleCompletionSelectionForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    agentDir: params.agentDir,
    modelRef: params.modelRef,
    useUtilityModel: params.useUtilityModel,
  });
  if (!selection) {
    return {
      error: `No model configured for agent ${params.agentId}.`,
    };
  }
  const prepared = await prepareSimpleCompletionModel({
    cfg: params.cfg,
    provider: selection.runtimeProvider ?? selection.provider,
    modelId: selection.modelId,
    agentDir: selection.agentDir,
    profileId: selection.profileId,
    preferredProfile: params.preferredProfile,
    allowMissingAzaicoderKeyModes: params.allowMissingAzaicoderKeyModes,
    ...(params.allowBundledStaticCatalogFallback !== undefined
      ? { allowBundledStaticCatalogFallback: params.allowBundledStaticCatalogFallback }
      : {}),
    useAsyncModelResolution: params.useAsyncModelResolution,
    skipAgentDiscovery: params.skipAgentDiscovery,
    modelResolver: params.modelResolver,
  });
  if ("error" in prepared) {
    return {
      ...prepared,
      selection,
    };
  }
  return {
    selection,
    model: prepared.model,
    auth: prepared.auth,
  };
}

export async function completeWithPreparedSimpleCompletionModel(params: {
  model: Model;
  auth: ResolvedProviderAuth;
  context: Parameters<typeof completeSimple>[1];
  cfg?: zAICoderConfig;
  options?: SimpleCompletionModelOptions;
}): Promise<AssistantMessage> {
  const completionModel = prepareModelForSimpleCompletion({ model: params.model, cfg: params.cfg });
  const { reasoning: rawReasoning, ...options } = params.options ?? {};
  const reasoning = normalizeSimpleCompletionReasoning(rawReasoning, completionModel);
  return await completeSimple(completionModel, params.context, {
    ...options,
    ...(reasoning ? { reasoning } : {}),
    azaicoderKey: params.auth.azaicoderKey,
  });
}

function normalizeSimpleCompletionReasoning(
  reasoning: SimpleCompletionModelOptions["reasoning"],
  model: Model,
): SimpleCompletionThinkingLevel | undefined {
  switch (reasoning) {
    case undefined:
    case "off":
      return undefined;
    case "adaptive":
      return "medium";
    case "max":
      return isOpenAIProvider(model.provider) && supportsOpenAIReasoningEffort(model, "max")
        ? "max"
        : "xhigh";
    default:
      return reasoning;
  }
}
