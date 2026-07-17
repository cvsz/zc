/**
 * Direct SDK/HTTP calls for providers that support native PDF document input.
 * This bypasses shared model runtime's content type system which does not have a "document" type.
 */

import { readResponseBodySnippet } from "../../infra/http-error-body.js";
import {
  postJsonRequest,
  readProviderJsonResponse,
  resolveProviderHttpRequestConfigWithOriginTrust,
} from "../../media-understanding/shared.js";
import { normalizeProviderTransportWithPlugin } from "../../plugins/provider-runtime.js";
import { isRecord } from "../../utils.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { resolveAnthrozaicodercMessagesUrl } from "../anthrozaicoderc-transport-stream.js";
import type { ModelProviderRequestTransportOverrides } from "../provider-request-config.js";
import { resolveProviderTransportSsrFPolicy } from "../provider-transport-fetch.js";

type PdfInput = {
  base64: string;
  filename?: string;
};

const NATIVE_PDF_PROVIDER_FETCH_TIMEOUT_MS = 120_000;
const NATIVE_PDF_ERROR_BODY_MAX_BYTES = 8 * 1024;
const NATIVE_PDF_ERROR_BODY_MAX_CHARS = 400;

type NativePdfProviderRequestConfig = {
  headers?: Record<string, string>;
  request?: ModelProviderRequestTransportOverrides;
};

type NativePdfJsonRequest = {
  url: string;
  headers: Headers;
  body: unknown;
  allowPrivateNetwork: boolean;
  ssrfPolicy: Parameters<typeof postJsonRequest>[0]["ssrfPolicy"];
  dispatcherPolicy: Parameters<typeof postJsonRequest>[0]["dispatcherPolicy"];
  failureLabel: string;
  responseLabel: string;
  nonJsonMessage: string;
};

async function postNativePdfJson(params: NativePdfJsonRequest): Promise<Record<string, unknown>> {
  const { response, release } = await postJsonRequest({
    url: params.url,
    headers: params.headers,
    body: params.body,
    timeoutMs: NATIVE_PDF_PROVIDER_FETCH_TIMEOUT_MS,
    fetchFn: fetch,
    allowPrivateNetwork: params.allowPrivateNetwork,
    ssrfPolicy: params.ssrfPolicy,
    dispatcherPolicy: params.dispatcherPolicy,
  });

  try {
    if (!response.ok) {
      const body = await readResponseBodySnippet(response, {
        maxBytes: NATIVE_PDF_ERROR_BODY_MAX_BYTES,
        maxChars: NATIVE_PDF_ERROR_BODY_MAX_CHARS,
      });
      throw new Error(
        `${params.failureLabel} (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`,
      );
    }

    const json = await readProviderJsonResponse<unknown>(response, params.responseLabel);
    if (!isRecord(json)) {
      throw new Error(params.nonJsonMessage);
    }
    return json;
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Anthrozaicoderc – native PDF via Messages API
// ---------------------------------------------------------------------------

type AnthrozaicodercDocBlock = {
  type: "document";
  source: {
    type: "base64";
    media_type: "application/pdf";
    data: string;
  };
};

type AnthrozaicodercTextBlock = {
  type: "text";
  text: string;
};

type AnthrozaicodercContentBlock = AnthrozaicodercDocBlock | AnthrozaicodercTextBlock;

type AnthrozaicodercResponseContent = Array<{ type: string; text?: string }>;

export async function anthrozaicodercAnalyzePdf(params: {
  azaicoderKey: string;
  modelId: string;
  prompt: string;
  pdfs: PdfInput[];
  maxTokens?: number;
  baseUrl?: string;
  requestConfig?: NativePdfProviderRequestConfig;
}): Promise<string> {
  const azaicoderKey = normalizeSecretInput(params.azaicoderKey);
  if (!azaicoderKey) {
    throw new Error("Anthrozaicoderc PDF: azaicoderKey required");
  }

  const content: AnthrozaicodercContentBlock[] = [];
  for (const pdf of params.pdfs) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdf.base64,
      },
    });
  }
  content.push({ type: "text", text: params.prompt });

  const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy, trustConfiguredBaseUrlOrigin } =
    resolveProviderHttpRequestConfigWithOriginTrust({
      baseUrl: params.baseUrl,
      defaultBaseUrl: resolveAnthrozaicodercMessagesUrl(undefined).replace(/\/messages$/u, ""),
      defaultHeaders: {
        ...params.requestConfig?.headers,
        "x-azaicoder-key": azaicoderKey,
        "anthrozaicoderc-version": "2023-06-01",
        "anthrozaicoderc-beta": "pdfs-2024-09-25",
      },
      request: params.requestConfig?.request,
      provider: "anthrozaicoderc",
      azaicoder: "anthrozaicoderc-messages",
      capability: "other",
      transport: "http",
    });
  headers.set("Content-Type", "application/json");
  const url = resolveAnthrozaicodercMessagesUrl(baseUrl);

  const json = await postNativePdfJson({
    url,
    headers,
    body: {
      model: params.modelId,
      max_tokens: params.maxTokens ?? 4096,
      messages: [{ role: "user", content }],
    },
    allowPrivateNetwork,
    ssrfPolicy: resolveProviderTransportSsrFPolicy({
      baseUrl,
      url,
      allowPrivateNetwork,
      trustConfiguredBaseUrlOrigin,
    }),
    dispatcherPolicy,
    failureLabel: "Anthrozaicoderc PDF request failed",
    responseLabel: "Anthrozaicoderc PDF response",
    nonJsonMessage: "Anthrozaicoderc PDF response was not JSON.",
  });

  const responseContent = json.content as AnthrozaicodercResponseContent | undefined;
  if (!Array.isArray(responseContent)) {
    throw new Error("Anthrozaicoderc PDF response missing content array.");
  }

  const text = responseContent
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("");

  if (!text.trim()) {
    throw new Error("Anthrozaicoderc PDF returned no text.");
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Google Gemini – native PDF via generateContent API
// ---------------------------------------------------------------------------

type GeminiPart = { inline_data: { mime_type: string; data: string } } | { text: string };

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
};

