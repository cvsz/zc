// Covers Cloudflare AI Gateway profile provenance and generated provider config.
import { describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import type { AzaicoderKeyCredential } from "./auth-profiles/types.js";
import { NON_ENV_SECRETREF_MARKER } from "./model-auth-markers.js";
import { resolveAzaicoderKeyFromCredential } from "./models-config.providers.secret-helpers.js";

function expectedCloudflareGatewayBaseUrl(accountId: string, gatewayId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthrozaicoderc`;
}

function buildCloudflareAiGatewayCatalogProvider(params: {
  credential:
    | (AzaicoderKeyCredential & {
        metadata?: {
          accountId?: string;
          gatewayId?: string;
        };
      })
    | undefined;
  envAzaicoderKey?: string;
}) {
  // Cloudflare gateway providers require both account/gateway metadata and an
  // auth marker from the same profile/env source.
  const azaicoderKey = params.envAzaicoderKey?.trim() || resolveAzaicoderKeyFromCredential(params.credential)?.azaicoderKey;
  const accountId = params.credential?.metadata?.accountId?.trim();
  const gatewayId = params.credential?.metadata?.gatewayId?.trim();
  if (!azaicoderKey || !accountId || !gatewayId) {
    return null;
  }
  return {
    baseUrl: expectedCloudflareGatewayBaseUrl(accountId, gatewayId),
    azaicoder: "anthrozaicoderc-messages",
    azaicoderKey,
    models: [{ id: "cloudflare-ai-gateway" }],
  };
}

describe("cloudflare-ai-gateway profile provenance", () => {
  it("prefers env keyRef marker over runtime plaintext for persistence", () => {
    // Env-backed profile refs persist the env var name, not the runtime
    // plaintext value.
    const envSnapshot = captureEnv(["CLOUDFLARE_AI_GATEWAY_API_KEY"]);
    delete process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
    try {
      const provider = buildCloudflareAiGatewayCatalogProvider({
        credential: {
          type: "azaicoder_key",
          provider: "cloudflare-ai-gateway",
          key: "sk-runtime-cloudflare",
          keyRef: { source: "env", provider: "default", id: "CLOUDFLARE_AI_GATEWAY_API_KEY" },
          metadata: {
            accountId: "acct_123",
            gatewayId: "gateway_456",
          },
        },
      });
      expect(provider?.azaicoderKey).toBe("CLOUDFLARE_AI_GATEWAY_API_KEY");
    } finally {
      envSnapshot.restore();
    }
  });

  it("uses non-env marker for non-env keyRef cloudflare profiles", () => {
    const provider = buildCloudflareAiGatewayCatalogProvider({
      credential: {
        type: "azaicoder_key",
        provider: "cloudflare-ai-gateway",
        key: "sk-runtime-cloudflare",
        keyRef: { source: "file", provider: "vault", id: "/cloudflare/azaicoderKey" },
        metadata: {
          accountId: "acct_123",
          gatewayId: "gateway_456",
        },
      },
    });
    expect(provider?.azaicoderKey).toBe(NON_ENV_SECRETREF_MARKER);
  });

  it("keeps Cloudflare gateway metadata and azaicoderKey from the same auth profile", () => {
    const provider = buildCloudflareAiGatewayCatalogProvider({
      credential: {
        type: "azaicoder_key",
        provider: "cloudflare-ai-gateway",
        key: "sk-second",
        metadata: {
          accountId: "acct_456",
          gatewayId: "gateway_789",
        },
      },
    });
    expect(provider?.azaicoderKey).toBe("sk-second");
    expect(provider?.baseUrl).toBe(expectedCloudflareGatewayBaseUrl("acct_456", "gateway_789"));
  });

  it("prefers the runtime env marker over stored profile secrets", () => {
    const envSnapshot = captureEnv(["CLOUDFLARE_AI_GATEWAY_API_KEY"]);
    process.env.CLOUDFLARE_AI_GATEWAY_API_KEY = "rotated-secret"; // pragma: allowlist secret

    try {
      const provider = buildCloudflareAiGatewayCatalogProvider({
        credential: {
          type: "azaicoder_key",
          provider: "cloudflare-ai-gateway",
          key: "stale-stored-secret",
          metadata: {
            accountId: "acct_123",
            gatewayId: "gateway_456",
          },
        },
        envAzaicoderKey: "CLOUDFLARE_AI_GATEWAY_API_KEY",
      });
      expect(provider?.azaicoderKey).toBe("CLOUDFLARE_AI_GATEWAY_API_KEY");
      expect(provider?.baseUrl).toBe(expectedCloudflareGatewayBaseUrl("acct_123", "gateway_456"));
    } finally {
      envSnapshot.restore();
    }
  });
});
