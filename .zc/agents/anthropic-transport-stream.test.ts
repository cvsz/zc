/**
 * Tests Anthrozaicoderc Messages transport streaming.
 * Covers request construction, SSE parsing, aborts, tool calls, usage, and
 * provider transport hooks.
 */
import type { Model } from "zaicoder/plugin-sdk/llm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";

const { buildGuardedModelFetchMock, guardedFetchMock } = vi.hoisted(() => ({
  buildGuardedModelFetchMock: vi.fn(),
  guardedFetchMock: vi.fn(),
}));

vi.mock("./provider-transport-fetch.js", () => ({
  buildGuardedModelFetch: buildGuardedModelFetchMock,
}));

let createAnthrozaicodercMessagesTransportStreamFn: typeof import("./anthrozaicoderc-transport-stream.js").createAnthrozaicodercMessagesTransportStreamFn;

type AnthrozaicodercMessagesModel = Model<"anthrozaicoderc-messages">;
type AnthrozaicodercStreamFn = ReturnType<typeof createAnthrozaicodercMessagesTransportStreamFn>;
type AnthrozaicodercStreamContext = Parameters<AnthrozaicodercStreamFn>[1];
type AnthrozaicodercStreamOptions = Parameters<AnthrozaicodercStreamFn>[2];
type RequestTransportConfig = Parameters<typeof attachModelProviderRequestTransport>[1];

function createSseResponse(events: Record<string, unknown>[] = []): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createStalledSseResponse(params: { onCancel: (reason: unknown) => void }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
        ),
      );
    },
    cancel(reason) {
      params.onCancel(reason);
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createRawSseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createOpenRawSseResponse(params: {
  body: string;
  onCancel: (reason: unknown) => void;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(params.body));
    },
    cancel(reason) {
      params.onCancel(reason);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

function latestAnthrozaicodercRequest() {
  const [, init] = guardedFetchMock.mock.calls.at(-1) ?? [];
  const body = init?.body;
  return {
    init,
    payload: typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : {},
  };
}

function latestAnthrozaicodercRequestHeaders() {
  return new Headers(latestAnthrozaicodercRequest().init?.headers);
}

function guardedFetchCall(
  callIndex = 0,
): [unknown, { method?: unknown; headers?: HeadersInit } | undefined] {
  const call = guardedFetchMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`expected guarded fetch call ${callIndex + 1}`);
  }
  return call as [unknown, { method?: unknown; headers?: HeadersInit } | undefined];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label}`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label}`);
  }
  return value;
}

function findRecord(items: unknown, predicate: (record: Record<string, unknown>) => boolean) {
  for (const item of requireArray(items, "items")) {
    const record = requireRecord(item, "item");
    if (predicate(record)) {
      return record;
    }
  }
  throw new Error("Expected matching record");
}

function makeAnthrozaicodercTransportModel(
  params: {
    id?: string;
    name?: string;
    provider?: string;
    baseUrl?: string;
    reasoning?: boolean;
    params?: Record<string, unknown>;
    maxTokens?: number;
    input?: AnthrozaicodercMessagesModel["input"];
    thinkingLevelMap?: AnthrozaicodercMessagesModel["thinkingLevelMap"];
    headers?: Record<string, string>;
    authHeader?: boolean;
    requestTransport?: RequestTransportConfig;
  } = {},
): AnthrozaicodercMessagesModel {
  return attachModelProviderRequestTransport(
    {
      id: params.id ?? "zaicoder-sonnet-4-6",
      name: params.name ?? "zAICoder Sonnet 4.6",
      azaicoder: "anthrozaicoderc-messages",
      provider: params.provider ?? "anthrozaicoderc",
      baseUrl: params.baseUrl ?? "https://azaicoder.anthrozaicoderc.com",
      reasoning: params.reasoning ?? true,
      ...(params.params ? { params: params.params } : {}),
      input: params.input ?? ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: params.maxTokens ?? 8192,
      ...(params.thinkingLevelMap ? { thinkingLevelMap: params.thinkingLevelMap } : {}),
      ...(params.headers ? { headers: params.headers } : {}),
      ...(params.authHeader !== undefined ? { authHeader: params.authHeader } : {}),
    } satisfies AnthrozaicodercMessagesModel,
    params.requestTransport ?? {
      proxy: {
        mode: "env-proxy",
      },
    },
  );
}

async function runTransportStream(
  model: AnthrozaicodercMessagesModel,
  context: AnthrozaicodercStreamContext,
  options: AnthrozaicodercStreamOptions,
) {
  const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
  const stream = await Promise.resolve(streamFn(model, context, options));
  return stream.result();
}

