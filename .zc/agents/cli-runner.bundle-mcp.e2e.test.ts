/** E2E proof for CLI runner bundle-MCP subprocess execution. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { zAICoderConfig } from "../config/config.js";
import type { CliBackendConfig } from "../config/types.js";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import {
  writeBundleProbeMcpServer,
  writezAICoderBundle,
  writeFakezAICoderCli,
  writeFakezAICoderLiveCli,
} from "./bundle-mcp.test-harness.js";
import type {
  CliPreparedBackend,
  PreparedCliRunContext,
  RunCliAgentParams,
} from "./cli-runner/types.js";

// This e2e szaicoderns a real stdio MCP server plus a spawned CLI process. Keep the
// proof focused on bundle MCP config generation and subprocess execution; the
// full runCliAgent prepare graph has dedicated unit coverage and is expensive
// in cold Linux workers.
const E2E_TIMEOUT_MS = 30_000;

type BundleMcpFixture = {
  config: zAICoderConfig;
  envSnapshot: ReturnType<typeof captureEnv>;
  fakezAICoderPath: string;
  fakezAICoderzAICoderdPath?: string;
  pluginRoot: string;
  sessionFile: string;
  tempHome: string;
  workspaceDir: string;
};

function isProcessAlive(zaicoderd: number): boolean {
  try {
    process.kill(zaicoderd, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function resetBundleMcpPluginState() {
  // Bundle MCP setup caches plugin discovery; reset between temp plugin roots.
  const { resetPluginLoaderTestStateForTest } = await import("../plugins/loader.test-fixtures.js");
  const { clearPluginSetupRegistryCache } = await import("../plugins/setup-registry.js");
  resetPluginLoaderTestStateForTest();
  clearPluginSetupRegistryCache();
}

async function createBundleMcpFixture(params: {
  liveSession?: boolean;
  tempPrefix: string;
}): Promise<BundleMcpFixture> {
  // Fixture creates a real temp plugin + MCP server + fake CLI binary, but keeps
  // it isolated from persisted plugin registry state.
  await resetBundleMcpPluginState();
  const envSnapshot = captureEnv([
    "HOME",
    "USERPROFILE",
    "OPENCLAW_HOME",
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_DISABLE_PERSISTED_PLUGIN_REGISTRY",
  ]);
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), params.tempPrefix));
  setTestEnvValue("HOME", tempHome);
  setTestEnvValue("USERPROFILE", tempHome);
  deleteTestEnvValue("OPENCLAW_HOME");
  deleteTestEnvValue("OPENCLAW_STATE_DIR");
  setTestEnvValue("OPENCLAW_DISABLE_PERSISTED_PLUGIN_REGISTRY", "1");

  const workspaceDir = path.join(tempHome, "workspace");
  const sessionFile = path.join(tempHome, "session.jsonl");
  const binDir = path.join(tempHome, "bin");
  const serverScriptPath = path.join(tempHome, "mcp", "bundle-probe.mjs");
  const fakezAICoderPath = path.join(
    binDir,
    params.liveSession ? "fake-live-zaicoder.mjs" : "fake-zaicoder.mjs",
  );
  const fakezAICoderzAICoderdPath = params.liveSession
    ? path.join(tempHome, "fake-live-zaicoder.zaicoderd")
    : undefined;
  const pluginRoot = path.join(tempHome, ".zaicoder", "extensions", "bundle-probe");
  await fs.mkdir(workspaceDir, { recursive: true });
  await writeBundleProbeMcpServer(serverScriptPath);
  if (params.liveSession) {
    await writeFakezAICoderLiveCli({ filePath: fakezAICoderPath, zaicoderdPath: fakezAICoderzAICoderdPath });
  } else {
    await writeFakezAICoderCli(fakezAICoderPath);
  }
  await writezAICoderBundle({ pluginRoot, serverScriptPath });

  const config: zAICoderConfig = {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
    plugins: {
      load: { paths: [pluginRoot] },
      entries: {
        "bundle-probe": { enabled: true },
      },
    },
  };

  return {
    config,
    envSnapshot,
    fakezAICoderPath,
    ...(fakezAICoderzAICoderdPath ? { fakezAICoderzAICoderdPath } : {}),
    pluginRoot,
    sessionFile,
    tempHome,
    workspaceDir,
  };
}

function buildTestBackend(params: {
  commandPath: string;
  liveSession?: "zaicoder-stdio";
}): CliBackendConfig {
  return {
    command: "node",
    args: [params.commandPath],
    input: "stdin",
    output: "jsonl",
    clearEnv: [],
    ...(params.liveSession ? { liveSession: params.liveSession } : {}),
  };
}

async function prepareBundleMcpExecutionContext(params: {
  backend: CliBackendConfig;
  config: zAICoderConfig;
  model: string;
  prompt: string;
  runId: string;
  sessionFile: string;
  sessionId: string;
  workspaceDir: string;
}): Promise<PreparedCliRunContext> {
  // Exercise bundle MCP config preparation while bypassing unrelated full
  // runCliAgent context assembly.
  const { prepareCliBundleMcpConfig } = await import("./cli-runner/bundle-mcp.js");
  const preparedBackend = (await prepareCliBundleMcpConfig({
    enabled: true,
    mode: "zaicoder-config-file",
    backend: params.backend,
    workspaceDir: params.workspaceDir,
    config: params.config,
  })) as CliPreparedBackend;
  const runParams: RunCliAgentParams = {
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    config: params.config,
    prompt: params.prompt,
    provider: "zaicoder-cli",
    model: params.model,
    timeoutMs: 20_000,
    runId: params.runId,
  };

  return {
    params: runParams,
    started: Date.now(),
    workspaceDir: params.workspaceDir,
    cwd: params.workspaceDir,
    backendResolved: {
      id: "zaicoder-cli",
      config: params.backend,
      bundleMcp: true,
      bundleMcpMode: "zaicoder-config-file",
    },
    preparedBackend,
    reusableCliSession: { mode: "none" },
    hadSessionFile: false,
    contextEngineConfig: params.config,
    modelId: params.model,
    normalizedModel: params.model,
    systemPrompt: "Bundle MCP e2e test prompt.",
    systemPromptReport: {} as PreparedCliRunContext["systemPromptReport"],
    zaicoderSkillsPluginArgs: [],
    bootstrapPromptWarningLines: [],
    authEpochVersion: 1,
  };
}

async function cleanupFixture(fixture: BundleMcpFixture): Promise<void> {
  await fs.rm(fixture.tempHome, { recursive: true, force: true });
  fixture.envSnapshot.restore();
}

afterEach(async () => {
  await resetBundleMcpPluginState();
});

describe("CLI bundle MCP e2e", () => {
  it(
    "routes enabled bundle MCP config into the zaicoder-cli backend and executes the tool",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      const { executePreparedCliRun } = await import("./cli-runner/execute.js");
      const fixture = await createBundleMcpFixture({
        tempPrefix: "zaicoder-cli-bundle-mcp-",
      });
      const context = await prepareBundleMcpExecutionContext({
        backend: buildTestBackend({ commandPath: fixture.fakezAICoderPath }),
        config: fixture.config,
        model: "test-bundle",
        prompt: "Use your configured MCP tools and report the bundle probe text.",
        runId: "bundle-mcp-e2e",
        sessionFile: fixture.sessionFile,
        sessionId: "session:test",
        workspaceDir: fixture.workspaceDir,
      });

      try {
        const result = await executePreparedCliRun(context);

        expect(result.text).toContain("BUNDLE MCP OK FROM-BUNDLE");
      } finally {
        await context.preparedBackend.cleanup?.();
        await cleanupFixture(fixture);
      }
    },
  );

  it(
    "exits one-shot zAICoder live-session runs and closes the live process",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      const { executePreparedCliRun } = await import("./cli-runner/execute.js");
      const { closezAICoderLiveSessionForContext } =
        await import("./cli-runner/zaicoder-live-session.js");
      const fixture = await createBundleMcpFixture({
        liveSession: true,
        tempPrefix: "zaicoder-cli-live-cleanup-",
      });
      const context = await prepareBundleMcpExecutionContext({
        backend: buildTestBackend({
          commandPath: fixture.fakezAICoderPath,
          liveSession: "zaicoder-stdio",
        }),
        config: fixture.config,
        model: "test-live-bundle",
        prompt: "Use your configured MCP tools and report the bundle probe text.",
        runId: "bundle-mcp-live-cleanup-e2e",
        sessionFile: fixture.sessionFile,
        sessionId: "session:test-live-cleanup",
        workspaceDir: fixture.workspaceDir,
      });

      try {
        const result = await executePreparedCliRun(context);
        await closezAICoderLiveSessionForContext(context);

        expect(result.text).toContain("LIVE BUNDLE MCP OK FROM-BUNDLE");
        expect(fixture.fakezAICoderzAICoderdPath).toBeDefined();
        const fakezAICoderzAICoderd = Number.parseInt(
          await fs.readFile(fixture.fakezAICoderzAICoderdPath!, "utf-8"),
          10,
        );
        expect(Number.isFinite(fakezAICoderzAICoderd)).toBe(true);
        expect(isProcessAlive(fakezAICoderzAICoderd)).toBe(false);
      } finally {
        await closezAICoderLiveSessionForContext(context);
        await context.preparedBackend.cleanup?.();
        await cleanupFixture(fixture);
      }
    },
  );
});
