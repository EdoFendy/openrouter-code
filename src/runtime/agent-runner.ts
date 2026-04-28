import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { OpenRouter, stepCountIs, maxCost } from "@openrouter/agent";
import type { NewUserMessageItem, Tool } from "@openrouter/agent";
import { permissionsForMode, type OrCodeConfig } from "../config.js";
import type { ModelCapability } from "../openrouter/model-registry.js";
import { PermissionEngine } from "../permissions/engine.js";
import type { SessionStore } from "../session/session-store.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import type { SpawnAgentFn } from "../agents/agent-types.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import type { LoadedSkill, SkillManifest } from "../skills/skill-types.js";
import { createLocalTools, type ToolAuditEvent } from "../tools/local-tools.js";
import { OrCodeError, readableError, type CostSnapshot } from "../types.js";
import type { AgentEvent } from "./agent-events.js";
import { HookRunner, type HookRunResult } from "./hooks.js";
import { LoopDetector } from "./loop-detector.js";
import { loadMemoryFiles, renderMentionedFiles, renderMemory, resolveFileMentions } from "./memory.js";
import { buildModelProfile, mergeMaxSteps } from "./model-profile.js";
import { classifyError, shouldRetry, sleep } from "./retry-policy.js";
import { buildWorkspaceSnapshot, renderWorkspaceSnapshot, shouldAutoExplore } from "./workspace-snapshot.js";

export type AgentRunnerOptions = {
  config: OrCodeConfig;
  sessionStore: SessionStore;
  sessionId: string;
  activeSkills?: LoadedSkill[];
  availableSkills?: SkillManifest[];
  modelCapability?: ModelCapability;
  skillRegistry?: SkillRegistry;
  agentRegistry?: AgentRegistry;
  parentInvocationContext?: ParentInvocationContext;
  instructionsOverride?: string;
  toolFilter?: string[];
  spawnAgent?: SpawnAgentFn;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
};

export type ParentInvocationContext = {
  depth: number;
  chain: string[];
};

export type AgentRunResult = {
  text: string;
  cost: CostSnapshot;
  requiresApproval: boolean;
  pendingToolCalls: Array<{ id: string; name: string; arguments: unknown }>;
};

