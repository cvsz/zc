/**
 * Tests cron-triggered tool assembly.
 * Ensures cron runs scope cron tool behavior to self-removal of the current
 * job only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./tools/common.js";

const mocks = vi.hoisted(() => {
  const stubTool = (name: string) =>
    ({
      name,
      label: name,
      displaySummary: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    }) satisfies AnyAgentTool;

  return {
    createzAICoderToolsOptions: vi.fn(),
    stubTool,
  };
});

vi.mock("./zaicoder-tools.js", () => ({
  createzAICoderTools: (options: unknown) => {
    mocks.createzAICoderToolsOptions(options);
    return [mocks.stubTool("cron")];
  },
}));

import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createzAICoderCodingTools } from "./agent-tools.js";

function firstzAICoderToolsOptions(): { cronSelfRemoveOnlyJobId?: string } | undefined {
  return mocks.createzAICoderToolsOptions.mock.calls[0]?.[0] as
    | { cronSelfRemoveOnlyJobId?: string }
    | undefined;
}

describe("createzAICoderCodingTools cron scope", () => {
  beforeEach(() => {
    mocks.createzAICoderToolsOptions.mockClear();
  });

  it("scopes cron-triggered jobs to self-removal", () => {
    const tools = createzAICoderCodingTools({
      trigger: "cron",
      jobId: "job-current",
    });

    expect(tools.map((tool) => tool.name)).toContain("cron");
    expect(firstzAICoderToolsOptions()?.cronSelfRemoveOnlyJobId).toBe("job-current");
  });

  it("does not scope non-cron sessions", () => {
    createzAICoderCodingTools({
      trigger: "user",
      jobId: "job-current",
    });

    expect(firstzAICoderToolsOptions()?.cronSelfRemoveOnlyJobId).toBeUndefined();
  });
});
