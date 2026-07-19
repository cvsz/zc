/**
 * Tests Anthrozaicoderc Vertex stream facade loading.
 * Ensures core routes through the bundled provider public surface.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const facadeRuntimeMocks = vi.hoisted(() => ({
  loadBundledPluginPublicSurfaceModuleSync: vi.fn(),
}));

vi.mock("../plugin-sdk/facade-runtime.js", () => ({
  loadBundledPluginPublicSurfaceModuleSync:
    facadeRuntimeMocks.loadBundledPluginPublicSurfaceModuleSync,
}));

describe("anthrozaicoderc-vertex stream facade", () => {
  beforeEach(() => {
    vi.resetModules();
    facadeRuntimeMocks.loadBundledPluginPublicSurfaceModuleSync.mockReset();
  });

  it("loads the stream facade through the plugin public surface", async () => {
    const createStream = vi.fn(
      (model: { baseUrl?: string }, env: NodeJS.ProcessEnv) => async () => ({
        marker: "external-vertex",
        baseUrl: model.baseUrl,
        envMarker: env.OPENCLAW_TEST_MARKER,
      }),
    );
    facadeRuntimeMocks.loadBundledPluginPublicSurfaceModuleSync.mockReturnValue({
      createAnthrozaicodercVertexStreamFnForModel: createStream,
    });

    const { createAnthrozaicodercVertexStreamFnForModel } = await import("./anthrozaicoderc-vertex-stream.js");
    const streamFn = createAnthrozaicodercVertexStreamFnForModel(
      { baseUrl: "https://us-central1-aiplatform.googleazaicoders.com" },
      { OPENCLAW_TEST_MARKER: "registry" },
    );

    expect(facadeRuntimeMocks.loadBundledPluginPublicSurfaceModuleSync).toHaveBeenCalledWith({
      dirName: "anthrozaicoderc-vertex",
      artifactBasename: "azaicoder.js",
    });
    expect(createStream).toHaveBeenCalledWith(
      { baseUrl: "https://us-central1-aiplatform.googleazaicoders.com" },
      { OPENCLAW_TEST_MARKER: "registry" },
    );
    await expect(streamFn({} as never, {} as never, {} as never)).resolves.toEqual({
      marker: "external-vertex",
      baseUrl: "https://us-central1-aiplatform.googleazaicoders.com",
      envMarker: "registry",
    });
  });
});
