import { describe, expect, it } from "vitest";
import { buildModelProfile, mergeMaxSteps } from "../src/runtime/model-profile.js";
import type { ModelCapability } from "../src/openrouter/model-registry.js";

function fakeCap(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    id: "test/model",
    name: "Test Model",
    description: "",
    contextLength: 32_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsTools: true,
    supportsToolChoice: true,
    supportsReasoning: false,
    supportsIncludeReasoning: false,
    supportsStructuredOutputs: false,
    supportsResponseFormat: false,
    supportsInputImage: false,
    supportsInputFile: false,
    supportsInputAudio: false,
    supportsOutputImage: false,
    supportsOutputAudio: false,
    promptPrice: 0.000002,
    completionPrice: 0.000004,
    requestPrice: 0,
    imagePrice: 0,
    reasoningPrice: 0,
    raw: {} as ModelCapability["raw"],
    ...overrides
  };
}

describe("model profile", () => {
  it("scales maxSteps with context length", () => {
    const small = buildModelProfile(fakeCap({ contextLength: 8_000 }), "small");
    const large = buildModelProfile(fakeCap({ contextLength: 200_000 }), "large");
    expect(small.maxStepsRecommended).toBeLessThan(large.maxStepsRecommended);
    expect(small.maxStepsRecommended).toBe(8);
    expect(large.maxStepsRecommended).toBe(45);
  });

  it("derives toolset tier from context", () => {
    expect(buildModelProfile(fakeCap({ contextLength: 8_000 }), "x").toolsetTier).toBe("minimal");
    expect(buildModelProfile(fakeCap({ contextLength: 32_000 }), "x").toolsetTier).toBe("standard");
    expect(buildModelProfile(fakeCap({ contextLength: 128_000 }), "x").toolsetTier).toBe("extended");
  });

  it("enables reasoning params only when supported", () => {
    const noReasoning = buildModelProfile(fakeCap({ supportsReasoning: false }), "x");
    const withReasoning = buildModelProfile(fakeCap({ supportsReasoning: true }), "x");
    expect(noReasoning.reasoningParams).toBeUndefined();
    expect(withReasoning.reasoningParams).toEqual({ effort: "medium" });
  });

  it("derives schema style from structured outputs support", () => {
    expect(buildModelProfile(fakeCap({ supportsStructuredOutputs: true }), "x").schemaStyle).toBe("strict");
    expect(buildModelProfile(fakeCap({ supportsStructuredOutputs: false }), "x").schemaStyle).toBe("permissive");
  });

  it("computes pricing tier", () => {
    expect(buildModelProfile(fakeCap({ promptPrice: 0 }), "x").pricingTier).toBe("free");
    expect(buildModelProfile(fakeCap({ promptPrice: 0.0000001 }), "x").pricingTier).toBe("cheap");
    expect(buildModelProfile(fakeCap({ promptPrice: 0.000003 }), "x").pricingTier).toBe("standard");
    expect(buildModelProfile(fakeCap({ promptPrice: 0.00002 }), "x").pricingTier).toBe("premium");
  });

  it("falls back to defaults when capability missing", () => {
    const profile = buildModelProfile(undefined, "unknown/model");
    expect(profile.contextLength).toBe(32_000);
    expect(profile.supportsTools).toBe(true);
    expect(profile.toolsetTier).toBe("standard");
  });

  it("merges max steps to the smaller of profile and config", () => {
    expect(mergeMaxSteps(20, 50)).toBe(20);
    expect(mergeMaxSteps(45, 8)).toBe(8);
    expect(mergeMaxSteps(0, 5)).toBe(1);
  });
});
