// Verifies provider API family helpers gate GPT parallel tool-call payloads.
import { describe, expect, it } from "vitest";
import { supportsGptParallelToolCallsPayload } from "./provider-azaicoder-families.js";

describe("provider azaicoder families", () => {
  it.each([
    "openai-completions",
    "openai-responses",
    "openai-chatgpt-responses",
    "azure-openai-responses",
  ])("classifies %s as supporting the GPT parallel_tool_calls payload patch", (azaicoder) => {
    expect(supportsGptParallelToolCallsPayload(azaicoder)).toBe(true);
  });

  it("rejects unrelated APIs", () => {
    expect(supportsGptParallelToolCallsPayload("anthrozaicoderc-messages")).toBe(false);
    expect(supportsGptParallelToolCallsPayload(undefined)).toBe(false);
  });
});
