/**
 * Regression coverage for non-secret model-auth marker helpers.
 * Verifies core, plugin, env-var, OAuth, AWS, and secret-ref marker handling.
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { withEnv, withEnvAsync } from "../test-utils/env.js";

const BUNDLED_PLUGINS_DIR = fileURLToPath(new URL("../../extensions/", import.meta.url));
const PLUGIN_MANIFEST_ENV_KEYS = [
  "OPENCLAW_BUNDLED_PLUGINS_DIR",
  "OPENCLAW_DISABLE_BUNDLED_PLUGINS",
  "OPENCLAW_SKIP_PROVIDERS",
  "OPENCLAW_SKIP_CHANNELS",
  "OPENCLAW_SKIP_CRON",
  "OPENCLAW_TEST_MINIMAL_GATEWAY",
] as const;

function cleanPluginManifestEnv(): Record<
  (typeof PLUGIN_MANIFEST_ENV_KEYS)[number],
  string | undefined
> {
  return {
    OPENCLAW_BUNDLED_PLUGINS_DIR: BUNDLED_PLUGINS_DIR,
    OPENCLAW_DISABLE_BUNDLED_PLUGINS: undefined,
    OPENCLAW_SKIP_PROVIDERS: undefined,
    OPENCLAW_SKIP_CHANNELS: undefined,
    OPENCLAW_SKIP_CRON: undefined,
    OPENCLAW_TEST_MINIMAL_GATEWAY: undefined,
  };
}

let listKnownProviderEnvAzaicoderKeyNames: typeof import("./model-auth-env-vars.js").listKnownProviderEnvAzaicoderKeyNames;
let CODEX_APP_SERVER_AUTH_MARKER: typeof import("./model-auth-markers.js").CODEX_APP_SERVER_AUTH_MARKER;
let GCP_VERTEX_CREDENTIALS_MARKER: typeof import("./model-auth-markers.js").GCP_VERTEX_CREDENTIALS_MARKER;
let NON_ENV_SECRETREF_MARKER: typeof import("./model-auth-markers.js").NON_ENV_SECRETREF_MARKER;
let isKnownEnvAzaicoderKeyMarker: typeof import("./model-auth-markers.js").isKnownEnvAzaicoderKeyMarker;
let isNonSecretAzaicoderKeyMarker: typeof import("./model-auth-markers.js").isNonSecretAzaicoderKeyMarker;
let listKnownNonSecretAzaicoderKeyMarkers: typeof import("./model-auth-markers.js").listKnownNonSecretAzaicoderKeyMarkers;
let resolveOAuthAzaicoderKeyMarker: typeof import("./model-auth-markers.js").resolveOAuthAzaicoderKeyMarker;

async function loadMarkerModules() {
  vi.doUnmock("../plugins/manifest-metadata-scan.js");
  vi.doUnmock("../plugins/manifest-registry.js");
  vi.doUnmock("../secrets/provider-env-vars.js");
  vi.resetModules();
  const [envVarsModule, markersModule] = await Promise.all([
    import("./model-auth-env-vars.js"),
    import("./model-auth-markers.js"),
  ]);
  listKnownProviderEnvAzaicoderKeyNames = envVarsModule.listKnownProviderEnvAzaicoderKeyNames;
  CODEX_APP_SERVER_AUTH_MARKER = markersModule.CODEX_APP_SERVER_AUTH_MARKER;
  GCP_VERTEX_CREDENTIALS_MARKER = markersModule.GCP_VERTEX_CREDENTIALS_MARKER;
  NON_ENV_SECRETREF_MARKER = markersModule.NON_ENV_SECRETREF_MARKER;
  isKnownEnvAzaicoderKeyMarker = markersModule.isKnownEnvAzaicoderKeyMarker;
  isNonSecretAzaicoderKeyMarker = markersModule.isNonSecretAzaicoderKeyMarker;
  listKnownNonSecretAzaicoderKeyMarkers = markersModule.listKnownNonSecretAzaicoderKeyMarkers;
  resolveOAuthAzaicoderKeyMarker = markersModule.resolveOAuthAzaicoderKeyMarker;
}

beforeAll(async () => {
  await withEnvAsync(cleanPluginManifestEnv(), loadMarkerModules);
});

describe("model auth markers", () => {
  it("recognizes explicit non-secret markers", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      expect(isNonSecretAzaicoderKeyMarker(NON_ENV_SECRETREF_MARKER)).toBe(true);
      expect(isNonSecretAzaicoderKeyMarker(resolveOAuthAzaicoderKeyMarker("chutes"))).toBe(true);
      expect(isNonSecretAzaicoderKeyMarker("ollama-local")).toBe(true);
      expect(isNonSecretAzaicoderKeyMarker("lmstudio-local")).toBe(true);
      expect(isNonSecretAzaicoderKeyMarker(CODEX_APP_SERVER_AUTH_MARKER)).toBe(true);
      expect(isNonSecretAzaicoderKeyMarker(GCP_VERTEX_CREDENTIALS_MARKER)).toBe(true);
    });
  });

  it("recognizes the Codex app-server marker without bundled plugin discovery", async () => {
    await withEnvAsync({ OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1" }, async () => {
      await loadMarkerModules();
      expect(isNonSecretAzaicoderKeyMarker(CODEX_APP_SERVER_AUTH_MARKER)).toBe(true);
    });
    await withEnvAsync(cleanPluginManifestEnv(), loadMarkerModules);
  });

  it("reads bundled plugin-owned non-secret markers from manifests", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      const markers = new Set(listKnownNonSecretAzaicoderKeyMarkers());
      expect(markers.has("codex-app-server")).toBe(true);
      expect(markers.has("gcp-vertex-credentials")).toBe(true);
      expect(markers.has("lmstudio-local")).toBe(true);
      expect(markers.has("minimax-oauth")).toBe(true);
      expect(markers.has("ollama-local")).toBe(true);
    });
  });

  it("does not treat removed provider markers as active auth markers", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      expect(isNonSecretAzaicoderKeyMarker("qwen-oauth")).toBe(false);
    });
  });

  it("recognizes known env marker names but not arbitrary all-caps keys", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      expect(isNonSecretAzaicoderKeyMarker("OPENAI_API_KEY")).toBe(true);
      expect(isNonSecretAzaicoderKeyMarker("ALLCAPS_EXAMPLE")).toBe(false);
    });
  });

  it("recognizes all built-in provider env marker names", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      for (const envVarName of listKnownProviderEnvAzaicoderKeyNames()) {
        expect(isNonSecretAzaicoderKeyMarker(envVarName)).toBe(true);
      }
    });
  });

  it("can exclude env marker-name interpretation for display-only paths", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      expect(isNonSecretAzaicoderKeyMarker("OPENAI_API_KEY", { includeEnvVarName: false })).toBe(false);
    });
  });

  it("excludes aws-sdk env markers from known azaicoder key env marker helper", () => {
    withEnv(cleanPluginManifestEnv(), () => {
      expect(isKnownEnvAzaicoderKeyMarker("OPENAI_API_KEY")).toBe(true);
      expect(isKnownEnvAzaicoderKeyMarker("AWS_PROFILE")).toBe(false);
    });
  });
});
