import type { OrCodeConfig } from "../config.js";
import type { ModelRegistry } from "../openrouter/model-registry.js";
import type { SessionStore } from "../session/session-store.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import type { SkillManifest } from "../skills/skill-types.js";
import { AgentRunner } from "../runtime/agent-runner.js";
import type { AgentEvent } from "../runtime/agent-events.js";
import { OrCodeError } from "../types.js";
import type { AgentRegistry } from "./agent-registry.js";
import { specAdHoc, specFromManifest } from "./agent-spec.js";
import {
  MAX_AGENT_DEPTH,
  type AgentRunResultSummary,
  type AgentSpawnRequest,
  type AgentSpec
} from "./agent-types.js";

export type SubAgentDeps = {
  parentSessionId: string;
  parentChain: string[];
  parentDepth: number;
  parentConfig: OrCodeConfig;
  parentModel: string;
  parentSkillNames: string[];
  agentRegistry: AgentRegistry;
  skillRegistry?: SkillRegistry;
  modelRegistry?: ModelRegistry;
  sessionStore: SessionStore;
  availableSkills?: SkillManifest[];
  onSubAgentEvent?: (sub: { agentName: string; depth: number; chain: string[] }, event: AgentEvent) => Promise<void> | void;
};

export class SubAgentRunner {
  constructor(private deps: SubAgentDeps) {}

  async spawn(request: AgentSpawnRequest): Promise<AgentRunResultSummary> {
    const depth = this.deps.parentDepth + 1;
    if (depth > MAX_AGENT_DEPTH) {
      throw new OrCodeError(
        "agent.depth_exceeded",
        `Sub-agent depth ${depth} exceeds limit ${MAX_AGENT_DEPTH}. Chain: ${this.deps.parentChain.join(" → ")}.`
      );
    }

    const spec = await this.resolveSpec(request);

    if (this.deps.parentChain.includes(spec.name)) {
      throw new OrCodeError(
        "agent.cycle",
        `Agent "${spec.name}" already in invocation chain ${this.deps.parentChain.join(" → ")}.`
      );
    }

    const childChain = [...this.deps.parentChain, spec.name];
    const childSessionId = `${this.deps.parentSessionId}-sub-${depth}-${slugify(spec.name)}-${Date.now().toString(36)}`;

    await this.deps.sessionStore.append(this.deps.parentSessionId, "agent.spawn", {
      childSessionId,
      agentName: spec.name,
      source: spec.source,
      model: spec.model,
      depth,
      chain: childChain
    });

    const subConfig: OrCodeConfig = {
      ...this.deps.parentConfig,
      defaultModel: spec.model,
      ...(spec.maxSteps !== undefined ? { maxSteps: spec.maxSteps } : {}),
      ...(spec.maxCostUsd !== undefined ? { maxCostUsd: spec.maxCostUsd } : {})
    };

    const skillBodies = await Promise.all(
      spec.skills.map((name) =>
        this.deps.skillRegistry?.load(name).catch(() => undefined)
      )
    );
    const activeSkills = skillBodies.filter((skill): skill is NonNullable<typeof skill> => skill !== undefined);

    const modelCapability = this.deps.modelRegistry
      ? await this.deps.modelRegistry
          .findById(spec.model, this.deps.parentConfig.apiKey ? { apiKey: this.deps.parentConfig.apiKey } : {})
          .catch(() => undefined)
      : undefined;

    const stats = { calls: 0, results: 0, writes: 0, edits: 0, shells: 0 };
    let steps = 0;
    const startedAt = Date.now();

    const subRunner = new AgentRunner();

    const childSpawn = async (childRequest: AgentSpawnRequest): Promise<AgentRunResultSummary> => {
      const childSubRunner = new SubAgentRunner({
        ...this.deps,
        parentChain: childChain,
        parentDepth: depth,
        parentSessionId: childSessionId,
        parentConfig: subConfig,
        parentModel: spec.model,
        parentSkillNames: spec.skills
      });
      return childSubRunner.spawn(childRequest);
    };

    const result = await subRunner.runStreaming(request.prompt, {
      config: subConfig,
      sessionStore: this.deps.sessionStore,
      sessionId: childSessionId,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(this.deps.availableSkills ? { availableSkills: this.deps.availableSkills } : {}),
      ...(this.deps.skillRegistry ? { skillRegistry: this.deps.skillRegistry } : {}),
      agentRegistry: this.deps.agentRegistry,
      spawnAgent: childSpawn,
      ...(modelCapability ? { modelCapability } : {}),
      instructionsOverride: buildSubAgentSystemPrompt(spec, childChain, depth),
      ...(spec.tools !== "all" ? { toolFilter: spec.tools } : {}),
      onEvent: async (event) => {
        if (event.type === "tool.call") {
          stats.calls += 1;
        } else if (event.type === "tool.result") {
          stats.results += 1;
        } else if (event.type === "turn.completed") {
          steps += 1;
        }
        if (event.type === "tool.result") {
          if (event.tool === "Write") stats.writes += 1;
          else if (event.tool === "Edit") stats.edits += 1;
          else if (event.tool === "Shell") stats.shells += 1;
        }
        await this.deps.onSubAgentEvent?.({ agentName: spec.name, depth, chain: childChain }, event);
      }
    });

    const durationMs = Date.now() - startedAt;
    const summary: AgentRunResultSummary = {
      text: result.text,
      cost: result.cost,
      durationMs,
      toolStats: stats,
      modelUsed: spec.model,
      agentName: spec.name,
      steps
    };

    await this.deps.sessionStore.append(this.deps.parentSessionId, "agent.completed", {
      childSessionId,
      agentName: spec.name,
      durationMs,
      steps,
      cost: result.cost,
      stats
    });

    return summary;
  }