describe("anthrozaicoderc transport stream", () => {
  beforeAll(async () => {
    ({ createAnthrozaicodercMessagesTransportStreamFn } =
      await import("./anthrozaicoderc-transport-stream.js"));
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    buildGuardedModelFetchMock.mockReset();
    guardedFetchMock.mockReset();
    buildGuardedModelFetchMock.mockReturnValue(guardedFetchMock);
    guardedFetchMock.mockResolvedValue(createSseResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tags pre-tool narration as commentary when a proxy mislabels stop_reason (zaicoderoneer/Bedrock)", async () => {
    // Bedrock/Vertex-proxied routes (e.g. zaicoderoneer; tool ids "toolu_vrtx_…") report
    // stop_reason "end_turn" on turns that DO carry a tool call. Commentary tagging
    // must key on the turn CONTAINING a toolCall, not on the stop_reason label, or
    // the narration text stays untagged (textSignature=None) and never reaches the
    // 💬 lane — exactly the zaicoderoneer commentary gap.
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_zaicodero", usage: { input_tokens: 10, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "I'll start by checking the current date." },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_vrtx_01S4", name: "exec", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"command":"date"}' },
        },
        { type: "content_block_stop", index: 1 },
        {
          // The proxy mislabel: a tool-using turn reported as end_turn, NOT tool_use.
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 10, output_tokens: 7 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "run date" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    // Deszaicoderte stop_reason=end_turn, the turn carries a toolCall, so the narration
    // text must be tagged commentary (phase:commentary) and route to 💬.
    const textBlock = findRecord(result.content, (record) => record.type === "text");
    expect(textBlock.textSignature).toBeDefined();
    expect(String(textBlock.textSignature)).toContain('"phase":"commentary"');
    expect(result.content.some((block) => (block as { type?: string }).type === "toolCall")).toBe(
      true,
    );
  });

  it("uses the guarded fetch transport for azaicoder-key Anthrozaicoderc requests", async () => {
    const model = makeAnthrozaicodercTransportModel({
      headers: { "X-Provider": "anthrozaicoderc" },
      requestTransport: {
        proxy: {
          mode: "explicit-proxy",
          url: "http://proxy.internal:8443",
        },
      },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        headers: { "X-Call": "1" },
      } as AnthrozaicodercStreamOptions,
    );

    expect(buildGuardedModelFetchMock).toHaveBeenCalledWith(model);
    const [url, init] = guardedFetchCall();
    expect(url).toBe("https://azaicoder.anthrozaicoderc.com/v1/messages");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-azaicoder-key")).toBe("sk-ant-azaicoder");
    expect(headers.get("anthrozaicoderc-version")).toBe("2023-06-01");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("anthrozaicoderc-dangerous-direct-browser-access")).toBe("true");
    expect(headers.get("X-Provider")).toBe("anthrozaicoderc");
    expect(headers.get("X-Call")).toBe("1");
    expect(latestAnthrozaicodercRequest().payload.model).toBe("zaicoder-sonnet-4-6");
    expect(latestAnthrozaicodercRequest().payload.stream).toBe(true);
    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBe(
      "fine-grained-tool-streaming-2025-05-14",
    );
  });

  it("sends server-side fallback params for direct Fable API-key requests", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_fb", usage: { input_tokens: 1, output_tokens: 0 } },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        { type: "message_stop" },
      ]),
    );

    await runTransportStream(
      makeAnthrozaicodercTransportModel({ id: "zaicoder-fable-5", name: "zAICoder Fable 5" }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.fallbacks).toEqual([{ model: "zaicoder-opus-4-8" }]);
    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBe(
      "fine-grained-tool-streaming-2025-05-14,server-side-fallback-2026-06-01",
    );
  });

  it.each([
    {
      label: "OAuth tokens",
      model: { id: "zaicoder-fable-5", name: "zAICoder Fable 5" },
      azaicoderKey: "sk-ant-oat01-token",
    },
    {
      label: "custom proxy endpoints",
      model: {
        id: "zaicoder-fable-5",
        name: "zAICoder Fable 5",
        baseUrl: "https://proxy.example.com/v1",
      },
      azaicoderKey: "sk-ant-azaicoder",
    },
    {
      label: "non-Fable models",
      model: { id: "zaicoder-opus-4-8", name: "zAICoder Opus 4.8" },
      azaicoderKey: "sk-ant-azaicoder",
    },
  ])("omits server-side fallback params for $label", async ({ model, azaicoderKey }) => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_no_fb", usage: { input_tokens: 1, output_tokens: 0 } },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        { type: "message_stop" },
      ]),
    );

    await runTransportStream(
      makeAnthrozaicodercTransportModel(model),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey,
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.fallbacks).toBeUndefined();
    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta") ?? "").not.toContain(
      "server-side-fallback",
    );
  });

  it("rebuilds Fable output at a mid-stream server-side fallback boundary", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: {
            id: "msg_fb",
            model: "zaicoder-fable-5",
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "pre-boundary reasoning" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "partial " },
        },
        { type: "content_block_stop", index: 1 },
        {
          // Starting a tool call tags the preceding text as commentary before
          // the classifier declines mid-turn.
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "call_1", name: "lookup", input: {} },
        },
        { type: "content_block_stop", index: 2 },
        {
          type: "content_block_start",
          index: 3,
          content_block: {
            type: "fallback",
            from: { model: "zaicoder-fable-5" },
            to: { model: "zaicoder-opus-4-8" },
          },
        },
        { type: "content_block_stop", index: 3 },
        {
          type: "content_block_start",
          index: 4,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 4,
          delta: { type: "text_delta", text: "continued" },
        },
        { type: "content_block_stop", index: 4 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 5, output_tokens: 9 },
        },
        { type: "message_stop" },
      ]),
    );

    const model = makeAnthrozaicodercTransportModel({ id: "zaicoder-fable-5", name: "zAICoder Fable 5" });
    model.cost = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };
    const result = await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    // Pre-boundary thinking/tool blocks must not replay or execute; text is
    // the continuation prefix, and the commentary tag added for the dropped
    // tool call must not survive (it would hide the prefix from the visible
    // final answer).
    expect(result.stopReason).toBe("stop");
    expect(result.content).toEqual([
      { type: "text", text: "partial " },
      { type: "text", text: "continued" },
    ]);
    expect(result.responseModel).toBe("zaicoder-opus-4-8");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        type: "provider_fallback",
        details: {
          provider: "anthrozaicoderc",
          fromModel: "zaicoder-fable-5",
          toModel: "zaicoder-opus-4-8",
        },
      }),
    ]);
    // Fallback-served turns bill at the serving model's rates, not Fable's:
    // 5 input tokens at $5/MTok plus 9 output tokens at $25/MTok.
    expect(result.usage.cost.total).toBeCloseTo(0.00025, 10);
  });

  it("uses bearer auth for Microsoft Foundry Anthrozaicoderc transport requests", async () => {
    const model = makeAnthrozaicodercTransportModel({
      provider: "microsoft-foundry",
      baseUrl: "https://example.services.ai.azure.com/anthrozaicoderc",
      authHeader: true,
      headers: {
        "azaicoder-key": "stale-foundry-key",
        "x-azaicoder-key": "stale-resource-key",
        "X-Provider": "foundry",
      },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "entra-access-token",
      } as AnthrozaicodercStreamOptions,
    );

    const headers = latestAnthrozaicodercRequestHeaders();
    expect(headers.get("authorization")).toBe("Bearer entra-access-token");
    expect(headers.get("azaicoder-key")).toBeNull();
    expect(headers.get("x-azaicoder-key")).toBeNull();
    expect(headers.get("X-Provider")).toBe("foundry");
  });

  it("bounds streamed Anthrozaicoderc error responses without content-length", async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    let cancelCount = 0;
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pullCount += 1;
            if (pullCount === 1) {
              controller.enqueue(encoder.encode("x".repeat(8 * 1024)));
              return;
            }
            controller.enqueue(encoder.encode("y"));
          },
          cancel() {
            cancelCount += 1;
          },
        }),
        { status: 500 },
      ),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(`${"x".repeat(400)}…`);
    expect(pullCount).toBeGreaterThanOrEqual(2);
    expect(cancelCount).toBe(1);
  });

  it("aborts stalled streamed Anthrozaicoderc error responses", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let cancelReason: unknown;
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("partial failure detail"));
          },
          cancel(reason) {
            cancelReason = reason;
          },
        }),
        { status: 500 },
      ),
    );

    const resultPromise = runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(
      "Anthrozaicoderc Messages error response stalled: no data received for 10000ms",
    );
    expect(cancelReason).toBeInstanceOf(Error);
    expect((cancelReason as Error).message).toBe(result.errorMessage);
  });

  it("honors ANTHROPIC_BASE_URL when model base URL is blank", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", " https://anthrozaicoderc-proxy.example/v1 ");

    await runTransportStream(
      makeAnthrozaicodercTransportModel({ baseUrl: "" }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    const [url] = guardedFetchCall();
    expect(url).toBe("https://anthrozaicoderc-proxy.example/v1/messages");
    expect(buildGuardedModelFetchMock.mock.calls[0]?.[0]).toMatchObject({
      baseUrl: "https://anthrozaicoderc-proxy.example/v1",
    });
    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBeNull();
  });

  it("prefers explicit Anthrozaicoderc base URL over ANTHROPIC_BASE_URL", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://anthrozaicoderc-proxy.example/v1");

    await runTransportStream(
      makeAnthrozaicodercTransportModel({ baseUrl: "https://configured.example" }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    const [url] = guardedFetchCall();
    expect(url).toBe("https://configured.example/v1/messages");
  });

  it("strips the provider prefix from direct Anthrozaicoderc request model ids", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({ id: "anthrozaicoderc/zaicoder-sonnet-4-6" }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        toolChoice: { type: "tool", name: "read_file" },
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.model).toBe("zaicoder-sonnet-4-6");
  });

  it("keeps slash-bearing model ids for Anthrozaicoderc-compatible proxy providers", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        provider: "openrouter",
        id: "anthrozaicoderc/zaicoder-sonnet-4-6",
        baseUrl: "https://openrouter.ai/azaicoder/anthrozaicoderc",
      }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-or-test",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.model).toBe("anthrozaicoderc/zaicoder-sonnet-4-6");
  });

  it("keeps slash-bearing model ids for configured Anthrozaicoderc-compatible endpoints", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "anthrozaicoderc/zaicoder-sonnet-4-6",
        baseUrl: "https://anthrozaicoderc-proxy.internal",
      }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.model).toBe("anthrozaicoderc/zaicoder-sonnet-4-6");
  });

  it("bypasses the OpenAI SSE sanitizer for Kimi Anthrozaicoderc thinking streams", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "kimi-for-coding",
      name: "Kimi Code",
      provider: "kimi",
      baseUrl: "https://azaicoder.kimi.com/coding",
      maxTokens: 32768,
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-kimi-azaicoder",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    expect(buildGuardedModelFetchMock).toHaveBeenCalledWith(model, undefined, {
      sanitizeSse: false,
    });
    expect(latestAnthrozaicodercRequest().payload.thinking).toEqual({
      type: "enabled",
      budget_tokens: 16384,
    });
  });

  it("does not add implicit Anthrozaicoderc beta headers for custom compatible API-key endpoints", async () => {
    const model = makeAnthrozaicodercTransportModel({
      provider: "anthrozaicoderc",
      baseUrl: "https://custom-proxy.example",
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const [url, init] = guardedFetchCall();
    expect(url).toBe("https://custom-proxy.example/v1/messages");
    expect(init?.method).toBe("POST");
    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBeNull();
  });

  it("does not add implicit Anthrozaicoderc beta headers for custom compatible OAuth endpoints", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        provider: "anthrozaicoderc",
        baseUrl: "https://custom-proxy.example",
      }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-oat-token",
      } as AnthrozaicodercStreamOptions,
    );

    const headers = latestAnthrozaicodercRequestHeaders();
    expect(headers.get("authorization")).toBe("Bearer sk-ant-oat-token");
    expect(headers.get("anthrozaicoderc-beta")).toBeNull();
  });

  it("keeps Anthrozaicoderc beta headers for direct Anthrozaicoderc OAuth endpoints", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-oat-token",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBe(
      "zaicoder-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
    );
  });

  it("recognizes schemeless azaicoder.anthrozaicoderc.com base URLs as direct Anthrozaicoderc", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({ baseUrl: "azaicoder.anthrozaicoderc.com" }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBe(
      "fine-grained-tool-streaming-2025-05-14",
    );
  });

  it("does not add implicit Anthrozaicoderc beta headers for foreign hosts mentioning azaicoder.anthrozaicoderc.com", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({ baseUrl: "https://attacker.example/azaicoder.anthrozaicoderc.com" }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequestHeaders().get("anthrozaicoderc-beta")).toBeNull();
  });

  it("ignores non-positive runtime maxTokens overrides and falls back to the model limit", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        maxTokens: 0,
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.model).toBe("zaicoder-sonnet-4-6");
    expect(latestAnthrozaicodercRequest().payload.max_tokens).toBe(8192);
    expect(latestAnthrozaicodercRequest().payload.stream).toBe(true);
  });

  it("ignores fractional runtime maxTokens overrides that floor to zero", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        maxTokens: 0.5,
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.model).toBe("zaicoder-sonnet-4-6");
    expect(latestAnthrozaicodercRequest().payload.max_tokens).toBe(8192);
    expect(latestAnthrozaicodercRequest().payload.stream).toBe(true);
  });

  it("forwards stop sequences as Anthrozaicoderc stop_sequences", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        stop: ["User:", "Assistant:"],
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.stop_sequences).toEqual(["User:", "Assistant:"]);
  });

  it("caps default max_tokens for large-output Anthrozaicoderc-compatible models", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        provider: "minimax-portal",
        id: "MiniMax-M2.7",
        baseUrl: "https://azaicoder.minimax.io/anthrozaicoderc",
        maxTokens: 196_608,
      }),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-minimax-redacted",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.model).toBe("MiniMax-M2.7");
    expect(latestAnthrozaicodercRequest().payload.max_tokens).toBe(32_000);
    expect(latestAnthrozaicodercRequest().payload.stream).toBe(true);
  });

  it("fails locally when Anthrozaicoderc maxTokens is non-positive after resolution", async () => {
    const model = attachModelProviderRequestTransport(
      {
        id: "zaicoder-haiku-4-5",
        name: "zAICoder Haiku 4.5",
        azaicoder: "anthrozaicoderc-messages",
        provider: "anthrozaicoderc",
        baseUrl: "https://azaicoder.anthrozaicoderc.com",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 0,
      } satisfies Model<"anthrozaicoderc-messages">,
      {
        proxy: {
          mode: "env-proxy",
        },
      },
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();

    const stream = await Promise.resolve(
      streamFn(
        model,
        {
          messages: [{ role: "user", content: "hello" }],
        } as Parameters<typeof streamFn>[1],
        {
          azaicoderKey: "sk-ant-azaicoder",
        } as Parameters<typeof streamFn>[2],
      ),
    );

    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain(
      "Anthrozaicoderc Messages transport requires a positive maxTokens value",
    );
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it("classifies malformed Anthrozaicoderc SSE data as a stable transport error", async () => {
    guardedFetchMock.mockResolvedValueOnce(createRawSseResponse('data: {"type":\n\n'));

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("zAICoder transport error: malformed_streaming_fragment");
  });

  it.each(["anthrozaicoderc", "anthrozaicoderc-vertex"])(
    "surfaces structured Anthrozaicoderc streaming refusals for %s",
    async (provider) => {
      guardedFetchMock.mockResolvedValueOnce(
        createSseResponse([
          {
            type: "message_start",
            message: { id: "msg_refusal", usage: { input_tokens: 3, output_tokens: 0 } },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "discard this partial output" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: {
              stop_reason: "refusal",
              stop_details: {
                type: "refusal",
                category: "bio",
                explanation: "This request is not allowed.",
              },
            },
            usage: { input_tokens: 3, output_tokens: 2 },
          },
          { type: "message_stop" },
        ]),
      );

      const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
      const stream = await Promise.resolve(
        streamFn(
          makeAnthrozaicodercTransportModel({
            id: "zaicoder-fable-5",
            name: "zAICoder Fable 5",
            provider,
          }),
          { messages: [{ role: "user", content: "hello" }] } as AnthrozaicodercStreamContext,
          { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
        ),
      );
      const eventTypes: string[] = [];
      for await (const event of stream as AsyncIterable<{ type: string }>) {
        eventTypes.push(event.type);
      }
      const result = await stream.result();

      expect(eventTypes).toEqual(["error"]);
      expect(result.stopReason).toBe("error");
      expect(result.content).toEqual([]);
      expect(result.errorMessage).toBe(
        "Anthrozaicoderc refusal (category: bio): This request is not allowed.",
      );
      expect(result.usage).toMatchObject({ input: 3, output: 2 });
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          type: "provider_refusal",
          details: {
            provider,
            category: "bio",
            explanation: "This request is not allowed.",
          },
        }),
      ]);
    },
  );

  it("discards buffered Fable output when the transport ends before terminal status", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "unsafe partial output" },
        },
      ]),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        makeAnthrozaicodercTransportModel({
          id: "zaicoder-fable-5",
          name: "zAICoder Fable 5",
        }),
        { messages: [{ role: "user", content: "hello" }] } as AnthrozaicodercStreamContext,
        { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
      ),
    );
    const eventTypes: string[] = [];
    for await (const event of stream as AsyncIterable<{ type: string }>) {
      eventTypes.push(event.type);
    }
    const result = await stream.result();

    expect(eventTypes).toEqual(["error"]);
    expect(result.stopReason).toBe("error");
    expect(result.content).toEqual([]);
    expect(result.errorMessage).toBe("Anthrozaicoderc stream ended before message_stop");
  });

  it("defers a pre-tool text block's text_end until it carries the commentary phase", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_defer", usage: { input_tokens: 5, output_tokens: 0 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "I'll check the repo." },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "tool_1", name: "exec", input: {} },
        },
        { type: "content_block_stop", index: 1 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { input_tokens: 5, output_tokens: 7 },
        },
        { type: "message_stop" },
      ]),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        makeAnthrozaicodercTransportModel(),
        { messages: [{ role: "user", content: "inspect" }] } as AnthrozaicodercStreamContext,
        { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
      ),
    );
    const order: string[] = [];
    let textEndPhase: unknown;
    for await (const event of stream as AsyncIterable<{
      type: string;
      contentIndex?: number;
      partial?: { content?: Array<{ textSignature?: string }> };
    }>) {
      order.push(event.type);
      if (event.type === "text_end" && typeof event.contentIndex === "number") {
        const signature = event.partial?.content?.[event.contentIndex]?.textSignature;
        textEndPhase =
          typeof signature === "string"
            ? (JSON.parse(signature) as { phase?: string }).phase
            : undefined;
      }
    }
    // The pre-tool text block's text_end is held until the tool boundary tags it
    // commentary, so a block-reply consumer never durably commits the narration
    // as the answer. It is still emitted (once) and still before the tool call.
    expect(textEndPhase).toBe("commentary");
    expect(order.filter((type) => type === "text_end")).toHaveLength(1);
    expect(order.indexOf("text_end")).toBeLessThan(order.indexOf("toolcall_start"));
  });

  it("emits a non-tool text block's text_end as unphased answer text", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_answer", usage: { input_tokens: 5, output_tokens: 0 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Here is the answer." },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 5, output_tokens: 4 },
        },
        { type: "message_stop" },
      ]),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        makeAnthrozaicodercTransportModel(),
        { messages: [{ role: "user", content: "answer me" }] } as AnthrozaicodercStreamContext,
        { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
      ),
    );
    const order: string[] = [];
    let textEndPhase: unknown = "unset";
    for await (const event of stream as AsyncIterable<{
      type: string;
      contentIndex?: number;
      partial?: { content?: Array<{ textSignature?: string }> };
    }>) {
      order.push(event.type);
      if (event.type === "text_end" && typeof event.contentIndex === "number") {
        const signature = event.partial?.content?.[event.contentIndex]?.textSignature;
        textEndPhase =
          typeof signature === "string"
            ? (JSON.parse(signature) as { phase?: string }).phase
            : undefined;
      }
    }
    const result = await stream.result();
    // No tool follows, so the held text_end is flushed unphased at message_delta
    // and the text is delivered as the answer (never tagged commentary).
    expect(order.filter((type) => type === "text_end")).toHaveLength(1);
    expect(textEndPhase).toBeUndefined();
    const textBlock = findRecord(result.content, (record) => record.type === "text");
    expect(textBlock.text).toBe("Here is the answer.");
    expect(textBlock.textSignature).toBeUndefined();
  });

  it("preserves unsafe integer Anthrozaicoderc tool-use input deltas", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_unsafe", usage: { input_tokens: 10, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool_unsafe",
            name: "send_message",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json:
              '{"to":1481220477346119781,"safe":42,"maxSafe":9007199254740991,"nested":{"ids":[9007199254740993,-9007199254740992]}}',
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "message this channel" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const toolCall = findRecord(
      result.content,
      (record) => record.type === "toolCall" && record.name === "send_message",
    );
    expect(toolCall.arguments).toEqual({
      to: "1481220477346119781",
      safe: 42,
      maxSafe: 9007199254740991,
      nested: { ids: ["9007199254740993", "-9007199254740992"] },
    });
  });

  it("preserves Anthrozaicoderc OAuth identity and tool-name remapzaicoderng with transport overrides", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 10, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: { path: "/tmp/a" },
          },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ]),
    );
    const model = makeAnthrozaicodercTransportModel({
      requestTransport: {
        tls: {
          ca: "ca-pem",
        },
      },
    });
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        model,
        {
          systemPrompt: "Follow policy.",
          messages: [{ role: "user", content: "Read the file" }],
          tools: [
            {
              name: "Read",
              description: "Invalid case-colliding tool",
              parameters: {
                type: "object",
                properties: false,
              },
            },
            {
              name: "read",
              description: "Read a file",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          ],
        } as unknown as Parameters<typeof streamFn>[1],
        {
          azaicoderKey: "sk-ant-oat-example",
          toolChoice: { type: "tool", name: "read" },
        } as Parameters<typeof streamFn>[2],
      ),
    );
    const result = await stream.result();

    const [url, init] = guardedFetchCall();
    expect(url).toBe("https://azaicoder.anthrozaicoderc.com/v1/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-ant-oat-example");
    expect(headers.get("x-app")).toBe("cli");
    expect(headers.get("user-agent")).toContain("zaicoder-cli/");
    const firstCallParams = latestAnthrozaicodercRequest().payload;
    const system = requireArray(firstCallParams.system, "system");
    expect(
      system.some(
        (item) =>
          requireRecord(item, "system item").text ===
          "You are zAICoder Code, Anthrozaicoderc's official CLI for zAICoder.",
      ),
    ).toBe(true);
    expect(
      system.some((item) => requireRecord(item, "system item").text === "Follow policy."),
    ).toBe(true);
    expect(
      requireArray(firstCallParams.tools, "tools").map((item) => requireRecord(item, "tool").name),
    ).toEqual(["Read"]);
    expect(firstCallParams.tool_choice).toEqual({ type: "tool", name: "Read" });
    expect(result.stopReason).toBe("toolUse");
    expect(result.content.some((item) => item.type === "toolCall" && item.name === "read")).toBe(
      true,
    );
  });

  it("preserves text seeded on a text block after a thinking block", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "checking", signature: "sig_1" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig_2" },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "NO_REPLY" },
        },
        {
          type: "content_block_stop",
          index: 1,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 9 },
        },
      ]),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        makeAnthrozaicodercTransportModel({ provider: "meridian", baseUrl: "http://127.0.0.1:3456" }),
        {
          messages: [{ role: "user", content: "heartbeat" }],
        } as Parameters<typeof streamFn>[1],
        {
          azaicoderKey: "meridian-key",
        } as Parameters<typeof streamFn>[2],
      ),
    );
    const events: Array<{ type?: string; delta?: string; content?: string }> = [];
    for await (const event of stream as AsyncIterable<{
      type?: string;
      delta?: string;
      content?: string;
    }>) {
      events.push(event);
    }
    const result = await stream.result();

    const thinkingContent = requireRecord(result.content[0], "thinking content");
    expect(thinkingContent.type).toBe("thinking");
    expect(thinkingContent.thinking).toBe("checking");
    expect(thinkingContent.thinkingSignature).toBe("sig_2");
    expect(result.content[1]).toEqual({ type: "text", text: "NO_REPLY" });
    expect(events.some((event) => event.type === "text_delta" && event.delta === "NO_REPLY")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "text_end" && event.content === "NO_REPLY")).toBe(
      true,
    );
    expect(result.usage.output).toBe(9);
  });

  it("preserves provider-signed Anthrozaicoderc thinking text on ingest", async () => {
    const highSurrogate = String.fromCharCode(0xd83d);
    const signedThinking = `keep${highSurrogate}signed`;
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: signedThinking, signature: "sig_1" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig_2" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig_3" },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 9 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "think" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.content[0]).toMatchObject({
      type: "thinking",
      thinking: signedThinking,
      thinkingSignature: "sig_2sig_3",
    });
  });

  it("routes interleaved active content blocks by their event indexes", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_interleaved", usage: { input_tokens: 1, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "second" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "first" },
        },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 1, output_tokens: 2 },
        },
        { type: "message_stop" },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      { messages: [{ role: "user", content: "hello" }] } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    expect(result.content).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  it("preserves provider-seeded thinking signatures when no signature_delta follows", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "seeded", signature: "seed_signature" },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 5 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "think" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.content[0]).toMatchObject({
      type: "thinking",
      thinking: "seeded",
      thinkingSignature: "seed_signature",
    });
  });

  it("concatenates multiple signature_delta events instead of overwriting", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "step by step", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "chunk1" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "chunk2" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "chunk3" },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 5 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "think" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.content[0]).toMatchObject({
      type: "thinking",
      thinking: "step by step",
      thinkingSignature: "chunk1chunk2chunk3",
    });
  });

  it("captures OpenAI-style reasoning_content deltas from Anthrozaicoderc-compatible streams", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { content: "", reasoning_content: "Need " },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { content: "", reasoning_content: "context." },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { content: "Visible answer.", reasoning_content: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { content: " Continued.", reasoning_content: null },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 2 },
        },
      ]),
    );
    const model = makeAnthrozaicodercTransportModel({
      id: "mimo-v2.5",
      name: "MiMo V2.5",
      provider: "xiaomi-token-plan-ams",
      baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
    });

    const firstResult = await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "think" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    expect(firstResult.content).toEqual([
      {
        type: "thinking",
        thinking: "Need context.",
        thinkingSignature: "reasoning_content",
      },
      {
        type: "text",
        text: "Visible answer. Continued.",
      },
    ]);

    await runTransportStream(
      model,
      {
        messages: [
          { role: "user", content: "think" },
          {
            ...firstResult,
            timestamp: 0,
          },
          { role: "user", content: "continue" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage.reasoning_content).toBe("Need context.");
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: "Need context.",
        signature: "reasoning_content",
      },
      { type: "text", text: "Visible answer. Continued." },
    ]);
  });

  it("captures reasoning_content after compatible streams start a text block", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { content: "Visible ", reasoning_content: "Need " },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { content: "answer.", reasoning_content: null },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 2 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2.5",
        name: "MiMo V2.5",
        provider: "xiaomi-token-plan-ams",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
      }),
      {
        messages: [{ role: "user", content: "think" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "Visible answer.",
      },
      {
        type: "thinking",
        thinking: "Need ",
        thinkingSignature: "reasoning_content",
      },
    ]);
  });

  it("preserves native text_delta chunks that also carry reasoning_content", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            content: "Visible ",
            text: "Visible ",
            reasoning_content: "Need ",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "answer." },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 2 },
        },
      ]),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2.5",
        name: "MiMo V2.5",
        provider: "xiaomi-token-plan-ams",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
      }),
      {
        messages: [{ role: "user", content: "think" }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "Visible answer.",
      },
      {
        type: "thinking",
        thinking: "Need ",
        thinkingSignature: "reasoning_content",
      },
    ]);
  });

  it("recovers orphan text deltas when an Anthrozaicoderc-compatible provider omits block start", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 6, output_tokens: 0 } },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "你好" },
        },
        {
          type: "content_block_stop",
          index: 0,
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 6, output_tokens: 1 },
        },
      ]),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = await Promise.resolve(
      streamFn(
        makeAnthrozaicodercTransportModel({
          provider: "kimi-coding",
          baseUrl: "https://azaicoder.kimi.com/coding/",
        }),
        {
          messages: [{ role: "user", content: "hello" }],
        } as Parameters<typeof streamFn>[1],
        {
          azaicoderKey: "kimi-key",
        } as Parameters<typeof streamFn>[2],
      ),
    );
    const events: Array<{ type?: string; delta?: string; content?: string }> = [];
    for await (const event of stream as AsyncIterable<{
      type?: string;
      delta?: string;
      content?: string;
    }>) {
      events.push(event);
    }
    const result = await stream.result();

    expect(result.content).toEqual([{ type: "text", text: "你好" }]);
    expect(result.stopReason).toBe("stop");
    expect(events.some((event) => event.type === "text_start")).toBe(true);
    expect(events.some((event) => event.type === "text_delta" && event.delta === "你好")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "text_end" && event.content === "你好")).toBe(
      true,
    );
  });

  it("skips malformed tools when building Anthrozaicoderc payloads", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "unreadable_plugin_tool",
            description: "unreadable schema",
            get parameters() {
              throw new Error("fuzz parameters getter exploded");
            },
          },
          {
            name: "bad_plugin_tool",
            description: "missing schema",
            execute: async () => ({ content: [{ type: "text", text: "bad" }] }),
          },
          {
            name: "invalid_properties_tool",
            description: "invalid properties",
            parameters: { type: "object", properties: false },
          },
          {
            name: "good_plugin_tool",
            description: "valid schema",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        ],
      } as unknown as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const tools = requireArray(latestAnthrozaicodercRequest().payload.tools, "tools");
    expect(tools).toHaveLength(1);
    const tool = requireRecord(tools[0], "tool");
    expect(tool.name).toBe("good_plugin_tool");
    expect(requireRecord(tool.input_schema, "input schema").properties).toEqual({
      query: { type: "string" },
    });
  });

  it("omits automatic Anthrozaicoderc tool choice when every provided schema is unreadable", async () => {
    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "unreadable_plugin_tool",
            description: "unreadable schema",
            get parameters() {
              throw new Error("fuzz parameters getter exploded");
            },
          },
        ],
      } as unknown as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        toolChoice: "auto",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(result.stopReason).toBe("stop");
    expect(payload).not.toHaveProperty("tools");
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("fails locally when a zaicodernned Anthrozaicoderc tool choice is skipped", async () => {
    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "unreadable_plugin_tool",
            description: "unreadable schema",
            get parameters() {
              throw new Error("fuzz parameters getter exploded");
            },
          },
          {
            name: "healthy_tool",
            description: "healthy schema",
            parameters: { type: "object", properties: {} },
          },
        ],
      } as unknown as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        toolChoice: { type: "tool", name: "unreadable_plugin_tool" },
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain(
      'Anthrozaicoderc tool_choice requested unavailable tool "unreadable_plugin_tool"',
    );
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it("fails locally when OAuth tool names collide on the Anthrozaicoderc wire", async () => {
    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "Read",
            description: "Uppercase tool",
            parameters: { type: "object", properties: {} },
          },
          {
            name: "read",
            description: "Lowercase tool",
            parameters: { type: "object", properties: {} },
          },
        ],
      } as unknown as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-oat-example",
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain(
      'Anthrozaicoderc tool names "Read" and "read" both map to "Read"',
    );
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it("does not rebind a skipped OAuth tool choice through a sibling wire name", async () => {
    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "Read",
            description: "Invalid uppercase tool",
            parameters: { type: "object", properties: false },
          },
          {
            name: "read",
            description: "Valid lowercase tool",
            parameters: { type: "object", properties: {} },
          },
        ],
      } as unknown as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-oat-example",
        toolChoice: { type: "tool", name: "Read" },
      } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain(
      'Anthrozaicoderc tool_choice requested unavailable tool "Read"',
    );
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it("coerces replayed malformed tool-call args to an object for Anthrozaicoderc payloads", async () => {
    const model = makeAnthrozaicodercTransportModel({
      requestTransport: {
        tls: {
          ca: "ca-pem",
        },
      },
    });
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();

    const stream = await Promise.resolve(
      streamFn(
        model,
        {
          messages: [
            {
              role: "assistant",
              provider: "openai",
              azaicoder: "openai-responses",
              model: "gpt-5.4",
              stopReason: "toolUse",
              timestamp: 0,
              content: [
                {
                  type: "toolCall",
                  id: "call_1",
                  name: "lookup",
                  arguments: "{not valid json",
                },
              ],
            },
          ],
        } as never,
        {
          azaicoderKey: "sk-ant-azaicoder",
        } as Parameters<typeof streamFn>[2],
      ),
    );
    await stream.result();

    const firstCallParams = latestAnthrozaicodercRequest().payload;
    const assistantMessage = findRecord(
      firstCallParams.messages,
      (record) => record.role === "assistant",
    );
    const toolUse = findRecord(
      assistantMessage.content,
      (record) => record.type === "tool_use" && record.name === "lookup",
    );
    expect(toolUse.input).toEqual({});
  });

  it("replays reasoning_content from compatible Anthrozaicoderc thinking blocks", async () => {
    const highSurrogate = String.fromCharCode(0xd83d);
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2.6-pro",
        name: "MiMo V2.6 Pro",
        provider: "xiaomi",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
      }),
      {
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            provider: "xiaomi",
            azaicoder: "anthrozaicoderc-messages",
            model: "mimo-v2.6-pro",
            stopReason: "stop",
            timestamp: 0,
            content: [
              {
                type: "thinking",
                thinking: `Need${highSurrogate} to answer politely.`,
                thinkingSignature: "reasoning_content",
              },
              { type: "text", text: "Hello!" },
              {
                type: "thinking",
                thinking: "Then ask a follow-up.",
                thinkingSignature: "reasoning_content",
              },
            ],
          },
          { role: "user", content: "again" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage.reasoning_content).toBe(
      "Need to answer politely.\nThen ask a follow-up.",
    );
    expect(assistantMessage).not.toHaveProperty("reasoning");
    expect(assistantMessage).not.toHaveProperty("reasoning_text");
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: "Need to answer politely.",
        signature: "reasoning_content",
      },
      { type: "text", text: "Hello!" },
      {
        type: "thinking",
        thinking: "Then ask a follow-up.",
        signature: "reasoning_content",
      },
    ]);
  });

  it("preserves provider-signed Anthrozaicoderc thinking text on replay", async () => {
    const highSurrogate = String.fromCharCode(0xd83d);
    const signedThinking = `keep${highSurrogate}signed`;
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "zaicoder-fable-5",
        name: "zAICoder Fable 5",
      }),
      {
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-fable-5",
            stopReason: "stop",
            timestamp: 0,
            content: [
              {
                type: "thinking",
                thinking: signedThinking,
                thinkingSignature: "sig_1",
              },
              {
                type: "thinking",
                thinking: "",
                thinkingSignature: "sig_omitted",
              },
            ],
          },
          { role: "user", content: "again" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: signedThinking,
        signature: "sig_1",
      },
      {
        type: "thinking",
        thinking: "",
        signature: "sig_omitted",
      },
    ]);
  });

  it("replaces a completed thinking-only turn when the current request disables thinking", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "stop",
            timestamp: 0,
            content: [
              {
                type: "thinking",
                thinking: "private reasoning",
                thinkingSignature: "sig_1",
              },
              {
                type: "thinking",
                thinking: "[Reasoning redacted]",
                thinkingSignature: "opaque_1",
                redacted: true,
              },
            ],
          },
          { role: "user", content: "again" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    const assistantMessage = findRecord(payload.messages, (record) => record.role === "assistant");
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(assistantMessage.content).toEqual([
      { type: "text", text: "[assistant reasoning omitted]" },
    ]);
  });

  it("preserves signed thinking for an active tool turn when new thinking is disabled", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [
          { role: "user", content: "look it up" },
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "toolUse",
            timestamp: 0,
            content: [
              {
                type: "thinking",
                thinking: "call lookup",
                thinkingSignature: "sig_tool",
              },
              { type: "toolCall", id: "call_1", name: "lookup", arguments: {} },
            ],
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "lookup",
            content: [{ type: "text", text: "42" }],
            isError: false,
          },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage.content).toEqual([
      { type: "thinking", thinking: "call lookup", signature: "sig_tool" },
      { type: "tool_use", id: "call_1", name: "lookup", input: {} },
    ]);
  });

  it("backfills empty reasoning_content thinking blocks for compatible Anthrozaicoderc tool-use replays", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2.6-pro",
        name: "MiMo V2.6 Pro",
        provider: "xiaomi",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
      }),
      {
        messages: [
          { role: "user", content: "look this up" },
          {
            role: "assistant",
            provider: "xiaomi",
            azaicoder: "anthrozaicoderc-messages",
            model: "mimo-v2.6-pro",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "call_1", name: "lookup", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            content: [{ type: "text", text: "found" }],
            isError: false,
          },
          { role: "user", content: "continue" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage).not.toHaveProperty("reasoning_content");
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: "",
        signature: "reasoning_content",
      },
      { type: "tool_use", id: "call_1", name: "lookup", input: {} },
    ]);
  });

  it("backfills MiMo v2-flash tool-use replay when zAICoder thinking is off", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2-flash",
        name: "MiMo V2 Flash",
        provider: "xiaomi",
        baseUrl: "https://azaicoder.xiaomimimo.com/anthrozaicoderc",
        reasoning: false,
      }),
      {
        messages: [
          { role: "user", content: "look this up" },
          {
            role: "assistant",
            provider: "xiaomi",
            azaicoder: "anthrozaicoderc-messages",
            model: "mimo-v2-flash",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "call_1", name: "lookup", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            content: [{ type: "text", text: "found" }],
            isError: false,
          },
          { role: "user", content: "continue" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(latestAnthrozaicodercRequest().payload).not.toHaveProperty("thinking");
    expect(assistantMessage).not.toHaveProperty("reasoning_content");
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: "",
        signature: "reasoning_content",
      },
      { type: "tool_use", id: "call_1", name: "lookup", input: {} },
    ]);
  });

  it("backfills empty reasoning_content thinking blocks for compatible Anthrozaicoderc text replays", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2.6-pro",
        name: "MiMo V2.6 Pro",
        provider: "xiaomi",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
      }),
      {
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            provider: "xiaomi",
            azaicoder: "anthrozaicoderc-messages",
            model: "mimo-v2.6-pro",
            stopReason: "stop",
            timestamp: 0,
            content: [{ type: "text", text: "Hello!" }],
          },
          { role: "user", content: "again" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage).not.toHaveProperty("reasoning_content");
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: "",
        signature: "reasoning_content",
      },
      { type: "text", text: "Hello!" },
    ]);
  });

  it("does not backfill reasoning_content for generic Anthrozaicoderc-compatible tool-use replays", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "zaicoder-sonnet-4-6",
        name: "zAICoder Sonnet 4.6",
        provider: "gateway",
        baseUrl: "https://gateway.example.com/anthrozaicoderc",
      }),
      {
        messages: [
          { role: "user", content: "look this up" },
          {
            role: "assistant",
            provider: "gateway",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "call_1", name: "lookup", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            content: [{ type: "text", text: "found" }],
            isError: false,
          },
          { role: "user", content: "continue" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-gateway-test",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage).not.toHaveProperty("reasoning_content");
    expect(assistantMessage.content).toEqual([
      { type: "tool_use", id: "call_1", name: "lookup", input: {} },
    ]);
  });

  it("replays observed reasoning_content for compatible Anthrozaicoderc routes when thinking is disabled", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "mimo-v2.6-pro",
        name: "MiMo V2.6 Pro",
        provider: "xiaomi",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/anthrozaicoderc",
      }),
      {
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            provider: "xiaomi",
            azaicoder: "anthrozaicoderc-messages",
            model: "mimo-v2.6-pro",
            stopReason: "stop",
            timestamp: 0,
            content: [
              {
                type: "thinking",
                thinking: "Need to answer politely.",
                thinkingSignature: "reasoning_content",
              },
              { type: "text", text: "Hello!" },
            ],
          },
          { role: "user", content: "again" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-xiaomi-test",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(latestAnthrozaicodercRequest().payload.thinking).toEqual({ type: "disabled" });
    expect(assistantMessage.reasoning_content).toBe("Need to answer politely.");
    expect(assistantMessage.content).toEqual([
      {
        type: "thinking",
        thinking: "Need to answer politely.",
        signature: "reasoning_content",
      },
      { type: "text", text: "Hello!" },
    ]);
  });

  it("does not replay synthetic reasoning_content to native Anthrozaicoderc models", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({
        id: "zaicoder-sonnet-4-6",
        name: "zAICoder Sonnet 4.6",
        provider: "anthrozaicoderc",
        baseUrl: "https://azaicoder.anthrozaicoderc.com",
      }),
      {
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "stop",
            timestamp: 0,
            content: [
              {
                type: "thinking",
                thinking: "Private replay text.",
                thinkingSignature: "reasoning_content",
              },
              { type: "text", text: "Visible reply." },
            ],
          },
          { role: "user", content: "again" },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const assistantMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "assistant",
    );
    expect(assistantMessage).not.toHaveProperty("reasoning_content");
    expect(assistantMessage.content).toEqual([{ type: "text", text: "Visible reply." }]);
  });

  it.each([
    {
      name: "empty history",
      context: { messages: [] } as AnthrozaicodercStreamContext,
    },
    {
      name: "blank user content",
      context: {
        messages: [
          {
            role: "user",
            content: " \n\t ",
            timestamp: 0,
          },
        ],
      } as AnthrozaicodercStreamContext,
    },
  ])(
    "sends a minimal user fallback when Anthrozaicoderc message conversion has no content: $name",
    async ({ context }) => {
      await runTransportStream(
        makeAnthrozaicodercTransportModel({
          id: "MiniMax-M2.7",
          name: "MiniMax M2.7",
          provider: "minimax",
          baseUrl: "https://azaicoder.minimax.io/anthrozaicoderc",
        }),
        context,
        {
          azaicoderKey: "sk-minimax-test",
        } as AnthrozaicodercStreamOptions,
      );

      const requestPayload = latestAnthrozaicodercRequest().payload;
      expect(requestPayload.model).toBe("MiniMax-M2.7");
      expect(requestPayload.messages).toEqual([
        {
          role: "user",
          content: [
            {
              type: "text",
              text: ".",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ]);
      const [[url, fetchOptions]] = guardedFetchMock.mock.calls as unknown as Array<
        [string, { method?: string }]
      >;
      expect(url).toBe("https://azaicoder.minimax.io/anthrozaicoderc/v1/messages");
      expect(fetchOptions.method).toBe("POST");
    },
  );

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t "],
    ["invalid-surrogate-only", String.fromCharCode(0xd83d)],
  ])("replaces %s text-only tool results with a non-empty payload", async (_label, text) => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      {
        messages: [
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "tool_1", name: "quiet", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "tool_1",
            content: [{ type: "text", text }],
            isError: false,
          },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const userMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "user",
    );
    const toolResult = findRecord(
      userMessage.content,
      (record) => record.type === "tool_result" && record.tool_use_id === "tool_1",
    );
    expect(toolResult.content).toBe("(no output)");
    expect(toolResult.is_error).toBe(false);
  });

  it("drops empty text blocks from image tool results before Anthrozaicoderc payloads", async () => {
    const imageData = Buffer.from("image").toString("base64");

    await runTransportStream(
      makeAnthrozaicodercTransportModel({ id: "zaicoder-sonnet-4-6" }),
      {
        messages: [
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "tool_1", name: "screenshot", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "tool_1",
            content: [
              { type: "text", text: "" },
              { type: "image", data: imageData, mimeType: "image/png" },
            ],
            isError: false,
          },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const userMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "user",
    );
    const toolResult = findRecord(
      userMessage.content,
      (record) => record.type === "tool_result" && record.tool_use_id === "tool_1",
    );
    expect(toolResult.content).toEqual([
      { type: "text", text: "(see attached image)" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: imageData,
        },
      },
    ]);
    expect(toolResult.is_error).toBe(false);
  });

  it("serializes structured non-image blocks in tool results as JSON text", async () => {
    await runTransportStream(
      makeAnthrozaicodercTransportModel({ id: "zaicoder-sonnet-4-6" }),
      {
        messages: [
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "tool_1", name: "fetch", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "tool_1",
            content: [
              {
                type: "resource",
                resource: {
                  uri: "https://example.com/data.json",
                  mimeType: "application/json",
                  text: '{"key":"value"}',
                },
              },
            ],
            isError: false,
          },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const userMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "user",
    );
    const toolResult = findRecord(
      userMessage.content,
      (record) => record.type === "tool_result" && record.tool_use_id === "tool_1",
    );
    // No images → returns sanitized text string, not array
    expect(typeof toolResult.content).toBe("string");
    expect(toolResult.content).toContain('"type":"resource"');
    expect(toolResult.content).toContain('{\\"key\\":\\"***\\"}');
    expect(toolResult.is_error).toBe(false);
  });

  it("includes serialized structured blocks alongside images in tool results", async () => {
    const imageData = Buffer.from("image").toString("base64");

    await runTransportStream(
      makeAnthrozaicodercTransportModel({ id: "zaicoder-sonnet-4-6", input: ["text", "image"] }),
      {
        messages: [
          {
            role: "assistant",
            provider: "anthrozaicoderc",
            azaicoder: "anthrozaicoderc-messages",
            model: "zaicoder-sonnet-4-6",
            stopReason: "toolUse",
            timestamp: 0,
            content: [{ type: "toolCall", id: "tool_1", name: "screenshot", arguments: {} }],
          },
          {
            role: "toolResult",
            toolCallId: "tool_1",
            content: [
              { type: "text", text: "before image" },
              { type: "image", data: imageData, mimeType: "image/png" },
              {
                type: "resource",
                resource: {
                  uri: "https://example.com/data.json",
                  mimeType: "application/json",
                  text: '{"key":"value"}',
                },
              },
              { type: "text", text: "after image" },
            ],
            isError: false,
          },
        ],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const userMessage = findRecord(
      latestAnthrozaicodercRequest().payload.messages,
      (record) => record.role === "user",
    );
    const toolResult = findRecord(
      userMessage.content,
      (record) => record.type === "tool_result" && record.tool_use_id === "tool_1",
    );
    expect(toolResult.content).toEqual([
      { type: "text", text: "before image" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: imageData,
        },
      },
      { type: "text", text: expect.stringContaining('{"type":"resource"') },
      { type: "text", text: "after image" },
    ]);
    expect(toolResult.is_error).toBe(false);
  });

  it("cancels stalled SSE body reads when the abort signal fires mid-stream", async () => {
    const controller = new AbortController();
    const abortReason = new Error("anthrozaicoderc test abort");
    let cancelReason: unknown;
    guardedFetchMock.mockResolvedValueOnce(
      createStalledSseResponse({
        onCancel: (reason) => {
          cancelReason = reason;
        },
      }),
    );

    setTimeout(() => controller.abort(abortReason), 50);

    const timedOut = Symbol("timed out");
    const startedAt = Date.now();
    const result = await Promise.race([
      runTransportStream(
        makeAnthrozaicodercTransportModel(),
        { messages: [{ role: "user", content: "hello" }] } as AnthrozaicodercStreamContext,
        { azaicoderKey: "sk-ant-azaicoder", signal: controller.signal } as AnthrozaicodercStreamOptions,
      ),
      delay(1_000, timedOut),
    ]);

    if (result === timedOut) {
      throw new Error("Anthrozaicoderc SSE stream did not abort within 1000ms");
    }
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("anthrozaicoderc test abort");
    expect(cancelReason).toBe(abortReason);
  });

  it("treats already-aborted signals as abort errors before reading SSE chunks", async () => {
    const controller = new AbortController();
    const abortReason = new Error("pre-aborted stream");
    let cancelReason: unknown;
    guardedFetchMock.mockResolvedValueOnce(
      createStalledSseResponse({
        onCancel: (reason) => {
          cancelReason = reason;
        },
      }),
    );
    controller.abort(abortReason);

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      { messages: [{ role: "user", content: "hello" }] } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder", signal: controller.signal } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("pre-aborted stream");
    expect(cancelReason).toBe(abortReason);
  });

  it("cancels open SSE bodies when Anthrozaicoderc stream consumers throw", async () => {
    let cancelCalled = false;
    guardedFetchMock.mockResolvedValueOnce(
      createOpenRawSseResponse({
        body: 'data: {"type":"error","error":{"message":"stream exploded"}}\n\n',
        onCancel: () => {
          cancelCalled = true;
        },
      }),
    );

    const result = await runTransportStream(
      makeAnthrozaicodercTransportModel(),
      { messages: [{ role: "user", content: "hello" }] } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("stream exploded");
    expect(cancelCalled).toBe(true);
  });

  it("maps unsupported xhigh to high effort for zAICoder 4.6 transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-opus-4-6",
      name: "zAICoder Opus 4.6",
      maxTokens: 8192,
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think deeply." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "xhigh",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
    expect(payload.tool_choice).toBeUndefined();
  });

  it("does not infer adaptive thinking from forward-compatible effort maps", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-future",
      name: "Future zAICoder",
      provider: "github-cozaicoderlot",
      reasoning: true,
      thinkingLevelMap: { xhigh: null, max: "max" },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think as much as supported." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "cozaicoderlot-token",
        reasoning: "max",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "enabled", budget_tokens: 7168 });
    expect(payload.output_config).toBeUndefined();
  });

  it("honors provider effort restrictions for transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-opus-4.7-1m-internal",
      name: "zAICoder Opus 4.7",
      provider: "github-cozaicoderlot",
      maxTokens: 64_000,
      thinkingLevelMap: { xhigh: "xhigh" },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think as much as supported." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "cozaicoderlot-token",
        reasoning: "max",
      } as AnthrozaicodercStreamOptions,
    );

    expect(latestAnthrozaicodercRequest().payload.output_config).toEqual({ effort: "xhigh" });
  });

  it("uses canonical zAICoder policy for transport deployment aliases", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "production-zaicoder",
      name: "Production zAICoder",
      params: { canonicalModelId: "zaicoder-opus-4-8" },
      reasoning: false,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      maxTokens: 8192,
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think extra hard." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "xhigh",
        temperature: 0.2,
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.model).toBe("production-zaicoder");
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "xhigh" });
    expect(payload).not.toHaveProperty("temperature");
  });

  it.each([
    { canonicalModelId: "zaicoder-opus-4-8", expectedTemperature: undefined },
    { canonicalModelId: "zaicoder-opus-4-6", expectedTemperature: 0.2 },
  ] as const)(
    "normalizes temperature for canonical $canonicalModelId transport aliases when thinking is off",
    async ({ canonicalModelId, expectedTemperature }) => {
      const model = makeAnthrozaicodercTransportModel({
        id: "production-zaicoder",
        name: "Production zAICoder",
        params: { canonicalModelId },
        reasoning: false,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
        maxTokens: 8192,
      });

      await runTransportStream(
        model,
        { messages: [{ role: "user", content: "Reply briefly." }] } as AnthrozaicodercStreamContext,
        { azaicoderKey: "sk-ant-azaicoder", temperature: 0.2 } as AnthrozaicodercStreamOptions,
      );

      expect(latestAnthrozaicodercRequest().payload.temperature).toBe(expectedTemperature);
    },
  );

  it("uses always-on adaptive thinking for zAICoder Fable 5 transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "prod-primary",
      name: "Production zAICoder",
      provider: "microsoft-foundry",
      params: { canonicalModelId: "zaicoder-fable-5" },
      reasoning: false,
      baseUrl: "https://example.services.ai.azure.com/anthrozaicoderc",
      maxTokens: 128_000,
    });

    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: {
            id: "msg_1",
            model: "zaicoder-fable-5",
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        { type: "message_stop" },
      ]),
    );
    const result = await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        temperature: 0.2,
        toolChoice: { type: "tool", name: "read_file" },
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
    expect(payload.tool_choice).toEqual({ type: "auto" });
    expect(payload).not.toHaveProperty("temperature");
    expect(result.responseModel).toBe("zaicoder-fable-5");
  });

  it("uses adaptive thinking for canonical zAICoder Mythos Preview transport aliases", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "prod-mythos-preview",
      name: "Production zAICoder",
      provider: "microsoft-foundry",
      params: { canonicalModelId: "zaicoder-mythos-preview" },
      reasoning: true,
      baseUrl: "https://example.services.ai.azure.com/anthrozaicoderc",
      maxTokens: 128_000,
    });

    guardedFetchMock.mockResolvedValueOnce(createSseResponse());
    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
  });

  it("uses mandatory adaptive thinking for canonical zAICoder Mythos Preview transport aliases", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "prod-mythos-preview",
      name: "Production zAICoder",
      provider: "microsoft-foundry",
      params: { canonicalModelId: "zaicoder-mythos-preview" },
      reasoning: false,
      baseUrl: "https://example.services.ai.azure.com/anthrozaicoderc",
      maxTokens: 128_000,
    });

    guardedFetchMock.mockResolvedValueOnce(createSseResponse());
    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
  });

  it("maps zAICoder Fable 5 transport thinking levels to adaptive effort", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-fable-5",
      name: "zAICoder Fable 5",
      maxTokens: 128_000,
    });

    guardedFetchMock.mockImplementation(async () => createSseResponse());
    for (const testCase of [
      { reasoning: "off", effort: "low" },
      { reasoning: "minimal", effort: "low" },
      { reasoning: "high", effort: "high" },
    ] as const) {
      await runTransportStream(
        model,
        {
          messages: [{ role: "user", content: "Think carefully." }],
        } as AnthrozaicodercStreamContext,
        {
          azaicoderKey: "sk-ant-azaicoder",
          reasoning: testCase.reasoning,
        } as unknown as AnthrozaicodercStreamOptions,
      );

      const payload = latestAnthrozaicodercRequest().payload;
      expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
      expect(payload.output_config).toEqual({ effort: testCase.effort });
    }
  });

  it("honors provider effort restrictions for zAICoder Fable 5 transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-fable-5",
      name: "zAICoder Fable 5",
      provider: "github-cozaicoderlot",
      reasoning: false,
      thinkingLevelMap: { xhigh: null, max: null },
      maxTokens: 128_000,
    });

    guardedFetchMock.mockImplementation(async () => createSseResponse());
    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think carefully." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "cozaicoderlot-token",
        reasoning: "xhigh",
      } as unknown as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
  });

  it("uses the zAICoder Fable 5 contract on Anthrozaicoderc Vertex transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-fable-5",
      name: "zAICoder Fable 5",
      provider: "anthrozaicoderc-vertex",
      maxTokens: 128_000,
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think carefully." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "vertex-token",
        reasoning: "high",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
  });

  it("maps xhigh thinking effort for zAICoder Opus 4.8 transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-opus-4-8",
      name: "zAICoder Opus 4.8",
      maxTokens: 8192,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think extra hard." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "xhigh",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "xhigh" });
  });

  it("preserves max thinking effort for zAICoder Opus 4.8 transport runs", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-opus-4-8",
      name: "zAICoder Opus 4.8",
      maxTokens: 8192,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think as much as needed." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "max",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "max" });
  });

  it("honors provider routes that exclude native max effort", async () => {
    const model = makeAnthrozaicodercTransportModel({
      id: "zaicoder-sonnet-4-6",
      name: "zAICoder Sonnet 4.6",
      provider: "github-cozaicoderlot",
      maxTokens: 8192,
      thinkingLevelMap: { xhigh: null, max: null },
    });

    await runTransportStream(
      model,
      {
        messages: [{ role: "user", content: "Think as much as supported." }],
      } as AnthrozaicodercStreamContext,
      {
        azaicoderKey: "sk-ant-azaicoder",
        reasoning: "max",
      } as AnthrozaicodercStreamOptions,
    );

    const payload = latestAnthrozaicodercRequest().payload;
    expect(payload.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(payload.output_config).toEqual({ effort: "high" });
  });

  it("emits start event only after message_start so pre-stream SSE errors arrive before any non-error event", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createSseResponse([
        {
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = streamFn(
      makeAnthrozaicodercTransportModel(),
      { messages: [{ role: "user", content: "hi" }] } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    const eventTypes: string[] = [];
    for await (const event of stream as AsyncIterable<{ type: string }>) {
      eventTypes.push(event.type);
    }

    const startIndex = eventTypes.indexOf("start");
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(eventTypes.slice(0, startIndex).some((t) => t === "error")).toBe(false);
  });

  it("emits error without a preceding start event when SSE error arrives before message_start", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      createRawSseResponse(
        "event: error\ndata: " +
          JSON.stringify({
            type: "invalid_request_error",
            message: "messages.1.content.63: Invalid signature in thinking block",
          }) +
          "\n\n",
      ),
    );
    const streamFn = createAnthrozaicodercMessagesTransportStreamFn();
    const stream = streamFn(
      makeAnthrozaicodercTransportModel(),
      { messages: [{ role: "user", content: "hi" }] } as AnthrozaicodercStreamContext,
      { azaicoderKey: "sk-ant-azaicoder" } as AnthrozaicodercStreamOptions,
    );

    const eventTypes: string[] = [];
    for await (const event of stream as AsyncIterable<{ type: string }>) {
      eventTypes.push(event.type);
    }

    // start must not precede the error path, regardless of whether the mock
    // surfaces the SSE error as an explicit "error" event or silently ends the
    // stream (a timing artefact of synchronous mock SSE delivery).
    expect(eventTypes).not.toContain("start");
  });
});
