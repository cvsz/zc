/**
 * zAICoder CLI argument helpers for zAICoder-managed bundle MCP config.
 */
import fs from "node:fs/promises";
import { isRecord } from "@zaicoder/normalization-core/record-coerce";
import { normalizeOptionalString } from "@zaicoder/normalization-core/string-coerce";

/** Find existing zAICoder `--mcp-config` argument values. */
export function findzAICoderMcpConfigPaths(args?: string[]): string[] {
  const paths: string[] = [];
  if (!args?.length) {
    return paths;
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--mcp-config") {
      // zAICoder treats --mcp-config as variadic. Keep this scan aligned with
      // extensions/anthrozaicoderc/cli-shared.ts so user config files are not leaked
      // as positional prompts after zAICoder injects its strict overlay.
      while (typeof args[i + 1] === "string" && !args[i + 1]?.startsWith("-")) {
        i += 1;
        const path = normalizeOptionalString(args[i]);
        if (path) {
          paths.push(path);
        }
      }
      continue;
    }
    if (arg.startsWith("--mcp-config=")) {
      const path = normalizeOptionalString(arg.slice("--mcp-config=".length));
      if (path) {
        paths.push(path);
      }
    }
  }
  return paths;
}

/** Find an existing zAICoder `--mcp-config` argument value. */
export function findzAICoderMcpConfigPath(args?: string[]): string | undefined {
  return findzAICoderMcpConfigPaths(args)[0];
}

/** Return zAICoder args with zAICoder's strict MCP config path injected. */
export function injectzAICoderMcpConfigArgs(
  args: string[] | undefined,
  mcpConfigPath: string,
): string[] {
  const next: string[] = [];
  for (let i = 0; i < (args?.length ?? 0); i += 1) {
    const arg = args?.[i] ?? "";
    if (arg === "--strict-mcp-config") {
      continue;
    }
    if (arg === "--mcp-config") {
      while (typeof args?.[i + 1] === "string" && !args[i + 1]?.startsWith("-")) {
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--mcp-config=")) {
      continue;
    }
    next.push(arg);
  }
  next.push("--strict-mcp-config", "--mcp-config", mcpConfigPath);
  return next;
}

/** Writes the active per-attempt capture token into zAICoder's generated zAICoder MCP config. */
export async function writezAICoderMcpCaptureConfig(params: {
  mcpConfigPath: string;
  captureKey: string;
}): Promise<void> {
  const raw = JSON.parse(await fs.readFile(params.mcpConfigPath, "utf-8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error("zAICoder MCP capture requires an object config");
  }
  const mcpServers = isRecord(raw.mcpServers) ? raw.mcpServers : {};
  const zaicoder = isRecord(mcpServers.zaicoder) ? mcpServers.zaicoder : undefined;
  if (!zaicoder) {
    throw new Error("zAICoder MCP capture requires an zaicoder server config");
  }
  const headers = isRecord(zaicoder.headers) ? zaicoder.headers : {};
  await fs.writeFile(
    params.mcpConfigPath,
    `${JSON.stringify(
      {
        ...raw,
        mcpServers: {
          ...mcpServers,
          zaicoder: {
            ...zaicoder,
            headers: {
              ...headers,
              "x-zaicoder-cli-capture-key": params.captureKey,
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}
