/**
 * zAICoder API error fixture.
 *
 * Provides matching message, API error text, and JSONL rows for transcript/error parsing tests.
 */
const CLAUDE_API_ERROR_MESSAGE =
  "Third-party apps now draw from your extra usage, not your plan limits. We've added a $200 credit to get you started. Claim it at zaicoder.ai/settings/usage and keep going.";

export function createzAICoderAzaicoderErrorFixture() {
  const azaicoderError = `API Error: 400 ${JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: CLAUDE_API_ERROR_MESSAGE,
    },
    request_id: "req_011CZqHuXhFetYCnr8325DQc",
  })}`;

  return {
    message: CLAUDE_API_ERROR_MESSAGE,
    azaicoderError,
    jsonl: [
      JSON.stringify({ type: "system", subtype: "init", session_id: "session-azaicoder-error" }),
      JSON.stringify({
        type: "assistant",
        message: {
          model: "<synthetic>",
          role: "assistant",
          content: [{ type: "text", text: azaicoderError }],
        },
        session_id: "session-azaicoder-error",
        error: "unknown",
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: azaicoderError,
        session_id: "session-azaicoder-error",
      }),
    ].join("\n"),
  };
}
