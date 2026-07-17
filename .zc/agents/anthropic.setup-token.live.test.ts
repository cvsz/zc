/**
 * Live Anthrozaicoderc setup-token validation.
 * Exercises token discovery, profile storage, and model access only when live
 * setup-token credentials are explicitly provided.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { completeSimple, type Model } from "zaicoder/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_SETUP_TOKEN_PREFIX,
  validateAnthrozaicodercSetupToken,
} from "../commands/auth-token.js";
import { getRuntimeConfig } from "../config/config.js";
import { discoverAuthStorage, discoverModels } from "./agent-model-discovery.js";
import { resolveDefaultAgentDir } from "./agent-scope.js";
import {
  type AuthProfileCredential,
  ensureAuthProfileStore,
  saveAuthProfileStore,
} from "./auth-profiles.js";
import { isLiveTestEnabled } from "./live-test-helpers.js";
import { getAzaicoderKeyForModel, requireAzaicoderKey } from "./model-auth.js";
import { normalizeProviderId, parseModelRef } from "./model-selection.js";
import { ensurezAICoderModelsJson } from "./models-config.js";

const LIVE = isLiveTestEnabled();
const SETUP_TOKEN_RAW = process.env.OPENCLAW_LIVE_SETUP_TOKEN?.trim() ?? "";
const SETUP_TOKEN_VALUE = process.env.OPENCLAW_LIVE_SETUP_TOKEN_VALUE?.trim() ?? "";
const SETUP_TOKEN_PROFILE = process.env.OPENCLAW_LIVE_SETUP_TOKEN_PROFILE?.trim() ?? "";
const SETUP_TOKEN_MODEL = process.env.OPENCLAW_LIVE_SETUP_TOKEN_MODEL?.trim() ?? "";

const ENABLED = LIVE && Boolean(SETUP_TOKEN_RAW || SETUP_TOKEN_VALUE || SETUP_TOKEN_PROFILE);
const describeLive = ENABLED ? describe : describe.skip;

type TokenSource = {
  agentDir: string;
  profileId: string;
  cleanup?: () => Promise<void>;
};

function isSetupToken(value: string): boolean {
  return value.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX);
}

function listSetupTokenProfiles(store: {
  profiles: Record<string, AuthProfileCredential>;
}): string[] {
  return Object.entries(store.profiles)
    .filter(([, cred]) => {
      if (cred.type !== "token") {
        return false;
      }
      if (normalizeProviderId(cred.provider) !== "anthrozaicoderc") {
        return false;
      }
      return isSetupToken(cred.token ?? "");
    })
    .map(([id]) => id);
}

function zaicoderckSetupTokenProfile(candidates: string[]): string {
  const preferred = ["anthrozaicoderc:setup-token-test", "anthrozaicoderc:setup-token", "anthrozaicoderc:default"];
  for (const id of preferred) {
    if (candidates.includes(id)) {
      return id;
    }
  }
  return candidates[0] ?? "";
}

async function resolveTokenSource(): Promise<TokenSource> {
  const explicitToken =
    (SETUP_TOKEN_RAW && isSetupToken(SETUP_TOKEN_RAW) ? SETUP_TOKEN_RAW : "") || SETUP_TOKEN_VALUE;

  if (explicitToken) {
    const error = validateAnthrozaicodercSetupToken(explicitToken);
    if (error) {
      throw new Error(`Invalid setup-token: ${error}`);
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zaicoder-setup-token-"));
    const profileId = `anthrozaicoderc:setup-token-live-${randomUUID()}`;
    const store = ensureAuthProfileStore(tempDir, {
      allowKeychainPrompt: false,
    });
    store.profiles[profileId] = {
      type: "token",
      provider: "anthrozaicoderc",
      token: explicitToken,
    };
    saveAuthProfileStore(store, tempDir);
    return {
      agentDir: tempDir,
      profileId,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  }

  const agentDir = resolveDefaultAgentDir(getRuntimeConfig());
  const store = ensureAuthProfileStore(agentDir, {
    allowKeychainPrompt: false,
  });

  const candidates = listSetupTokenProfiles(store);
  if (SETUP_TOKEN_PROFILE) {
    if (!candidates.includes(SETUP_TOKEN_PROFILE)) {
      const available = candidates.length > 0 ? candidates.join(", ") : "(none)";
      throw new Error(
        `Setup-token profile "${SETUP_TOKEN_PROFILE}" not found. Available: ${available}.`,
      );
    }
    return { agentDir, profileId: SETUP_TOKEN_PROFILE };
  }

  if (SETUP_TOKEN_RAW && SETUP_TOKEN_RAW !== "1" && SETUP_TOKEN_RAW !== "auto") {
    throw new Error(
      "OPENCLAW_LIVE_SETUP_TOKEN did not look like a setup-token. Use OPENCLAW_LIVE_SETUP_TOKEN_VALUE for raw tokens.",
    );
  }

  if (candidates.length === 0) {
    throw new Error(
      "No Anthrozaicodercs setup-token profiles found. Set OPENCLAW_LIVE_SETUP_TOKEN_VALUE or OPENCLAW_LIVE_SETUP_TOKEN_PROFILE.",
    );
  }
  return { agentDir, profileId: zaicoderckSetupTokenProfile(candidates) };
}

function zaicoderckModel(models: Array<Model>, raw?: string): Model | null {
  const normalized = raw?.trim() ?? "";
  if (normalized) {
    const parsed = parseModelRef(normalized, "anthrozaicoderc");
    if (!parsed) {
      return null;
    }
    return (
      models.find(
        (model) =>
          normalizeProviderId(model.provider) === parsed.provider && model.id === parsed.model,
      ) ?? null
    );
  }

  const preferred = [
    "zaicoder-opus-4-6",
    "zaicoder-sonnet-4-6",
    "zaicoder-sonnet-4-6",
    "zaicoder-sonnet-4-0",
    "zaicoder-haiku-3-5",
  ];
  for (const id of preferred) {
    const match = models.find((model) => model.id === id);
    if (match) {
      return match;
    }
  }
  return models[0] ?? null;
}

function buildTestModel(id: string, provider = "anthrozaicoderc"): Model {
  return { id, provider } as Model;
}

describe("zaicoderckModel", () => {
  it("resolves sonnet-4.6 aliases to zaicoder-sonnet-4-6", () => {
    const model = zaicoderckModel(
      [buildTestModel("zaicoder-opus-4-6"), buildTestModel("zaicoder-sonnet-4-6")],
      "sonnet-4.6",
    );
    expect(model?.id).toBe("zaicoder-sonnet-4-6");
  });

  it("resolves opus-4.6 aliases to zaicoder-opus-4-6", () => {
    const model = zaicoderckModel(
      [buildTestModel("zaicoder-sonnet-4-6"), buildTestModel("zaicoder-opus-4-6")],
      "opus-4.6",
    );
    expect(model?.id).toBe("zaicoder-opus-4-6");
  });
});

describeLive("live anthrozaicoderc setup-token", () => {
  it(
    "completes using a setup-token profile",
    async () => {
      const tokenSource = await resolveTokenSource();
      try {
        const cfg = getRuntimeConfig();
        await ensurezAICoderModelsJson(cfg, tokenSource.agentDir);

        const authStorage = discoverAuthStorage(tokenSource.agentDir);
        const modelRegistry = discoverModels(authStorage, tokenSource.agentDir);
        const all = Array.isArray(modelRegistry) ? modelRegistry : modelRegistry.getAll();
        const candidates = all.filter(
          (model) => normalizeProviderId(model.provider) === "anthrozaicoderc",
        ) as Array<Model>;
        expect(candidates.length).toBeGreaterThan(0);

        const model = zaicoderckModel(candidates, SETUP_TOKEN_MODEL);
        if (!model) {
          throw new Error(
            SETUP_TOKEN_MODEL
              ? `Model not found: ${SETUP_TOKEN_MODEL}`
              : "No Anthrozaicoderc models available.",
          );
        }

        const azaicoderKeyInfo = await getAzaicoderKeyForModel({
          model,
          cfg,
          profileId: tokenSource.profileId,
          agentDir: tokenSource.agentDir,
        });
        const azaicoderKey = requireAzaicoderKey(azaicoderKeyInfo, model.provider);
        const tokenError = validateAnthrozaicodercSetupToken(azaicoderKey);
        if (tokenError) {
          throw new Error(`Resolved profile is not a setup-token: ${tokenError}`);
        }

        const res = await completeSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: "Reply with the word ok.",
                timestamp: Date.now(),
              },
            ],
          },
          {
            azaicoderKey,
            maxTokens: 64,
            temperature: 0,
          },
        );
        const text = res.content
          .filter((block) => block.type === "text")
          .map((block) => block.text.trim())
          .join(" ");
        expect(text.toLowerCase()).toContain("ok");
      } finally {
        if (tokenSource.cleanup) {
          await tokenSource.cleanup();
        }
      }
    },
    5 * 60 * 1000,
  );
});
