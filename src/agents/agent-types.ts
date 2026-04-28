import { z } from "zod";

export const AgentManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().optional(),
  tools: z
    .array(z.string())
    .or(z.literal("all"))
    .optional(),
  skills: z.array(z.string()).optional(),
  whenToUse: z.string().optional(),
  maxSteps: z.number().int().positive().max(50).optional(),
  maxCostUsd: z.number().positive().optional(),
  isolation: z.enum(["shared", "worktree"]).optional(),
  agentPath: z.string(),
  body: z.string()
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export type AgentSpecSource = "manifest" | "ad-hoc";

export type AgentSpec = {
  source: AgentSpecSource;
  name: string;
  description: string;
  model: string;
  tools: string[] | "all";
  skills: string[];
  systemPrompt: string;
  whenToUse?: string;
  maxSteps?: number;
  maxCostUsd?: number;
  isolation: "shared" | "worktree";
};

export type AgentInvocation = {
  spec: AgentSpec;
  prompt: string;
  depth: number;
  parentChain: string[];
};

export type AgentRunResultSummary = {
  text: string;
  cost: { inputTokens: number; outputTokens: number; estimatedUsd: number };
  durationMs: number;
  toolStats: { calls: number; results: number; writes: number; edits: number; shells: number };
  modelUsed: string;
  agentName: string;
  steps: number;
  reachedMaxDepth?: boolean;
  truncated?: boolean;
};

export const MAX_AGENT_DEPTH = 3;

export type AgentSpawnRequest = {
  name?: string;
  role?: string;
  prompt: string;
  tools?: string[] | "all";
  model?: string;
  maxSteps?: number;
  maxCostUsd?: number;
  isolation?: "shared" | "worktree";
};

export type SpawnAgentFn = (request: AgentSpawnRequest) => Promise<AgentRunResultSummary>;

