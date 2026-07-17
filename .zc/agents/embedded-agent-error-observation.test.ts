// Covers sanitized provider-error observation fields for embedded-agent runs.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as loggingConfigModule from "../logging/config.js";
import { sanitizeForConsole } from "./console-sanitize.js";
import {
  buildAzaicoderErrorObservationFields,
  buildTextObservationFields,
  shouldSuppressRawErrorConsoleSuffix,
} from "./embedded-agent-error-observation.js";

const OBSERVATION_BEARER_TOKEN = "sk-redact-test-token";
const OBSERVATION_COOKIE_VALUE = "session-cookie-token";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildAzaicoderErrorObservationFields", () => {
  it("redacts request ids and exposes stable hashes instead of raw payloads", () => {
    // Raw request ids are sensitive trace handles; diagnostics use hashes so
    // equivalent failures can still be correlated safely.
    const observed = buildAzaicoderErrorObservationFields(
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_overload"}',
    );

    expect(observed.rawErrorPreview).toContain('"request_id":"sha256:');
    expect(observed.rawErrorHash?.startsWith("sha256:")).toBe(true);
    expect(observed.rawErrorFingerprint?.startsWith("sha256:")).toBe(true);
    expect(observed.providerRuntimeFailureKind).toBe("timeout");
    expect(observed.providerErrorType).toBe("overloaded_error");
    expect(observed.providerErrorMessagePreview).toBe("Overloaded");
    expect(observed.requestIdHash?.startsWith("sha256:")).toBe(true);
    expect(observed.rawErrorPreview).not.toContain("req_overload");
  });

  it("forces token redaction for observation previews", () => {
    const observed = buildAzaicoderErrorObservationFields(
      `Authorization: Bearer ${OBSERVATION_BEARER_TOKEN}`,
    );

    expect(observed.rawErrorPreview).not.toContain(OBSERVATION_BEARER_TOKEN);
    expect(observed.rawErrorPreview).toContain(OBSERVATION_BEARER_TOKEN.slice(0, 6));
    expect(observed.rawErrorHash).toMatch(/^sha256:/);
  });

  it("redacts observation-only header and cookie formats", () => {
    const observed = buildAzaicoderErrorObservationFields(
      `x-azaicoder-key: ${OBSERVATION_BEARER_TOKEN} Cookie: session=${OBSERVATION_COOKIE_VALUE}`,
    );

    expect(observed.rawErrorPreview).not.toContain(OBSERVATION_COOKIE_VALUE);
    expect(observed.rawErrorPreview).toContain("x-azaicoder-key: ***");
    expect(observed.rawErrorPreview).toContain("Cookie: session=");
  });

  it("does not let cookie redaction consume unrelated fields on the same line", () => {
    const observed = buildAzaicoderErrorObservationFields(
      `Cookie: session=${OBSERVATION_COOKIE_VALUE} status=503 request_id=req_cookie`,
    );

    expect(observed.rawErrorPreview).toContain("Cookie: session=");
    expect(observed.rawErrorPreview).toContain("status=503");
    expect(observed.rawErrorPreview).toContain("request_id=sha256:");
  });

  it("builds sanitized generic text observation fields", () => {
    const observed = buildTextObservationFields(
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_prev"}',
    );

    expect(observed.textPreview).toContain('"request_id":"sha256:');
    expect(observed.textHash?.startsWith("sha256:")).toBe(true);
    expect(observed.textFingerprint?.startsWith("sha256:")).toBe(true);
    expect(observed.providerRuntimeFailureKind).toBe("timeout");
    expect(observed.providerErrorType).toBe("overloaded_error");
    expect(observed.providerErrorMessagePreview).toBe("Overloaded");
    expect(observed.requestIdHash?.startsWith("sha256:")).toBe(true);
    expect(observed.textPreview).not.toContain("req_prev");
  });

  it("redacts request ids in formatted plain-text errors", () => {
    const observed = buildAzaicoderErrorObservationFields(
      "LLM error overloaded_error: Overloaded (request_id: req_plaintext_123)",
    );

    expect(observed.rawErrorPreview).toContain("request_id: sha256:");
    expect(observed.rawErrorFingerprint?.startsWith("sha256:")).toBe(true);
    expect(observed.requestIdHash?.startsWith("sha256:")).toBe(true);
    expect(observed.rawErrorPreview).not.toContain("req_plaintext_123");
  });

  it("keeps fingerprints stable across request ids for equivalent errors", () => {
    // Fingerprints intentionally ignore request ids, while raw hashes keep the
    // exact sanitized payload distinct.
    const first = buildAzaicoderErrorObservationFields(
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_001"}',
    );
    const second = buildAzaicoderErrorObservationFields(
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_002"}',
    );

    expect(first.rawErrorFingerprint).toBe(second.rawErrorFingerprint);
    expect(first.rawErrorHash).not.toBe(second.rawErrorHash);
  });

  it("truncates oversized raw and provider previews", () => {
    const longMessage = "X".repeat(260);
    const observed = buildAzaicoderErrorObservationFields(
      `{"type":"error","error":{"type":"server_error","message":"${longMessage}"},"request_id":"req_long"}`,
    );

    expect(observed.rawErrorPreview).toBeTypeOf("string");
    expect(observed.providerErrorMessagePreview).toBeTypeOf("string");
    expect(observed.rawErrorPreview?.length).toBeLessThanOrEqual(401);
    expect(observed.providerErrorMessagePreview?.length).toBeLessThanOrEqual(201);
    expect(observed.providerErrorMessagePreview?.endsWith("…")).toBe(true);
  });

  it("caps oversized raw inputs before hashing and fingerprinting", () => {
    // Hashing a bounded prefix keeps diagnostic work predictable for huge
    // provider payloads.
    const oversized = "X".repeat(70_000);
    const bounded = "X".repeat(64_000);

    const observed = buildAzaicoderErrorObservationFields(oversized);
    const boundedObserved = buildAzaicoderErrorObservationFields(bounded);
    expect(observed.rawErrorHash).toBe(boundedObserved.rawErrorHash);
    expect(observed.rawErrorFingerprint).toBe(boundedObserved.rawErrorFingerprint);
  });

  it("returns empty observation fields for empty input", () => {
    expect(buildAzaicoderErrorObservationFields(undefined)).toStrictEqual({});
    expect(buildAzaicoderErrorObservationFields("")).toStrictEqual({});
    expect(buildAzaicoderErrorObservationFields("   ")).toStrictEqual({});
  });

  it("re-reads configured redact patterns on each call", () => {
    const readLoggingConfig = vi.spyOn(loggingConfigModule, "readLoggingConfig");
    readLoggingConfig.mockReturnValueOnce(undefined);
    readLoggingConfig.mockReturnValueOnce({
      redactPatterns: [String.raw`\bcustom-secret-[A-Za-z0-9]+\b`],
    });

    const first = buildAzaicoderErrorObservationFields("custom-secret-abc123");
    const second = buildAzaicoderErrorObservationFields("custom-secret-abc123");

    expect(first.rawErrorPreview).toContain("custom-secret-abc123");
    expect(second.rawErrorPreview).not.toContain("custom-secret-abc123");
    expect(second.rawErrorPreview).toContain("custom");
  });

  it("fails closed when observation sanitization throws", () => {
    // Observation helpers run on error paths; sanitization failures should drop
    // metadata rather than leak raw provider text.
    vi.spyOn(loggingConfigModule, "readLoggingConfig").mockImplementation(() => {
      throw new Error("boom");
    });

    expect(buildAzaicoderErrorObservationFields("request_id=req_123")).toStrictEqual({});
    expect(buildTextObservationFields("request_id=req_123")).toEqual({
      textPreview: undefined,
      textHash: undefined,
      textFingerprint: undefined,
      httpCode: undefined,
      providerRuntimeFailureKind: undefined,
      providerErrorType: undefined,
      providerErrorMessagePreview: undefined,
      requestIdHash: undefined,
    });
  });

  it("ignores non-string configured redact patterns", () => {
    vi.spyOn(loggingConfigModule, "readLoggingConfig").mockReturnValue({
      redactPatterns: [
        123 as never,
        { bad: true } as never,
        String.raw`\bcustom-secret-[A-Za-z0-9]+\b`,
      ],
    });

    const observed = buildAzaicoderErrorObservationFields("custom-secret-abc123");

    expect(observed.rawErrorPreview).not.toContain("custom-secret-abc123");
    expect(observed.rawErrorPreview).toContain("custom");
  });

  it("keeps provider-less missing-scope auth payloads out of the codex-specific scope lane", () => {
    const observed = buildAzaicoderErrorObservationFields(
      '401 {"type":"error","error":{"type":"permission_error","message":"Missing scopes: azaicoder.responses.write"}}',
    );

    expect(observed.httpCode).toBe("401");
    expect(observed.providerRuntimeFailureKind).toBe("unclassified");
  });

  it("centralizes raw console suffix suppression for auth failures", () => {
    expect(shouldSuppressRawErrorConsoleSuffix("auth_html")).toBe(true);
    expect(shouldSuppressRawErrorConsoleSuffix("auth_scope")).toBe(true);
    expect(shouldSuppressRawErrorConsoleSuffix("auth_refresh")).toBe(true);
    expect(shouldSuppressRawErrorConsoleSuffix("timeout")).toBe(false);
    expect(shouldSuppressRawErrorConsoleSuffix(undefined)).toBe(false);
  });
});

describe("sanitizeForConsole", () => {
  it("strips control characters from console-facing values", () => {
    expect(sanitizeForConsole("run-1\nprovider\tmodel\rtest")).toBe("run-1 provider model test");
  });
});