  private async resolveSpec(request: AgentSpawnRequest): Promise<AgentSpec> {
    if (request.name) {
      const manifest = this.deps.agentRegistry.get(request.name);
      if (!manifest) {
        throw new OrCodeError("agent.not_found", `Agent "${request.name}" non trovato nel registry.`);
      }
      const spec = specFromManifest(manifest, this.deps.parentModel);
      return applyRequestOverrides(spec, request);
    }
    if (!request.role) {
      throw new OrCodeError("agent.invalid_request", "Spawn request requires either `name` or `role`.");
    }
    const spec = specAdHoc({
      role: request.role,
      parentModel: this.deps.parentModel,
      parentSkills: this.deps.parentSkillNames,
      ...(request.tools !== undefined ? { tools: request.tools } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(request.maxSteps !== undefined ? { maxSteps: request.maxSteps } : {}),
      ...(request.maxCostUsd !== undefined ? { maxCostUsd: request.maxCostUsd } : {})
    });
    return applyRequestOverrides(spec, request);
  }
}

function applyRequestOverrides(spec: AgentSpec, request: AgentSpawnRequest): AgentSpec {
  const next: AgentSpec = { ...spec };
  if (request.tools !== undefined) {
    next.tools = request.tools;
  }
  if (request.model !== undefined && request.model.length > 0) {
    next.model = request.model;
  }
  if (request.maxSteps !== undefined) {
    next.maxSteps = request.maxSteps;
  }
  if (request.maxCostUsd !== undefined) {
    next.maxCostUsd = request.maxCostUsd;
  }
  if (request.isolation !== undefined) {
    next.isolation = request.isolation;
  }
  return next;
}

function buildSubAgentSystemPrompt(spec: AgentSpec, chain: string[], depth: number): string {
  const header = [
    `You are the "${spec.name}" agent (${spec.source}). Depth ${depth}/${MAX_AGENT_DEPTH}.`,
    `Invocation chain: ${chain.join(" → ")}.`,
    `Description: ${spec.description}`,
    spec.whenToUse ? `When to use: ${spec.whenToUse}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const operational = [
    "Operational rules (binding):",
    "- Stay focused on the requested subtask. Do NOT broaden scope.",
    "- Use only the tools available to this run. If a needed tool is missing, return a clear note.",
    "- Return a final concise summary suitable for the parent agent to consume.",
    "- Do not call the `Agent` tool unless the subtask explicitly requires further delegation; depth is limited.",
    "- When done, stop calling tools and emit the final summary as plain text."
  ].join("\n");

  return [header, operational, spec.systemPrompt.trim()].filter(Boolean).join("\n\n");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "agent";
}
