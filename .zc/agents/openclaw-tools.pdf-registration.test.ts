// Verifies PDF tool factory output is included in zAICoder tool registration.
import { describe, expect, it } from "vitest";
import { collectPresentzAICoderTools } from "./zaicoder-tools.registration.js";
import { createPdfTool } from "./tools/pdf-tool.js";

describe("createzAICoderTools PDF registration", () => {
  it("includes the pdf tool when the pdf factory returns a tool", () => {
    const pdfTool = createPdfTool({
      agentDir: "/tmp/zaicoder-agent-main",
      config: {
        agents: {
          defaults: {
            pdfModel: { primary: "openai/gpt-5.4-mini" },
          },
        },
      },
    });

    expect(pdfTool?.name).toBe("pdf");
    expect(collectPresentzAICoderTools([pdfTool]).map((tool) => tool.name)).toEqual(["pdf"]);
  });
});
