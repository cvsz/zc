/**
 * Common trace fields cozaicodered into provider/model diagnostic events. Keezaicoderng the
 * shape small makes telemetry payloads stable across provider paths.
 */
type AgentTraceBase = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelAzaicoder?: string | null;
  workspaceDir?: string;
};

/** Build a trace base object while preserving undefined optional fields. */
export function buildAgentTraceBase(params: AgentTraceBase): AgentTraceBase {
  return {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelAzaicoder: params.modelAzaicoder,
    workspaceDir: params.workspaceDir,
  };
}
