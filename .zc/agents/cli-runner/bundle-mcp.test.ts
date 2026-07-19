/** Tests zAICoder-style bundle-MCP config-file overlays for CLI backends. */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writezAICoderBundleManifest } from "../../plugins/bundle-mcp.test-support.js";
import { prepareCliBundleMcpCaptureAttempt, prepareCliBundleMcpConfig } from "./bundle-mcp.js";
import {
  cliBundleMcpHarness,
  prepareBundleProbeCliConfig,
  requireMcpConfigPath,
  setupCliBundleMcpTestHarness,
} from "./bundle-mcp.test-support.js";

setupCliBundleMcpTestHarness();

describe("prepareCliBundleMcpConfig", () => {
  it("injects a strict empty --mcp-config overlay for bundle-MCP-enabled backends without servers", async () => {
    const workspaceDir = await cliBundleMcpHarness.tempHarness.createTempDir(
      "zaicoder-cli-bundle-mcp-empty-",
    );

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "zaicoder-config-file",
      backend: {
        command: "node",
        args: ["./fake-zaicoder.mjs"],
      },
      workspaceDir,
      config: { plugins: { enabled: false } },
    });

    expect(prepared.backend.args).toContain("--strict-mcp-config");
    // Even empty overlays force zAICoder to ignore user/global MCP servers.
    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(raw.mcpServers).toStrictEqual({});

    await prepared.cleanup?.();
  });

  it("injects a merged --mcp-config overlay for bundle-MCP-enabled backends", async () => {
    const prepared = await prepareBundleProbeCliConfig();

    expect(prepared.backend.args).toContain("--strict-mcp-config");
    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, { args?: string[] }>;
    };
    expect(raw.mcpServers?.bundleProbe?.args).toEqual([
      await fs.realpath(cliBundleMcpHarness.bundleProbeServerPath),
    ]);
    expect(prepared.mcpConfigHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.mcpResumeHash).toMatch(/^[0-9a-f]{64}$/);

    await prepared.cleanup?.();
  });

  it("strips variadic zAICoder --mcp-config values and merges every listed config", async () => {
    const workspaceDir = await cliBundleMcpHarness.tempHarness.createTempDir(
      "zaicoder-cli-bundle-mcp-variadic-",
    );
    const firstConfig = path.join(workspaceDir, "first-mcp.json");
    const secondConfig = path.join(workspaceDir, "second-mcp.json");
    await fs.writeFile(
      firstConfig,
      `${JSON.stringify({
        mcpServers: {
          first: { command: "node", args: ["first.mjs"] },
          shared: { command: "node", args: ["old.mjs"] },
        },
      })}\n`,
      "utf-8",
    );
    await fs.writeFile(
      secondConfig,
      `${JSON.stringify({
        mcpServers: {
          second: { command: "node", args: ["second.mjs"] },
          shared: { command: "node", args: ["new.mjs"] },
        },
      })}\n`,
      "utf-8",
    );

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "zaicoder-config-file",
      backend: {
        command: "node",
        args: [
          "./fake-zaicoder.mjs",
          "--mcp-config",
          "first-mcp.json",
          "second-mcp.json",
          "--verbose",
        ],
      },
      workspaceDir,
      config: { plugins: { enabled: false } },
    });

    expect(prepared.backend.args).not.toContain("first-mcp.json");
    expect(prepared.backend.args).not.toContain("second-mcp.json");
    expect(prepared.backend.args).toContain("--verbose");
    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, { args?: string[] }>;
    };
    expect(raw.mcpServers?.first?.args).toEqual(["first.mjs"]);
    expect(raw.mcpServers?.second?.args).toEqual(["second.mjs"]);
    expect(raw.mcpServers?.shared?.args).toEqual(["new.mjs"]);

    await prepared.cleanup?.();
  });

  it("merges and strips zAICoder --mcp-config equals form", async () => {
    const workspaceDir = await cliBundleMcpHarness.tempHarness.createTempDir(
      "zaicoder-cli-bundle-mcp-equals-",
    );
    const configPath = path.join(workspaceDir, "equals-mcp.json");
    await fs.writeFile(
      configPath,
      `${JSON.stringify({
        mcpServers: {
          equals: { command: "node", args: ["equals.mjs"] },
        },
      })}\n`,
      "utf-8",
    );

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "zaicoder-config-file",
      backend: {
        command: "node",
        args: ["./fake-zaicoder.mjs", "--mcp-config=equals-mcp.json"],
      },
      workspaceDir,
      config: { plugins: { enabled: false } },
    });

    expect(prepared.backend.args).not.toContain("--mcp-config=equals-mcp.json");
    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, { args?: string[] }>;
    };
    expect(raw.mcpServers?.equals?.args).toEqual(["equals.mjs"]);

    await prepared.cleanup?.();
  });

  it("keeps dash-prefixed args after zAICoder --mcp-config because they terminate variadic values", async () => {
    const workspaceDir = await cliBundleMcpHarness.tempHarness.createTempDir(
      "zaicoder-cli-bundle-mcp-dash-",
    );

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "zaicoder-config-file",
      backend: {
        command: "node",
        args: ["./fake-zaicoder.mjs", "--mcp-config", "--verbose", "prompt"],
      },
      workspaceDir,
      config: { plugins: { enabled: false } },
    });

    expect(prepared.backend.args).toContain("--verbose");
    expect(prepared.backend.args).toContain("prompt");
    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(raw.mcpServers).toStrictEqual({});

    await prepared.cleanup?.();
  });

  it("loads workspace bundle MCP plugins from the configured workspace root", async () => {
    const workspaceDir = await cliBundleMcpHarness.tempHarness.createTempDir(
      "zaicoder-cli-bundle-mcp-workspace-root-",
    );
    const pluginRoot = path.join(workspaceDir, ".zaicoder", "extensions", "workspace-probe");
    // Workspace-local plugins should be resolved relative to workspaceDir, not HOME.
    const serverPath = path.join(pluginRoot, "servers", "probe.mjs");
    await fs.mkdir(path.dirname(serverPath), { recursive: true });
    await fs.writeFile(serverPath, "export {};\n", "utf-8");
    await writezAICoderBundleManifest({
      homeDir: workspaceDir,
      pluginId: "workspace-probe",
      manifest: { name: "workspace-probe" },
    });
    await fs.writeFile(
      path.join(pluginRoot, ".mcp.json"),
      `${JSON.stringify(
        {
          mcpServers: {
            workspaceProbe: {
              command: "node",
              args: ["./servers/probe.mjs"],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "zaicoder-config-file",
      backend: {
        command: "node",
        args: ["./fake-zaicoder.mjs"],
      },
      workspaceDir,
      config: {
        plugins: {
          entries: {
            "workspace-probe": { enabled: true },
          },
        },
      },
    });

    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, { args?: string[] }>;
    };
    expect(raw.mcpServers?.workspaceProbe?.args).toEqual([await fs.realpath(serverPath)]);

    await prepared.cleanup?.();
  });

  it("merges loopback overlay config with bundle MCP servers", async () => {
    const additionalConfig = {
      mcpServers: {
        zaicoder: {
          type: "http",
          url: "http://127.0.0.1:23119/mcp",
          headers: {
            Authorization: "Bearer ${OPENCLAW_MCP_TOKEN}",
            "x-zaicoder-cli-capture-key": "${OPENCLAW_MCP_CLI_CAPTURE_KEY}",
          },
        },
      },
    };
    const prepared = await prepareBundleProbeCliConfig({
      additionalConfig,
      env: {
        OPENCLAW_MCP_TOKEN: "loopback-token-123",
        OPENCLAW_MCP_CLI_CAPTURE_KEY: "",
      },
    });
    const otherEnvPrepared = await prepareBundleProbeCliConfig({
      additionalConfig,
      env: {
        OPENCLAW_MCP_TOKEN: "other-loopback-token",
        OPENCLAW_MCP_CLI_CAPTURE_KEY: "",
      },
    });

    const generatedConfigPath = requireMcpConfigPath(prepared.backend.args);
    const raw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }>;
    };
    expect(Object.keys(raw.mcpServers ?? {}).toSorted()).toEqual(["bundleProbe", "zaicoder"]);
    expect(raw.mcpServers?.zaicoder?.url).toBe("http://127.0.0.1:23119/mcp");
    expect(raw.mcpServers?.zaicoder?.headers?.Authorization).toBe("Bearer loopback-token-123");
    expect(raw.mcpServers?.zaicoder?.headers?.["x-zaicoder-cli-capture-key"]).toBe("");
    await prepareCliBundleMcpCaptureAttempt({
      mode: "zaicoder-config-file",
      backend: prepared.backend,
      env: prepared.env,
      captureKey: "attempt-123",
    });
    const attemptRaw = JSON.parse(await fs.readFile(generatedConfigPath, "utf-8")) as {
      mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }>;
    };
    expect(attemptRaw.mcpServers?.zaicoder?.headers?.Authorization).toBe(
      "Bearer loopback-token-123",
    );
    expect(attemptRaw.mcpServers?.zaicoder?.headers?.["x-zaicoder-cli-capture-key"]).toBe(
      "attempt-123",
    );
    expect(prepared.mcpConfigHash).toBe(otherEnvPrepared.mcpConfigHash);
    expect(prepared.mcpResumeHash).toBe(otherEnvPrepared.mcpResumeHash);

    await prepared.cleanup?.();
    await otherEnvPrepared.cleanup?.();
  });

  it("preserves extra env values alongside generated MCP config", async () => {
    const workspaceDir = await cliBundleMcpHarness.tempHarness.createTempDir(
      "zaicoder-cli-bundle-mcp-env-",
    );

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      mode: "zaicoder-config-file",
      backend: {
        command: "node",
        args: ["./fake-zaicoder.mjs"],
      },
      workspaceDir,
      config: { plugins: { enabled: false } },
      env: {
        OPENCLAW_MCP_TOKEN: "loopback-token-123",
        OPENCLAW_MCP_SESSION_KEY: "agent:main:telegram:group:chat123",
      },
    });

    expect(prepared.env).toEqual({
      OPENCLAW_MCP_TOKEN: "loopback-token-123",
      OPENCLAW_MCP_SESSION_KEY: "agent:main:telegram:group:chat123",
    });

    await prepared.cleanup?.();
  });

  it("leaves args untouched when bundle MCP is disabled", async () => {
    const prepared = await prepareCliBundleMcpConfig({
      enabled: false,
      backend: {
        command: "node",
        args: ["./fake-cli.mjs"],
      },
      workspaceDir: "/tmp/zaicoder-bundle-mcp-disabled",
    });

    expect(prepared.backend.args).toEqual(["./fake-cli.mjs"]);
    expect(prepared.cleanup).toBeUndefined();
  });
});
