import type { ModelCapability } from "../openrouter/model-registry.js";

export type SchemaStyle = "strict" | "permissive";
export type ReasoningEffort = "low" | "medium" | "high";

export type ModelProfile = {
  modelId: string;
  contextLength: number;
  contextSafeBudgetChars: number;
  contextHardBudgetChars: number;
  maxStepsRecommended: number;
  reasoningParams: { effort: ReasoningEffort } | undefined;
  schemaStyle: SchemaStyle;
  systemPromptBudgetChars: number;
  supportsTools: boolean;
  supportsStructured: boolean;
  toolsetTier: "minimal" | "standard" | "extended";
  pricingTier: "free" | "cheap" | "standard" | "premium";
};

const DEFAULT_CONTEXT_LENGTH = 32_000;
const DEFAULT_TOKENS_PER_CHAR = 0.25;

export function approxCharsForTokens(tokens: number): number {
  return Math.floor(tokens / DEFAULT_TOKENS_PER_CHAR);
}

export function approxTokensForChars(chars: number): number {
  return Math.ceil(chars * DEFAULT_TOKENS_PER_CHAR);
}

export function buildModelProfile(capability: ModelCapability | undefined, modelId: string): ModelProfile {
  const ctxTokens = capability?.contextLength && capability.contextLength > 0 ? capability.contextLength : DEFAULT_CONTEXT_LENGTH;
  const ctxChars = approxCharsForTokens(ctxTokens);

  const safeRatio = 0.7;
  const hardRatio = 0.9;

  const supportsTools = capability ? capability.supportsTools : true;
  const supportsStructured = capability ? capability.supportsStructuredOutputs : false;

  const reasoningParams = capability && (capability.supportsReasoning || capability.supportsIncludeReasoning)
    ? { effort: ("medium" as const) }
    : undefined;

  const pricingTier = derivePricingTier(capability);

  // Scale max steps with context: very small → fewer steps to avoid overflow
  // 8k → 8, 16k → 12, 32k → 20, 64k → 28, 128k → 36, 200k+ → 45
  let maxStepsRecommended: number;
  if (ctxTokens < 12_000) {
    maxStepsRecommended = 8;
  } else if (ctxTokens < 24_000) {
    maxStepsRecommended = 12;
  } else if (ctxTokens < 48_000) {
    maxStepsRecommended = 20;
  } else if (ctxTokens < 96_000) {
    maxStepsRecommended = 28;
  } else if (ctxTokens < 160_000) {
    maxStepsRecommended = 36;
  } else {
    maxStepsRecommended = 45;
  }

  // System prompt budget: smaller of (15% of context) or 12k chars
  const systemPromptBudgetChars = Math.min(Math.floor(ctxChars * 0.15), 12_000);

  // Toolset tier: which tools to expose
  // - minimal: Read/Write/Edit/Shell only (smallest schema)
  // - standard: + Grep/Glob/ListDir/Todos
  // - extended: + Skill
  let toolsetTier: ModelProfile["toolsetTier"];
  if (ctxTokens < 12_000) {
    toolsetTier = "minimal";
  } else if (ctxTokens < 64_000) {
    toolsetTier = "standard";
  } else {
    toolsetTier = "extended";
  }

  // Schema style: strict if model declares structured outputs support, else permissive
  const schemaStyle: SchemaStyle = supportsStructured ? "strict" : "permissive";

  return {
    modelId,
    contextLength: ctxTokens,
    contextSafeBudgetChars: Math.floor(ctxChars * safeRatio),
    contextHardBudgetChars: Math.floor(ctxChars * hardRatio),
    maxStepsRecommended,
    reasoningParams,
    schemaStyle,
    systemPromptBudgetChars,
    supportsTools,
    supportsStructured,
    toolsetTier,
    pricingTier
  };
}

function derivePricingTier(capability: ModelCapability | undefined): ModelProfile["pricingTier"] {
  if (!capability) {
    return "standard";
  }
  const promptPerMTok = capability.promptPrice * 1_000_000;
  if (promptPerMTok <= 0) {
    return "free";
  }
  if (promptPerMTok < 0.5) {
    return "cheap";
  }
  if (promptPerMTok < 5) {
    return "standard";
  }
  return "premium";
}

export function mergeMaxSteps(profileSteps: number, configSteps: number): number {
  // Use the smaller of profile recommendation and explicit config — never exceed model context.
  return Math.max(1, Math.min(profileSteps, configSteps));
}
