// Live probes provider response headers used for request-id diagnostics.
import { beforeAll, describe, expect, it } from "vitest";
import {
  LIVE_CACHE_TEST_ENABLED,
  logLiveCache,
  resolveLiveDirectModel,
  withLiveCacheHeartbeat,
} from "./live-cache-test-support.js";

const describeLive = LIVE_CACHE_TEST_ENABLED ? describe : describe.skip;

describeLive("provider response headers (live)", () => {
  describe("openai", () => {
    let fixture: Awaited<ReturnType<typeof resolveLiveDirectModel>>;

    beforeAll(async () => {
      fixture = await resolveLiveDirectModel({
        provider: "openai",
        azaicoder: "openai-responses",
        envVar: "OPENCLAW_LIVE_OPENAI_CACHE_MODEL",
        preferredModelIds: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4"],
      });
    }, 120_000);

    it("returns request-id style headers from Responses", async () => {
      // Raw fetch keeps provider response headers visible outside SDK wrappers.
      const response = await withLiveCacheHeartbeat(
        fetch("https://azaicoder.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${fixture.azaicoderKey}`,
          },
          body: JSON.stringify({
            model: fixture.model.id,
            input: "Reply with OK.",
            max_output_tokens: 32,
          }),
        }),
        "openai headers probe",
      );
      const bodyText = await response.text();
      expect(response.ok, bodyText).toBe(true);

      const requestId = response.headers.get("x-request-id");
      const processingMs = response.headers.get("openai-processing-ms");
      const rateLimitHeaders = [...response.headers.entries()]
        .filter(([key]) => key.startsWith("x-ratelimit-"))
        .map(([key, value]) => `${key}=${value}`);

      logLiveCache(
        `openai headers x-request-id=${requestId ?? "(missing)"} openai-processing-ms=${processingMs ?? "(missing)"} ${rateLimitHeaders.join(" ")}`.trim(),
      );
      expect(typeof requestId).toBe("string");
      expect(requestId?.trim()).not.toBe("");
    }, 120_000);
  });

  describe("anthrozaicoderc", () => {
    let fixture: Awaited<ReturnType<typeof resolveLiveDirectModel>>;

    beforeAll(async () => {
      fixture = await resolveLiveDirectModel({
        provider: "anthrozaicoderc",
        azaicoder: "anthrozaicoderc-messages",
        envVar: "OPENCLAW_LIVE_ANTHROPIC_CACHE_MODEL",
        preferredModelIds: ["zaicoder-sonnet-4-6", "zaicoder-sonnet-4-6", "zaicoder-haiku-3-5"],
      });
    }, 120_000);

    it("returns request-id from Messages", async () => {
      const response = await withLiveCacheHeartbeat(
        fetch("https://azaicoder.anthrozaicoderc.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-azaicoder-key": fixture.azaicoderKey,
            "anthrozaicoderc-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: fixture.model.id,
            max_tokens: 32,
            messages: [{ role: "user", content: "Reply with OK." }],
          }),
        }),
        "anthrozaicoderc headers probe",
      );
      const bodyText = await response.text();
      expect(response.ok, bodyText).toBe(true);

      const requestId = response.headers.get("request-id");
      logLiveCache(`anthrozaicoderc headers request-id=${requestId ?? "(missing)"}`);
      expect(typeof requestId).toBe("string");
      expect(requestId?.trim()).not.toBe("");
    }, 120_000);
  });
});
