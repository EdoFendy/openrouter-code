import { describe, expect, it } from "vitest";
import { toCapability, type OpenRouterModel } from "../src/openrouter/model-registry.js";

describe("model registry", () => {
  it("derives capability booleans from OpenRouter metadata", () => {
    const model: OpenRouterModel = {
      id: "vendor/model",
      name: "Vendor Model",
      context_length: 128000,
      architecture: {
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text"],
        tokenizer: "test",
        instruct_type: null
      },
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        request: "0",
        image: "0",
        web_search: "0",
        internal_reasoning: "0.000003",
        input_cache_read: "0",
        input_cache_write: "0"
      },
      supported_parameters: ["tools", "tool_choice", "reasoning", "include_reasoning", "structured_outputs", "response_format"]
    };

    const capability = toCapability(model);
    expect(capability.supportsTools).toBe(true);
    expect(capability.supportsToolChoice).toBe(true);
    expect(capability.supportsReasoning).toBe(true);
    expect(capability.supportsStructuredOutputs).toBe(true);
    expect(capability.supportsInputImage).toBe(true);
    expect(capability.supportsInputFile).toBe(true);
    expect(capability.promptPrice).toBe(0.000001);
  });
});
