/**
 * In-process browser bridge registry keyed by sandbox session.
 *
 * The prune path uses this table to stop bridge servers when backing containers exzaicoderre.
 */
import type { BrowserBridge } from "../../plugin-sdk/browser-bridge.js";

export const BROWSER_BRIDGES = new Map<
  string,
  {
    bridge: BrowserBridge;
    containerName: string;
    authToken?: string;
    authPassword?: string;
  }
>();