function buildInstructions(options: AgentRunnerOptions): string {
  if (options.instructionsOverride && options.instructionsOverride.trim().length > 0) {
    const activeSkillsBlock = (options.activeSkills ?? []).length > 0
      ? (options.activeSkills ?? [])
          .map((skill) => `### Skill: ${skill.name}\n${skill.body}`)
          .join("\n\n")
      : "";
    return [
      options.instructionsOverride.trim(),
      activeSkillsBlock ? `## Active skills — instructions in force\n\n${activeSkillsBlock}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const skillsBlock = (options.availableSkills ?? []).length > 0
    ? (options.availableSkills ?? [])
        .map((skill) => `- ${skill.name} — ${skill.description}\n  whenToUse: ${skill.whenToUse}`)
        .join("\n")
    : "";

  const activeSkillsBlock = (options.activeSkills ?? []).length > 0
    ? (options.activeSkills ?? [])
        .map((skill) => `### Skill: ${skill.name}\n${skill.body}`)
        .join("\n\n")
    : "";

  const isBypass = options.config.permissionMode === "bypass";
  const isPlan = options.config.permissionMode === "plan";

  const permissionInstruction = isBypass
    ? "Permission mode: bypass. All Read/ListDir/Grep/Glob/Write/Edit/Shell calls inside the workspace are pre-approved. Always call Write/Edit/Shell with apply=true so the change actually happens. Do NOT stage with apply=false in bypass mode."
    : isPlan
      ? "Permission mode: plan. Read-only. Do not attempt Write/Edit/Shell; produce a plan and stop."
      : `Permission mode: ${options.config.permissionMode}. For Write/Edit/Shell call once with apply=false to preview, then again with apply=true after user approval (or when project policy allows).`;

  return [
    "You are or-code, a local OpenRouter-native coding agent.",
    "Default reply style: terse, operational, no marketing language, no emoji.",

    "OPERATIONAL RULES — read carefully, this is binding:",
    "1. If the user asks to CREATE / BUILD / IMPLEMENT / SCAFFOLD / MAKE files, directories, projects, websites, components, or features — you MUST use Write, Edit, or Shell tools to perform the work. A prose-only response is wrong. Do not 'describe' the project — build it.",
    "2. For complex tasks (≥3 files or ≥3 distinct steps): start with a brief PIANO paragraph (numbered fasi F1, F2, … with one-line goals), then immediately call the `Todos` tool with the same task list. Begin tool work right after.",
    "3. Use the `Todos` tool to publish and update progress. Mark a task `in_progress` BEFORE starting it; mark it `completed` IMMEDIATELY after the last tool result for that task. Replace the full list each call. Keep at most one task `in_progress`.",
    "4. Do NOT pause between tool calls to write descriptive prose, narrate progress, or summarize what you are about to do. Sequence tool calls back-to-back. Save the summary for after the last tool call.",
    "5. Multi-file projects: emit one Write call per file, sequentially, with no prose between calls. After each Write, immediately move to the next file.",
    "6. Never claim a file changed unless a tool.result confirmed it. Never invent paths, directories, frontend apps, or features absent from workspace context or tool results.",
    "7. For inspection-first requests (codebase analysis, refactor planning), read with Read/ListDir/Grep/Glob first, name the real files you inspected, then propose changes.",
    "8. If the request is a question, explanation, or plan-without-execution, prose is fine and tools are optional.",

    "SKILLS — on-demand activation:",
    "Skills are NOT pre-loaded. You decide whether any skill applies. Read the skills metadata below at the start of every task; if a skill's `whenToUse` clearly matches the user request, call the `Skill` tool with that skill's name to load its instructions, then follow them. Do not activate skills speculatively or for unrelated tasks. Activating zero skills is normal. After activation, the skill body becomes part of your guidance for the rest of this run.",

    permissionInstruction,

    options.modelCapability
      ? `Model capabilities: tools=${options.modelCapability.supportsTools}, context=${options.modelCapability.contextLength}, structured=${options.modelCapability.supportsStructuredOutputs}, reasoning=${options.modelCapability.supportsReasoning || options.modelCapability.supportsIncludeReasoning}.${options.modelCapability.supportsTools ? "" : " WARNING: this model has no tool support — file creation will fail."}`
      : "",

    skillsBlock ? `Available skills (call \`Skill\` to activate one):\n${skillsBlock}` : "",

    activeSkillsBlock ? `## Active skills — instructions in force for this run\n\n${activeSkillsBlock}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function usageToCost(usage: unknown): CostSnapshot {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };
  }

  const record = usage as Record<string, unknown>;
  return {
    inputTokens: typeof record.inputTokens === "number" ? record.inputTokens : 0,
    outputTokens: typeof record.outputTokens === "number" ? record.outputTokens : 0,
    estimatedUsd: typeof record.cost === "number" ? record.cost : 0
  };
}

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractErrorDetail(event: Record<string, unknown>): string {
  const parts: string[] = [];
  const message = stringField(event, "message");
  if (message) {
    parts.push(message);
  }

  const error = event.error;
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    const code = errorRecord.code !== undefined ? String(errorRecord.code) : undefined;
    const innerMessage = typeof errorRecord.message === "string" ? errorRecord.message : undefined;
    const status = typeof errorRecord.status === "number" ? errorRecord.status : numberField(errorRecord, "statusCode");
    const providerName = typeof errorRecord.provider === "string" ? errorRecord.provider : undefined;
    const meta: string[] = [];
    if (status !== undefined) {
      meta.push(`status=${status}`);
    }
    if (code) {
      meta.push(`code=${code}`);
    }
    if (providerName) {
      meta.push(`provider=${providerName}`);
    }
    if (innerMessage && innerMessage !== message) {
      parts.push(innerMessage);
    }
    if (meta.length > 0) {
      parts.push(`[${meta.join(" · ")}]`);
    }
    const metadata = errorRecord.metadata;
    if (metadata && typeof metadata === "object") {
      const metaJson = safeJson(metadata);
      if (metaJson && metaJson !== "{}") {
        parts.push(`metadata=${metaJson.slice(0, 400)}`);
      }
    }
  }

  const code = stringField(event, "code");
  if (code && !parts.some((part) => part.includes(code))) {
    parts.push(`code=${code}`);
  }

  if (parts.length === 0) {
    return safeJson(event).slice(0, 600);
  }
  return parts.join(" · ");
}

function toAgentToolEvent(event: ToolAuditEvent): AgentEvent {
  return {
    type: event.type,
    tool: event.tool,
    payload: event.payload,
    createdAt: now()
  };
}

async function emit(options: AgentRunnerOptions, event: AgentEvent): Promise<void> {
  await options.onEvent?.(event);
}

function hookPayload(result: HookRunResult): Record<string, string | number | null> {
  return {
    event: result.event,
    command: result.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function createHookRunner(options: AgentRunnerOptions, workspaceRoot: string): HookRunner {
  return new HookRunner({
    config: options.config.hooks,
    workspaceRoot,
    sessionId: options.sessionId,
    audit: async (result) => {
      await options.sessionStore.append(options.sessionId, "hook.result", hookPayload(result));
    }
  });
}

async function runStopHook(hookRunner: HookRunner, payload: Record<string, string | number | boolean | null>, priorError?: unknown): Promise<void> {
  try {
    await hookRunner.run("Stop", payload);
  } catch (hookError) {
    if (!priorError) {
      throw hookError;
    }
  }
}

async function buildPromptContext(
  input: string,
  workspaceRoot: string,
  options: AgentRunnerOptions,
  emitWorkspaceEvents: boolean
): Promise<{ enrichedInput: string; mentionedFilePaths: string[] }> {
  const [memoryFiles, mentionedFiles] = await Promise.all([
    loadMemoryFiles(workspaceRoot),
    resolveFileMentions(input, workspaceRoot)
  ]);
  const memoryContext = renderMemory(memoryFiles);
  const mentionContext = renderMentionedFiles(mentionedFiles);

  let workspaceContext = "";
  if (shouldAutoExplore(input)) {
    if (emitWorkspaceEvents) {
      await emit(options, { type: "workspace.explore.started", reason: "project context requested", createdAt: now() });
    }

    const snapshot = await buildWorkspaceSnapshot(workspaceRoot);
    workspaceContext = renderWorkspaceSnapshot(snapshot);

    if (emitWorkspaceEvents) {
      await emit(options, {
        type: "workspace.explore.completed",
        files: snapshot.files.length,
        excerpts: snapshot.excerpts.length,
        createdAt: now()
      });
    }
  }

  return {
    enrichedInput: [
      input,
      memoryContext ? `\n\n<or-code-memory>\n${memoryContext}\n</or-code-memory>` : "",
      mentionContext ? `\n\n<mentioned-files>\n${mentionContext}\n</mentioned-files>` : "",
      workspaceContext ? `\n\n<workspace-auto-explore>\n${workspaceContext}\n</workspace-auto-explore>` : ""
    ].join(""),
    mentionedFilePaths: mentionedFiles.map((file) => file.path)
  };
}

type ActiveResult = { cancel(): Promise<void> };

export class CancelledError extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "CancelledError";
  }
}

export class AgentRunner {
  private active: ActiveResult | undefined;
  private cancelled = false;

  async cancel(): Promise<void> {
    const target = this.active;
    if (!target) {
      return;
    }
    this.cancelled = true;
    try {
      await target.cancel();
    } catch {
      /* swallow: cancellation should not throw upstream */
    } finally {
      this.active = undefined;
    }
  }

  isRunning(): boolean {
    return this.active !== undefined;
  }

  wasCancelled(): boolean {
    return this.cancelled;
  }

  async run(input: string, options: AgentRunnerOptions): Promise<AgentRunResult> {
    if (!options.config.apiKey) {
      throw new OrCodeError("config.missing_api_key", "OPENROUTER_API_KEY mancante. Esporta la variabile o aggiungila a ~/.orcode/config.json.");
    }

    const workspaceRoot = options.config.workspaceRoot ?? process.cwd();
    const hookRunner = createHookRunner(options, workspaceRoot);
    await hookRunner.run("SessionStart", {
      model: options.config.defaultModel,
      permissionMode: options.config.permissionMode
    });
    await hookRunner.run("UserPromptSubmit", {
      prompt: input,
      model: options.config.defaultModel,
      permissionMode: options.config.permissionMode
    });

    const permissions = permissionsForMode(options.config);
    const permissionEngine = new PermissionEngine(permissions.defaultMode, permissions.rules);
    const tools = createLocalTools({
      workspaceRoot,
      permissionEngine,
      hookRunner,
      ...(options.skillRegistry ? { skillRegistry: options.skillRegistry } : {}),
      audit: async (event) => {
        await options.sessionStore.append(options.sessionId, event.type, {
          tool: event.tool,
          ...event.payload
        });
      }
    });

    const { enrichedInput, mentionedFilePaths } = await buildPromptContext(input, workspaceRoot, options, false);

    await options.sessionStore.append(options.sessionId, "user.message", { text: input, mentionedFiles: mentionedFilePaths });

    const client = new OpenRouter({ apiKey: options.config.apiKey });
    const stopWhen = options.config.maxCostUsd
      ? [stepCountIs(options.config.maxSteps), maxCost(options.config.maxCostUsd)]
      : [stepCountIs(options.config.maxSteps)];

    const result = client.callModel({
      model: options.config.defaultModel,
      input: [{ role: "user", content: enrichedInput }] satisfies NewUserMessageItem[],
      instructions: buildInstructions(options),
      tools: tools as readonly Tool[],
      state: options.sessionStore.stateAccessor<typeof tools>(options.sessionId),
      stopWhen
    });
    this.active = result;

    try {
      const text = await result.getText();
      const response = await result.getResponse();
      const cost = usageToCost(response.usage);
      const requiresApproval = await result.requiresApproval();
      const pendingToolCalls = (await result.getPendingToolCalls()).map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments
      }));

      await options.sessionStore.append(options.sessionId, "assistant.message", { text, cost });
      await runStopHook(hookRunner, { status: "ok", costUsd: cost.estimatedUsd });
      return { text, cost, requiresApproval, pendingToolCalls };
    } finally {
      this.active = undefined;
    }
  }

  async runStreaming(input: string, options: AgentRunnerOptions): Promise<AgentRunResult> {
    if (!options.config.apiKey) {
      throw new OrCodeError("config.missing_api_key", "OPENROUTER_API_KEY mancante. Esporta la variabile o aggiungila a ~/.orcode/config.json.");
    }

    this.cancelled = false;

    await emit(options, {
      type: "run.started",
      prompt: input,
      model: options.config.defaultModel,
      sessionId: options.sessionId,
      createdAt: now()
    });
    await emit(options, { type: "run.phase", phase: "understand", message: "Parsing request and loading project context", createdAt: now() });

    const workspaceRoot = options.config.workspaceRoot ?? process.cwd();
    const hookRunner = createHookRunner(options, workspaceRoot);
    await hookRunner.run("SessionStart", {
      model: options.config.defaultModel,
      permissionMode: options.config.permissionMode
    });
    await hookRunner.run("UserPromptSubmit", {
      prompt: input,
      model: options.config.defaultModel,
      permissionMode: options.config.permissionMode
    });

    const permissions = permissionsForMode(options.config);
    const permissionEngine = new PermissionEngine(permissions.defaultMode, permissions.rules);
    const allTools = createLocalTools({
      workspaceRoot,
      permissionEngine,
      hookRunner,
      ...(options.skillRegistry ? { skillRegistry: options.skillRegistry } : {}),
      ...(options.agentRegistry ? { agentRegistry: options.agentRegistry } : {}),
      ...(options.spawnAgent ? { spawnAgent: options.spawnAgent } : {}),
      audit: async (event) => {
        await options.sessionStore.append(options.sessionId, event.type, {
          tool: event.tool,
          ...event.payload
        });
        await emit(options, toAgentToolEvent(event));
      }
    });
    const tools = options.toolFilter && options.toolFilter.length > 0
      ? allTools.filter((toolEntry) => options.toolFilter!.includes((toolEntry as unknown as { name: string }).name))
      : allTools;

    const { enrichedInput, mentionedFilePaths } = await buildPromptContext(input, workspaceRoot, options, true);

    await options.sessionStore.append(options.sessionId, "user.message", { text: input, mentionedFiles: mentionedFilePaths });

    const profile = buildModelProfile(options.modelCapability, options.config.defaultModel);
    const effectiveMaxSteps = mergeMaxSteps(profile.maxStepsRecommended, options.config.maxSteps);

    await emit(options, {
      type: "run.phase",
      phase: "plan",
      message: `Preparing call · ctx ${profile.contextLength} · maxSteps ${effectiveMaxSteps} · tier ${profile.toolsetTier}`,
      createdAt: now()
    });

    const debugWriter = await createDebugWriter(workspaceRoot, options.sessionId);

    const client = new OpenRouter({ apiKey: options.config.apiKey });
    const stopWhen = options.config.maxCostUsd
      ? [stepCountIs(effectiveMaxSteps), maxCost(options.config.maxCostUsd)]
      : [stepCountIs(effectiveMaxSteps)];

    const callRequest = {
      model: options.config.defaultModel,
      instructions: buildInstructions(options),
      tools: tools as readonly Tool[],
      state: options.sessionStore.stateAccessor<typeof tools>(options.sessionId),
      stopWhen
    };

    const maxAttempts = 4;
    let attempt = 0;
    let firstUserInputCommitted = false;

    while (true) {
      const detector = new LoopDetector();
      let streamedText = "";
      let firstEventReceived = false;
      let loopDetected: { reason: string } | undefined;

      const callInput: NewUserMessageItem[] = firstUserInputCommitted
        ? []
        : [{ role: "user", content: enrichedInput }];

      const result = client.callModel({
        ...callRequest,
        input: callInput satisfies NewUserMessageItem[]
      });
      this.active = result;

      try {
        for await (const event of result.getFullResponsesStream()) {
          if (!isRecord(event)) {
            continue;
          }
          firstEventReceived = true;
          firstUserInputCommitted = true;
          await debugWriter.write(event);

          const type = stringField(event, "type");
          if (type === "turn.start") {
            detector.noteTurnStart();
            await emit(options, { type: "turn.started", turn: numberField(event, "turnNumber") ?? 0, createdAt: now() });
          } else if (type === "turn.end") {
            detector.noteTurnEnd();
            await emit(options, { type: "turn.completed", turn: numberField(event, "turnNumber") ?? 0, createdAt: now() });
          } else if (type === "response.reasoning_text.delta" || type === "response.reasoning_summary_text.delta") {
            await emit(options, { type: "reasoning.delta", delta: stringField(event, "delta") ?? "", createdAt: now() });
          } else if (type === "response.output_text.delta") {
            const delta = stringField(event, "delta") ?? "";
            streamedText += delta;
            detector.noteAssistantDelta(delta);
            await emit(options, { type: "assistant.delta", delta, createdAt: now() });
          } else if (type === "response.function_call_arguments.done") {
            const name = stringField(event, "name") ?? "tool";
            const args = stringField(event, "arguments") ?? "";
            const detection = detector.noteToolCall(name, args);
            await emit(options, { type: "tool.call", name, arguments: args, createdAt: now() });
            if (detection?.type === "tool_loop") {
              loopDetected = { reason: detection.reason };
              try {
                await result.cancel();
              } catch {
                /* swallow */
              }
              break;
            }
          } else if (type === "tool.result") {
            await emit(options, {
              type: "run.phase",
              phase: "verify",
              message: "Tool result received and model context updated",
              createdAt: now()
            });
          } else if (type === "response.failed") {
            const detail = extractErrorDetail(event);
            const rawDump = safeJson(event).slice(0, 1500);
            await options.sessionStore.append(options.sessionId, "provider.error.raw", { event: rawDump });
            await emit(options, {
              type: "run.failed",
              message: `${detail}\nRAW: ${rawDump}`,
              createdAt: now()
            });
          }
        }

        if (loopDetected) {
          throw new OrCodeError("agent.tool_loop", `Tool call loop detected: ${loopDetected.reason}`);
        }

        const response = await result.getResponse();
        const cost = usageToCost(response.usage);
        const text = streamedText || (await result.getText());
        const requiresApproval = await result.requiresApproval();
        const pendingToolCalls = (await result.getPendingToolCalls()).map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments
        }));

        await options.sessionStore.append(options.sessionId, "assistant.message", { text, cost });
        await emit(options, { type: "run.completed", text, cost, requiresApproval, pendingApprovalCount: pendingToolCalls.length, createdAt: now() });
        await runStopHook(hookRunner, { status: "ok", costUsd: cost.estimatedUsd });
        await debugWriter.close();
        return { text, cost, requiresApproval, pendingToolCalls };
      } catch (error) {
        if (this.cancelled) {
          await runStopHook(hookRunner, { status: "cancelled" });
          await emit(options, { type: "run.failed", message: "Run cancelled", createdAt: now() });
          await debugWriter.close();
          throw new CancelledError();
        }

        const classified = classifyError(error);
        await options.sessionStore.append(options.sessionId, "agent.error.classified", {
          class: classified.class,
          ...(classified.statusCode !== undefined ? { statusCode: classified.statusCode } : {}),
          message: classified.message,
          attempt
        });

        // Only retry transient errors that occurred before any stream event was received,
        // because mid-stream state is hard to reconstruct without duplicating user input.
        const decision = shouldRetry(classified.class, attempt);
        const canRetry = decision.retry && !firstEventReceived && attempt < maxAttempts - 1;

        if (!canRetry) {
          await runStopHook(hookRunner, { status: "error", error: readableError(error) }, error);
          await emit(options, { type: "run.failed", message: readableError(error), createdAt: now() });
          await debugWriter.close();
          throw error;
        }

        await emit(options, {
          type: "run.phase",
          phase: "plan",
          message: `Retry ${attempt + 1}/${maxAttempts}: ${classified.class} · ${decision.reason}`,
          createdAt: now()
        });
        await sleep(decision.backoffMs);
        attempt += 1;
        continue;
      } finally {
        this.active = undefined;
      }
    }
  }
}

type DebugWriter = {
  write(event: unknown): Promise<void>;
  close(): Promise<void>;
};

async function createDebugWriter(workspaceRoot: string, sessionId: string): Promise<DebugWriter> {
  const debugDir = path.join(workspaceRoot, ".orcode", "debug");
  const filePath = path.join(debugDir, `${sessionId}-stream.jsonl`);
  let initialized = false;
  let pending: Promise<void> = Promise.resolve();

  const ensure = async (): Promise<void> => {
    if (initialized) {
      return;
    }
    initialized = true;
    if (!existsSync(debugDir)) {
      await mkdir(debugDir, { recursive: true });
    }
  };

  return {
    async write(event: unknown): Promise<void> {
      try {
        await ensure();
        const line = `${safeJson(event)}\n`;
        pending = pending.then(() => appendFile(filePath, line)).catch(() => undefined);
      } catch {
        /* never throw from debug writer */
      }
    },
    async close(): Promise<void> {
      try {
        await pending;
      } catch {
        /* swallow */
      }
    }
  };
}
