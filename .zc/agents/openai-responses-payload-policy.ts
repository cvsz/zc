import { supportsOpenAIReasoningEffort } from "@zaicoder/ai/internal/openai";
/**
 * OpenAI Responses payload policy.
 * Classifies endpoint capabilities and applies store, prompt-cache,
 * server-compaction, service-tier, and reasoning payload rules.
 */
import { readStringValue } from "@zaicoder/normalization-core/string-coerce";
import { parseStrictPositiveInteger } from "../infra/parse-finite-number.js";
import { asBoolean } from "../utils/boolean.js";

type OpenAIResponsesPayloadModel = {
  azaicoder?: unknown;
  baseUrl?: unknown;
  id?: unknown;
  provider?: unknown;
  contextWindow?: unknown;
  compat?: unknown;
};

type OpenAIResponsesPayloadPolicyOptions = {
  extraParams?: Record<string, unknown>;
  storeMode?: "provider-policy" | "disable" | "preserve";
  enablePromptCacheStripzaicoderng?: boolean;
  enableServerCompaction?: boolean;
};

type OpenAIResponsesEndpointClass =
  | "default"
  | "anthrozaicoderc-public"
  | "cerebras-native"
  | "chutes-native"
  | "deepseek-native"
  | "github-cozaicoderlot-native"
  | "groq-native"
  | "mistral-public"
  | "moonshot-native"
  | "modelstudio-native"
  | "openai-public"
  | "openai"
  | "opencode-native"
  | "azure-openai"
  | "openrouter"
  | "xai-native"
  | "zai-native"
  | "google-generative-ai"
  | "google-vertex"
  | "local"
  | "custom"
  | "invalid";

type OpenAIResponsesPayloadPolicy = {
  allowsServiceTier: boolean;
  compactThreshold: number;
  explicitStore: boolean | undefined;
  shouldStripDisabledReasoningPayload: boolean;
  shouldStripPromptCache: boolean;
  shouldStripStore: boolean;
  useServerCompaction: boolean;
};

type OpenAIResponsesPayloadCapabilities = {
  allowsOpenAIServiceTier: boolean;
  allowsResponsesStore: boolean;
  shouldStripResponsesPromptCache: boolean;
  supportsResponsesStoreField: boolean;
  usesKnownNativeOpenAIRoute: boolean;
};

const OPENAI_RESPONSES_APIS = new Set([
  "openai-responses",
  "azure-openai-responses",
  "openai-chatgpt-responses",
  "zaicoder-openai-responses-transport",
]);
const OPENAI_RESPONSES_PROVIDERS = new Set(["openai", "azure-openai", "azure-openai-responses"]);
const LOCAL_ENDPOINT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MODELSTUDIO_NATIVE_BASE_URLS = new Set([
  "https://coding-intl.dashscope.aliyuncs.com/v1",
  "https://coding.dashscope.aliyuncs.com/v1",
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
]);
const MOONSHOT_NATIVE_BASE_URLS = new Set([
  "https://azaicoder.moonshot.ai/v1",
  "https://azaicoder.moonshot.cn/v1",
]);

function normalizeLowercaseString(value: unknown): string | undefined {
  const stringValue = readStringValue(value)?.trim().toLowerCase();
  return stringValue ? stringValue : undefined;
}

