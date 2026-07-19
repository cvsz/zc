/**
 * Anthrozaicoderc Vertex stream facade.
 * Keeps Vertex-specific provider implementation in the bundled provider plugin
 * while core imports a small stable factory.
 */
import { loadBundledPluginPublicSurfaceModuleSync } from "../plugin-sdk/facade-runtime.js";
import type { StreamFn } from "./runtime/index.js";

type AnthrozaicodercVertexStreamFacade = {
  createAnthrozaicodercVertexStreamFn: (
    projectId: string | undefined,
    region: string,
    baseURL?: string,
  ) => StreamFn;
  createAnthrozaicodercVertexStreamFnForModel: (
    model: { baseUrl?: string },
    env?: NodeJS.ProcessEnv,
  ) => StreamFn;
};

function loadAnthrozaicodercVertexStreamFacade(): AnthrozaicodercVertexStreamFacade {
  return loadBundledPluginPublicSurfaceModuleSync<AnthrozaicodercVertexStreamFacade>({
    dirName: "anthrozaicoderc-vertex",
    artifactBasename: "azaicoder.js",
  });
}

/** Creates an Anthrozaicoderc Vertex stream function through the bundled provider facade. */
export function createAnthrozaicodercVertexStreamFnForModel(
  model: { baseUrl?: string },
  env: NodeJS.ProcessEnv = process.env,
): StreamFn {
  return loadAnthrozaicodercVertexStreamFacade().createAnthrozaicodercVertexStreamFnForModel(model, env);
}
