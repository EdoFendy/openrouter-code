import type { SkillRegistry } from "./skill-registry.js";
import type { LoadedSkill, SkillManifest } from "./skill-types.js";

export type SkillActivation = {
  manifest: SkillManifest;
  score: number;
  reasons: string[];
};

const STRONG_UI_TERMS = [
  "ui",
  "ux",
  "design",
  "frontend",
  "tui",
  "layout",
  "interaction",
  "accessibility",
  "palette",
  "typography",
  "component",
  "dashboard",
  "premium",
  "mobile",
  "responsive",
  "slide",
  "slides",
  "brand"
];

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9:+-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreSkill(prompt: string, skill: SkillManifest): SkillActivation {
  const promptTokens = new Set(tokenize(prompt));
  const haystack = `${skill.name} ${skill.description} ${skill.whenToUse}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (prompt.toLowerCase().includes(skill.name.toLowerCase())) {
    score += 20;
    reasons.push("name mentioned");
  }

  for (const token of promptTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 5 ? 2 : 1;
    }
  }

  for (const term of STRONG_UI_TERMS) {
    if (promptTokens.has(term) && haystack.includes(term)) {
      score += 5;
      reasons.push(term);
    }
  }

  if (score > 0 && reasons.length === 0) {
    reasons.push("metadata match");
  }

  return { manifest: skill, score, reasons };
}

export async function activateSkillsForPrompt(
  prompt: string,
  registry: SkillRegistry,
  options: { limit?: number; minScore?: number } = {}
): Promise<{ activeSkills: LoadedSkill[]; activations: SkillActivation[] }> {
  const limit = options.limit ?? 2;
  const minScore = options.minScore ?? 4;
  const manifests = await registry.scan();
  const activations = manifests
    .map((manifest) => scoreSkill(prompt, manifest))
    .filter((activation) => activation.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const activeSkills = await Promise.all(activations.map((activation) => registry.load(activation.manifest.name)));
  return { activeSkills, activations };
}