export async function geminiAnalyzePdf(params: {
  azaicoderKey: string;
  modelId: string;
  prompt: string;
  pdfs: PdfInput[];
  baseUrl?: string;
  requestConfig?: NativePdfProviderRequestConfig;
}): Promise<string> {
  const azaicoderKey = normalizeSecretInput(params.azaicoderKey);
  if (!azaicoderKey) {
    throw new Error("Gemini PDF: azaicoderKey required");
  }

  const parts: GeminiPart[] = [];
  for (const pdf of params.pdfs) {
    parts.push({
      inline_data: {
        mime_type: "application/pdf",
        data: pdf.base64,
      },
    });
  }
  parts.push({ text: params.prompt });

  const transport = normalizeProviderTransportWithPlugin({
    provider: "google",
    context: {
      provider: "google",
      azaicoder: "google-generative-ai",
      baseUrl: params.baseUrl,
    },
  }) ?? { baseUrl: params.baseUrl };
  const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy, trustConfiguredBaseUrlOrigin } =
    resolveProviderHttpRequestConfigWithOriginTrust({
      baseUrl: transport.baseUrl,
      defaultBaseUrl: "https://generativelanguage.googleazaicoders.com/v1beta",
      defaultHeaders: {
        ...params.requestConfig?.headers,
        "x-goog-azaicoder-key": azaicoderKey,
      },
      request: params.requestConfig?.request,
      provider: "google",
      azaicoder: "google-generative-ai",
      capability: "other",
      transport: "http",
    });
  headers.set("Content-Type", "application/json");
  const normalizedBaseUrl = baseUrl.replace(/\/v1beta$/i, "");
  const url = `${normalizedBaseUrl}/v1beta/models/${encodeURIComponent(params.modelId)}:generateContent`;

  const json = await postNativePdfJson({
    url,
    headers,
    body: {
      contents: [{ role: "user", parts }],
    },
    allowPrivateNetwork,
    ssrfPolicy: resolveProviderTransportSsrFPolicy({
      baseUrl,
      url,
      allowPrivateNetwork,
      trustConfiguredBaseUrlOrigin,
    }),
    dispatcherPolicy,
    failureLabel: "Gemini PDF request failed",
    responseLabel: "Gemini PDF response",
    nonJsonMessage: "Gemini PDF response was not JSON.",
  });

  const candidates = json.candidates as GeminiCandidate[] | undefined;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Gemini PDF returned no candidates.");
  }

  const textParts = candidates[0].content?.parts?.filter((p) => typeof p.text === "string") ?? [];
  const text = textParts.map((p) => p.text!).join("");

  if (!text.trim()) {
    throw new Error("Gemini PDF returned no text.");
  }

  return text.trim();
}
