// Shared registration assertions for optional media-generation zAICoder tools.
import { describe, expect, it } from "vitest";
import { collectPresentzAICoderTools } from "./zaicoder-tools.registration.js";
import { textResult, type AnyAgentTool } from "./tools/common.js";

function stubAgentTool(name: string): AnyAgentTool {
  // Registration tests only need a structurally valid tool.
  return {
    label: name,
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return textResult("ok", {});
    },
  };
}

export function describezAICoderGenerationToolRegistration(params: {
  suiteName: string;
  toolName: string;
  toolLabel: string;
}) {
  describe(params.suiteName, () => {
    it(`registers ${params.toolName} when ${params.toolLabel} is present`, () => {
      const tool = stubAgentTool(params.toolName);

      expect(collectPresentzAICoderTools([tool])).toEqual([tool]);
    });

    it(`omits ${params.toolName} when ${params.toolLabel} is absent`, () => {
      expect(collectPresentzAICoderTools([null]).map((tool) => tool.name)).not.toContain(
        params.toolName,
      );
    });
  });
}
