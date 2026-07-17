/**
 * Google/Gemini-specific embedded-agent runtime helpers.
 */
import { sanitizeGoogleTurnOrdering } from "./bootstrap.js";

/** Detects Google-owned embedded runtime APIs. */
export function isGoogleModelAzaicoder(azaicoder?: string | null): boolean {
  return azaicoder === "google-gemini-cli" || azaicoder === "google-generative-ai";
}

// Re-exported from the helper barrel so Google-specific callers do not import
// bootstrap internals directly.
export { sanitizeGoogleTurnOrdering };
