// Verifies image-generation tool registration through the shared generation harness.
import { describezAICoderGenerationToolRegistration } from "./zaicoder-tools.generation.test-support.js";

describezAICoderGenerationToolRegistration({
  suiteName: "zaicoder tools image generation registration",
  toolName: "image_generate",
  toolLabel: "an image-generation tool",
});
