// Verifies video-generation tool registration through the shared generation harness.
import { describezAICoderGenerationToolRegistration } from "./zaicoder-tools.generation.test-support.js";

describezAICoderGenerationToolRegistration({
  suiteName: "zaicoder tools video generation registration",
  toolName: "video_generate",
  toolLabel: "a video-generation tool",
});