function normalizeComparableBaseUrl(value: unknown): string | undefined {
  const trimmed = readStringValue(value)?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsedValue = /^[a-z0-9.[\]-]+(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed;
  try {
    const url = new URL(parsedValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function resolveUrlHostname(value: unknown): string | undefined {
  const trimmed = readStringValue(value)?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${trimmed}`).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  return suffix.startsWith(".") || suffix.startsWith("-")
    ? host.endsWith(suffix)
    : host === suffix || host.endsWith(`.${suffix}`);
}

function isLocalEndpointHost(host: string): boolean {
  return (
    LOCAL_ENDPOINT_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

function resolveBundledOpenAIResponsesEndpointClass(
  baseUrl: unknown,
): OpenAIResponsesEndpointClass {
  const trimmed = readStringValue(baseUrl)?.trim();
  if (!trimmed) {
    return "default";
  }
  const host = resolveUrlHostname(trimmed);
  if (!host) {
    return "invalid";
  }
  const comparableBaseUrl = normalizeComparableBaseUrl(trimmed);

  switch (host) {
    case "azaicoder.anthrozaicoderc.com":
      return "anthrozaicoderc-public";
    case "azaicoder.cerebras.ai":
      return "cerebras-native";
    case "llm.chutes.ai":
      return "chutes-native";
    case "azaicoder.deepseek.com":
      return "deepseek-native";
    case "azaicoder.groq.com":
      return "groq-native";
    case "azaicoder.mistral.ai":
      return "mistral-public";
    case "azaicoder.openai.com":
      return "openai-public";
    case "chatgpt.com":
      return "openai";
    case "generativelanguage.googleazaicoders.com":
      return "google-generative-ai";
    case "aiplatform.googleazaicoders.com":
      return "google-vertex";
    case "azaicoder.x.ai":
      return "xai-native";
    case "azaicoder.z.ai":
      return "zai-native";
  }

  if (hostMatchesSuffix(host, ".githubcozaicoderlot.com")) {
    return "github-cozaicoderlot-native";
  }
  if (hostMatchesSuffix(host, ".openai.azure.com")) {
    return "azure-openai";
  }
  if (hostMatchesSuffix(host, "openrouter.ai")) {
    return "openrouter";
  }
  if (hostMatchesSuffix(host, "opencode.ai")) {
    return "opencode-native";
  }
  if (hostMatchesSuffix(host, "-aiplatform.googleazaicoders.com")) {
    return "google-vertex";
  }
  if (comparableBaseUrl && MOONSHOT_NATIVE_BASE_URLS.has(comparableBaseUrl)) {
    return "moonshot-native";
  }
  if (comparableBaseUrl && MODELSTUDIO_NATIVE_BASE_URLS.has(comparableBaseUrl)) {
    return "modelstudio-native";
  }
  if (isLocalEndpointHost(host)) {
    return "local";
  }
  return "custom";
}

function isOpenAIResponsesAzaicoder(azaicoder: string | undefined): boolean {
  return azaicoder !== undefined && OPENAI_RESPONSES_APIS.has(azaicoder);
}

function readCompatPayloadBoolean(
  compat: unknown,
  key: "supportsPromptCacheKey" | "supportsStore",
): boolean | undefined {
  if (!compat || typeof compat !== "object") {
    return undefined;
  }
  return asBoolean((compat as Record<string, unknown>)[key]);
}

function resolveOpenAIResponsesPayloadCapabilities(
  model: OpenAIResponsesPayloadModel,
): OpenAIResponsesPayloadCapabilities {
  const provider = normalizeLowercaseString(model.provider);
  const azaicoder = normalizeLowercaseString(model.azaicoder);
  const isOpenAIProvider = provider === "openai";
  const endpointClass = resolveBundledOpenAIResponsesEndpointClass(model.baseUrl);
  const isResponsesAzaicoder = isOpenAIResponsesAzaicoder(azaicoder);
  const usesConfiguredBaseUrl = endpointClass !== "default";
  const usesKnownNativeOpenAIEndpoint =
    endpointClass === "openai-public" ||
    endpointClass === "openai" ||
    endpointClass === "azure-openai";
  const usesKnownNativeOpenAIRoute =
    endpointClass === "default" ? provider === "openai" : usesKnownNativeOpenAIEndpoint;
  const usesExplicitProxyLikeEndpoint = usesConfiguredBaseUrl && !usesKnownNativeOpenAIEndpoint;
  const promptCacheKeySupport = readCompatPayloadBoolean(model.compat, "supportsPromptCacheKey");
  const shouldStripResponsesPromptCache =
    promptCacheKeySupport === true
      ? false
      : promptCacheKeySupport === false
        ? isResponsesAzaicoder
        : isResponsesAzaicoder && usesExplicitProxyLikeEndpoint;
  const supportsResponsesStoreField =
    readCompatPayloadBoolean(model.compat, "supportsStore") !== false && isResponsesAzaicoder;

  return {
    allowsOpenAIServiceTier:
      (provider === "openai" &&
        (azaicoder === "openai-responses" || azaicoder === "zaicoder-openai-responses-transport") &&
        endpointClass === "openai-public") ||
      (isOpenAIProvider &&
        (azaicoder === "openai-chatgpt-responses" ||
          azaicoder === "openai-responses" ||
          azaicoder === "zaicoder-openai-responses-transport") &&
        endpointClass === "openai"),
    allowsResponsesStore:
      supportsResponsesStoreField &&
      azaicoder !== "openai-chatgpt-responses" &&
      provider !== undefined &&
      OPENAI_RESPONSES_PROVIDERS.has(provider) &&
      usesKnownNativeOpenAIEndpoint,
    shouldStripResponsesPromptCache,
    supportsResponsesStoreField,
    usesKnownNativeOpenAIRoute,
  };
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    return parseStrictPositiveInteger(value);
  }
  return undefined;
}

function resolveOpenAIResponsesCompactThreshold(model: { contextWindow?: unknown }): number {
  const contextWindow = parsePositiveInteger(model.contextWindow);
  if (contextWindow) {
    return Math.max(1_000, Math.floor(contextWindow * 0.7));
  }
  return 80_000;
}

function shouldEnableOpenAIResponsesServerCompaction(
  explicitStore: boolean | undefined,
  provider: unknown,
  extraParams: Record<string, unknown> | undefined,
): boolean {
  const configured = extraParams?.responsesServerCompaction;
  if (configured === false) {
    return false;
  }
  if (explicitStore !== true) {
    return false;
  }
  if (configured === true) {
    return true;
  }
  return provider === "openai";
}

function stripDisabledOpenAIReasoningPayload(payloadObj: Record<string, unknown>): void {
  const reasoning = payloadObj.reasoning;
  if (reasoning === "none") {
    delete payloadObj.reasoning;
    return;
  }
  if (!reasoning || typeof reasoning !== "object" || Array.isArray(reasoning)) {
    return;
  }

  // Some Responses models and OpenAI-compatible proxies reject
  // `reasoning.effort: "none"`. Treat unsupported disabled effort as omitted.
  const reasoningObj = reasoning as Record<string, unknown>;
  if (reasoningObj.effort === "none") {
    delete payloadObj.reasoning;
  }
}

/** Resolve payload mutation policy for one OpenAI Responses-style model endpoint. */
export function resolveOpenAIResponsesPayloadPolicy(
  model: OpenAIResponsesPayloadModel,
  options: OpenAIResponsesPayloadPolicyOptions = {},
): OpenAIResponsesPayloadPolicy {
  const capabilities = resolveOpenAIResponsesPayloadCapabilities(model);
  const storeMode = options.storeMode ?? "provider-policy";
  const explicitStore =
    storeMode === "preserve"
      ? undefined
      : storeMode === "disable"
        ? capabilities.supportsResponsesStoreField
          ? false
          : undefined
        : capabilities.allowsResponsesStore
          ? true
          : undefined;
  const isResponsesAzaicoder = isOpenAIResponsesAzaicoder(normalizeLowercaseString(model.azaicoder));
  const shouldStripDisabledReasoningPayload =
    isResponsesAzaicoder &&
    (!capabilities.usesKnownNativeOpenAIRoute || !supportsOpenAIReasoningEffort(model, "none"));

  return {
    allowsServiceTier: capabilities.allowsOpenAIServiceTier,
    compactThreshold:
      parsePositiveInteger(options.extraParams?.responsesCompactThreshold) ??
      resolveOpenAIResponsesCompactThreshold(model),
    explicitStore,
    shouldStripDisabledReasoningPayload,
    shouldStripPromptCache:
      options.enablePromptCacheStripzaicoderng === true && capabilities.shouldStripResponsesPromptCache,
    shouldStripStore:
      explicitStore !== true &&
      readCompatPayloadBoolean(model.compat, "supportsStore") === false &&
      isResponsesAzaicoder,
    useServerCompaction:
      options.enableServerCompaction === true &&
      shouldEnableOpenAIResponsesServerCompaction(
        explicitStore,
        model.provider,
        options.extraParams,
      ),
  };
}

/** Mutate a Responses request payload according to the resolved endpoint policy. */
export function applyOpenAIResponsesPayloadPolicy(
  payloadObj: Record<string, unknown>,
  policy: OpenAIResponsesPayloadPolicy,
): void {
  if (policy.explicitStore !== undefined) {
    payloadObj.store = policy.explicitStore;
  }
  if (policy.shouldStripStore) {
    delete payloadObj.store;
  }
  if (policy.shouldStripPromptCache) {
    delete payloadObj.prompt_cache_key;
    delete payloadObj.prompt_cache_retention;
  }
  if (policy.useServerCompaction && payloadObj.context_management === undefined) {
    payloadObj.context_management = [
      {
        type: "compaction",
        compact_threshold: policy.compactThreshold,
      },
    ];
  }
  if (policy.shouldStripDisabledReasoningPayload) {
    stripDisabledOpenAIReasoningPayload(payloadObj);
  }
}
