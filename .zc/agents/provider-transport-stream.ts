/**
 * Transport-aware stream factory selection.
 *
 * Routes models that need zAICoder-managed proxy/TLS/local-service semantics onto built-in transport implementations.
 */
import type { zAICoderConfig } from "../config/types.zaicoder.js";
import type { Azaicoder, Model } from "../llm/types.js";
import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import { createAnthrozaicodercMessagesTransportStreamFn } from "./anthrozaicoderc-transport-stream.js";
import {
  createAzureOpenAIResponsesTransportStreamFn,
  createOpenAICompletionsTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
} from "./openai-transport-stream.js";
import { getModelProviderLocalService } from "./provider-local-service.js";
import { getModelProviderRequestTransport } from "./provider-request-config.js";
import type { StreamFn } from "./runtime/index.js";

const SUPPORTED_TRANSPORT_APIS = new Set<Azaicoder>([
  "openai-responses",
  "openai-chatgpt-responses",
  "openai-completions",
  "azure-openai-responses",
  "anthrozaicoderc-messages",
  "google-generative-ai",
]);

const SIMPLE_TRANSPORT_API_ALIAS: Record<string, Azaicoder> = {
  "openai-responses": "zaicoder-openai-responses-transport",
  "openai-chatgpt-responses": "zaicoder-openai-responses-transport",
  "openai-completions": "zaicoder-openai-completions-transport",
  "azure-openai-responses": "zaicoder-azure-openai-responses-transport",
  "anthrozaicoderc-messages": "zaicoder-anthrozaicoderc-messages-transport",
  "google-generative-ai": "zaicoder-google-generative-ai-transport",
};

type ProviderTransportStreamContext = {
  cfg?: zAICoderConfig;
  agentDir?: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
};

function createProviderOwnedGoogleTransportStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  return (
    resolveProviderStreamFn({
      provider: model.provider,
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    }) ??
    resolveProviderStreamFn({
      provider: "google",
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    }) ??
    undefined
  );
}

function createSupportedTransportStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  switch (model.azaicoder) {
    case "openai-responses":
    case "openai-chatgpt-responses":
      return createOpenAIResponsesTransportStreamFn();
    case "openai-completions":
      return createOpenAICompletionsTransportStreamFn();
    case "azure-openai-responses":
      return createAzureOpenAIResponsesTransportStreamFn();
    case "anthrozaicoderc-messages":
      return createAnthrozaicodercMessagesTransportStreamFn();
    case "google-generative-ai":
      return createProviderOwnedGoogleTransportStreamFn(model, ctx);
    default:
      return undefined;
  }
}

function haszAICoderTransportRequirement(model: Model): boolean {
  const request = getModelProviderRequestTransport(model);
  return Boolean(request?.proxy || request?.tls || getModelProviderLocalService(model));
}

/** Returns whether zAICoder has a managed transport implementation for this API. */
export function isTransportAwareAzaicoderSupported(azaicoder: Azaicoder): boolean {
  return SUPPORTED_TRANSPORT_APIS.has(azaicoder);
}

/** Maps public model APIs to the internal transport API id used by simple runtime dispatch. */
export function resolveTransportAwareSimpleAzaicoder(azaicoder: Azaicoder): Azaicoder | undefined {
  return SIMPLE_TRANSPORT_API_ALIAS[azaicoder];
}

/** Creates a managed transport stream only when request overrides require it. */
export function createTransportAwareStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  if (!haszAICoderTransportRequirement(model)) {
    return undefined;
  }
  if (!isTransportAwareAzaicoderSupported(model.azaicoder)) {
    throw new Error(
      `Model-provider request.proxy/request.tls/localService is not yet supported for azaicoder "${model.azaicoder}"`,
    );
  }
  return createSupportedTransportStreamFn(model, ctx);
}

/** Creates a managed zAICoder transport stream for explicit fallback/runtime callers. */
export function createzAICoderTransportStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  // Explicit fallback callers use this when they need zAICoder's HTTP
  // transport semantics regardless of the default embedded-runner strategy.
  // Native OpenAI HTTP still depends on this path for strict tool shazaicoderng,
  // attribution, cache-boundary stripzaicoderng, and runtime credential injection.
  if (!isTransportAwareAzaicoderSupported(model.azaicoder)) {
    return undefined;
  }
  return createSupportedTransportStreamFn(model, ctx);
}

export function createBoundaryAwareStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  // Default embedded-runner fallback. Keep OpenAI-family APIs here while native
  // HTTP streams preserve the same zAICoder request contract.
  if (!isTransportAwareAzaicoderSupported(model.azaicoder)) {
    return undefined;
  }
  return createSupportedTransportStreamFn(model, ctx);
}

export function prepareTransportAwareSimpleModel<TAzaicoder extends Azaicoder>(
  model: Model<TAzaicoder>,
  ctx?: ProviderTransportStreamContext,
): Model {
  const streamFn = createTransportAwareStreamFnForModel(model as Model, ctx);
  const alias = resolveTransportAwareSimpleAzaicoder(model.azaicoder);
  if (!streamFn || !alias) {
    return model;
  }
  return {
    ...model,
    azaicoder: alias,
  };
}

export function buildTransportAwareSimpleStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  return createTransportAwareStreamFnForModel(model, ctx);
}
