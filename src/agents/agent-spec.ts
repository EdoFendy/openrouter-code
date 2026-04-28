import type { AgentManifest, AgentSpec } from "./agent-types.js";

export type AdHocAgentArgs = {
  role: string;
  parentModel: string;
  parentSkills?: string[];
  tools?: string[] | "all";
  model?: string;
  maxSteps?: number;
  maxCostUsd?: number;
};

export function specFromManifest(manifest: AgentManifest, parentModel: string): AgentSpec {
  const model = manifest.model && manifest.model.length > 0 ? manifest.model : parentModel;
  const tools = Array.isArray(manifest.tools) ? manifest.tools : manifest.tools === "all" ? "all" : "all";
  const skills = manifest.skills ?? [];
  const isolation = manifest.isolation ?? "shared";

  const baseSystemPrompt = manifest.body && manifest.body.trim().length > 0
    ? manifest.body.trim()
    : `You are the ${manifest.name} agent. ${manifest.description}`;

  const spec: AgentSpec = {
    source: "manifest",
    name: manifest.name,
    description: manifest.description,
    model,
    tools,
    skills,
    systemPrompt: baseSystemPrompt,
    isolation
  };
  if (manifest.whenToUse !== undefined) {
    spec.whenToUse = manifest.whenToUse;
  }
  if (manifest.maxSteps !== undefined) {
    spec.maxSteps = manifest.maxSteps;
  }
  if (manifest.maxCostUsd !== undefined) {
    spec.maxCostUsd = manifest.maxCostUsd;
  }
  return spec;
}

export function specAdHoc(args: AdHocAgentArgs): AgentSpec {
  const role = args.role.trim();
  const slug = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const name = slug ? `ad-hoc:${slug}` : `ad-hoc:agent`;

  const systemPrompt = [
    `You are an ad-hoc specialist agent invoked by a parent orchestrator agent.`,
    `Role: ${role}`,
    `Focus on the specific task described in the user message. Stay strictly inside this scope.`,
    `Return concise, structured output that the parent can use directly. No marketing prose.`,
    `When the task is done, stop calling tools and provide a final summary.`
  ].join("\n");

  const spec: AgentSpec = {
    source: "ad-hoc",
    name,
    description: role,
    model: args.model && args.model.length > 0 ? args.model : args.parentModel,
    tools: args.tools ?? "all",
    skills: args.parentSkills ?? [],
    systemPrompt
  ,
    isolation: "shared"
  };
  if (args.maxSteps !== undefined) {
    spec.maxSteps = args.maxSteps;
  }
  if (args.maxCostUsd !== undefined) {
    spec.maxCostUsd = args.maxCostUsd;
  }
  return spec;
}
