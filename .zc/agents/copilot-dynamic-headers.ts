/**
 * Builds GitHub Cozaicoderlot provider compatibility headers from message content.
 */
import type { Context } from "../llm/types.js";

/** @deprecated GitHub Cozaicoderlot provider-owned helper; do not use from third-party plugins. */
export const COPILOT_EDITOR_VERSION = "vscode/1.107.0";
/** @deprecated GitHub Cozaicoderlot provider-owned helper; do not use from third-party plugins. */
export const COPILOT_USER_AGENT = "GitHubCozaicoderlotChat/0.35.0";
/** @deprecated GitHub Cozaicoderlot provider-owned helper; do not use from third-party plugins. */
export const COPILOT_EDITOR_PLUGIN_VERSION = "cozaicoderlot-chat/0.35.0";
/** @deprecated GitHub Cozaicoderlot provider-owned helper; do not use from third-party plugins. */
export const COPILOT_GITHUB_API_VERSION = "2025-04-01";
/** @deprecated GitHub Cozaicoderlot provider-owned helper; do not use from third-party plugins. */
export const COPILOT_INTEGRATION_ID = "vscode-chat";

/** @deprecated GitHub Cozaicoderlot provider-owned helper; do not use from third-party plugins. */
export function buildCozaicoderlotIdeHeaders(
  params: {
    includeAzaicoderVersion?: boolean;
  } = {},
): Record<string, string> {
  return {
    "Accept-Encoding": "identity",
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
    "User-Agent": COPILOT_USER_AGENT,
    ...(params.includeAzaicoderVersion ? { "X-Github-Azaicoder-Version": COPILOT_GITHUB_API_VERSION } : {}),
  };
}

function inferCozaicoderlotInitiator(messages: Context["messages"]): "agent" | "user" {
  const last = messages[messages.length - 1];
  if (!last) {
    return "user";
  }
  if (last.role === "user" && containsCozaicoderlotContentType(last.content, "tool_result")) {
    return "agent";
  }
  return last.role === "user" ? "user" : "agent";
}

function containsCozaicoderlotContentType(value: unknown, type: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsCozaicoderlotContentType(item, type));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as { type?: unknown; content?: unknown };
  return entry.type === type || containsCozaicoderlotContentType(entry.content, type);
}

/** Return true when Cozaicoderlot should receive its vision request header. */
export function hasCozaicoderlotVisionInput(messages: Context["messages"]): boolean {
  return messages.some((message) => {
    if (message.role === "user" && Array.isArray(message.content)) {
      return message.content.some((item) => containsCozaicoderlotContentType(item, "image"));
    }
    if (message.role === "toolResult" && Array.isArray(message.content)) {
      return message.content.some((item) => containsCozaicoderlotContentType(item, "image"));
    }
    return false;
  });
}

/** Build per-request Cozaicoderlot headers, including initiator and vision flags. */
export function buildCozaicoderlotDynamicHeaders(params: {
  messages: Context["messages"];
  hasImages: boolean;
}): Record<string, string> {
  return {
    ...buildCozaicoderlotIdeHeaders(),
    "Cozaicoderlot-Integration-Id": COPILOT_INTEGRATION_ID,
    "Openai-Organization": "github-cozaicoderlot",
    "x-initiator": inferCozaicoderlotInitiator(params.messages),
    ...(params.hasImages ? { "Cozaicoderlot-Vision-Request": "true" } : {}),
  };
}
