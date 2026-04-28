import { existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { HookEventName, OrCodeConfig, PermissionRule } from "../config.js";
import { HookEventNameSchema, permissionsForMode, saveGlobalConfigPatch, saveProjectConfigPatch } from "../config.js";
import { renderCommandHelp } from "./catalog.js";
import { renderDoctor, renderStatus } from "./doctor.js";
import type { ModelFilter, ModelRegistry } from "../openrouter/model-registry.js";
import { renderModelTable } from "../openrouter/model-registry.js";
import type { ContextManager } from "../runtime/context-manager.js";
import type { SessionStore } from "../session/session-store.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import { renderAgentList } from "../agents/agent-registry.js";
import { installGithubSkills } from "../skills/github-installer.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import { renderSkillList } from "../skills/skill-registry.js";
import { ensureProjectMemory, loadMemoryFiles } from "../runtime/memory.js";
import { ToolNameSchema, type JsonValue } from "../types.js";

async function removePreviousState(store: SessionStore, sessionId: string): Promise<string | undefined> {
  const statePath = store.statePath(sessionId);
  if (!existsSync(statePath)) {
    return undefined;
  }

  let bytes = 0;
  try {
    bytes = statSync(statePath).size;
  } catch {
    /* ignore stat errors */
  }

  try {
    await unlink(statePath);
  } catch {
    return undefined;
  }

  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export type CommandContext = {
  cwd: string;
  config: OrCodeConfig;
  registry: ModelRegistry;
  sessionStore: SessionStore;
  contextManager: ContextManager;
  skillRegistry: SkillRegistry;
  agentRegistry?: AgentRegistry;
  sessionId: string;
  setSessionId?: (sessionId: string) => void;
  setModel?: (model: string) => void;
  setApiKey?: (apiKey: string) => void;
  setConfigPatch?: (patch: Partial<OrCodeConfig>) => void;
  loadSessionTranscript?: (sessionId: string) => Promise<number>;
  activateSkillByName?: (name: string) => Promise<boolean>;
  spawnAgentByName?: (name: string, prompt: string) => Promise<{ ok: boolean; output: string }>;
};

export type CommandResult = {
  handled: boolean;
  output: string;
};

const HELP = renderCommandHelp();

function parseFilters(tokens: string[]): ModelFilter[] {
  const map = new Map<string, ModelFilter>([
    ["--tools", "tools"],
    ["--tool-choice", "tool-choice"],
    ["--reasoning", "reasoning"],
    ["--structured", "structured"],
    ["--response-format", "response-format"],
    ["--image-input", "image-input"],
    ["--file-input", "file-input"],
    ["--audio-input", "audio-input"],
    ["--image-output", "image-output"],
    ["--audio-output", "audio-output"],
    ["--cheap", "cheap"]
  ]);

  return tokens.flatMap((token) => {
    const filter = map.get(token);
    return filter ? [filter] : [];
  });
}

function renderHooks(config: OrCodeConfig): string {
  const lines = [`hooks ${config.hooks.enabled ? "enabled" : "disabled"}`];
  const events = Object.entries(config.hooks.events).sort(([left], [right]) => left.localeCompare(right));

  if (events.length === 0) {
    return [...lines, "No hooks configured."].join("\n");
  }

  for (const [event, commands] of events) {
    lines.push(`${event}:`);
    commands.forEach((command, index) => {
      lines.push(`  ${index + 1}. ${command.command}  timeout=${command.timeoutMs}ms  continueOnError=${command.continueOnError}`);
    });
  }

  return lines.join("\n");
}

function parseHookEvent(value: string | undefined): HookEventName | undefined {
  const parsed = HookEventNameSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

async function appendCommandEvent(context: CommandContext, type: string, payload: Record<string, JsonValue>): Promise<void> {
  if (context.sessionId === "no-session") {
    return;
  }

  await context.sessionStore.append(context.sessionId, type, payload);
}

export async function handleCommand(input: string, context: CommandContext): Promise<CommandResult> {
  const raw = input.trim().replace(/^\//, "");
  const [command = "help", ...args] = raw.split(/\s+/).filter(Boolean);

  switch (command) {
    case "help":
      return { handled: true, output: HELP };

    case "models": {
      const flagTokens = args.filter((token) => token.startsWith("--"));
      const keywords = args.filter((token) => !token.startsWith("--"));
      const showAll = flagTokens.includes("--all");
      const capabilityFlags = flagTokens.filter((token) => token !== "--all");
      const models = await context.registry.list(context.config.apiKey ? { apiKey: context.config.apiKey } : {});
      const flagFiltered = context.registry.filter(models, parseFilters(capabilityFlags));
      const searched = context.registry.search(flagFiltered, keywords);
      const limit = showAll ? searched.length : 40;
      return { handled: true, output: renderModelTable(searched, limit) };
    }

    case "model": {
      const next = args[0];
      if (!next) {
        return { handled: true, output: `Current model: ${context.config.defaultModel}` };
      }
      await saveProjectConfigPatch(context.cwd, { defaultModel: next });
      context.setModel?.(next);
      await appendCommandEvent(context, "model.changed", { model: next });
      return { handled: true, output: `Model set to ${next}` };
    }

    case "mode": {
      const next = args[0];
      if (!next) {
        return { handled: true, output: `Current mode: ${context.config.permissionMode}` };
      }

      if (!["default", "acceptEdits", "plan", "auto", "bypass"].includes(next)) {
        return { handled: true, output: "Usage: /mode default|acceptEdits|plan|auto|bypass" };
      }

      await saveProjectConfigPatch(context.cwd, { permissionMode: next });
      context.setConfigPatch?.({ permissionMode: next as OrCodeConfig["permissionMode"] });
      await appendCommandEvent(context, "mode.changed", { mode: next });
      if (next === "bypass") {
        return { handled: true, output: "Permission mode set to bypass. Tool permission checks now allow all workspace Read/ListDir/Grep/Glob/Write/Edit/Shell calls." };
      }
      return { handled: true, output: `Permission mode set to ${next}` };
    }

    case "init": {
      const memory = await ensureProjectMemory(context.cwd);
      return {
        handled: true,
        output: memory.created ? `Created ${memory.path}` : `${memory.path} already exists. Review/update it instead of overwriting.`
      };
    }

    case "memory": {
      const files = await loadMemoryFiles(context.cwd);
      if (files.length === 0) {
        return { handled: true, output: "No memory files loaded. Run /init to create CLAUDE.md." };
      }

      return {
        handled: true,
        output: files.map((file) => `${file.scope.padEnd(7)} ${file.path} (${file.content.length} chars)`).join("\n")
      };
    }

    case "permissions": {
      if (args.length === 0) {
        const effective = permissionsForMode(context.config);
        const rules = effective.rules.map((rule, index) => {
          const action = rule.action ? ` action=${rule.action}` : "";
          const pattern = rule.pattern ? ` pattern=${rule.pattern}` : "";
          return `${index + 1}. ${rule.decision.padEnd(5)} ${rule.tool}${action}${pattern}`;
        });
        return {
          handled: true,
          output: [
            `mode=${context.config.permissionMode} effectiveDefault=${effective.defaultMode} configuredDefault=${context.config.permissions.defaultMode}`,
            rules.length ? rules.join("\n") : "No rules."
          ].join("\n")
        };
      }

      if (args[0] === "remove") {
        const index = Number(args[1]);
        if (!Number.isInteger(index) || index < 1) {
          return { handled: true, output: "Usage: /permissions remove <index>" };
        }

        const zeroBasedIndex = index - 1;
        const existing = context.config.permissions.rules[zeroBasedIndex];
        if (!existing) {
          return { handled: true, output: `Permission rule not found at index ${index}. Run /permissions to list rules.` };
        }

        const permissions = {
          ...context.config.permissions,
          rules: context.config.permissions.rules.filter((_, ruleIndex) => ruleIndex !== zeroBasedIndex)
        };
        await saveProjectConfigPatch(context.cwd, { permissions });
        context.setConfigPatch?.({ permissions });
        await appendCommandEvent(context, "permission.changed", {
          action: "remove",
          index,
          tool: existing.tool,
          decision: existing.decision,
          pattern: existing.pattern ?? ""
        });
        return { handled: true, output: `Removed permission rule ${index}: ${existing.decision} ${existing.tool}${existing.pattern ? ` ${existing.pattern}` : ""}` };
      }

      const [decision, tool, ...patternParts] = args;
      if (!decision || !["allow", "ask", "deny"].includes(decision) || !tool) {
        return { handled: true, output: "Usage: /permissions allow|ask|deny ToolName [pattern] oppure /permissions remove <index>" };
      }

      const parsedTool = tool === "*" ? "*" : ToolNameSchema.safeParse(tool);
      if (parsedTool !== "*" && !parsedTool.success) {
        return { handled: true, output: `Unknown tool: ${tool}` };
      }

      const rule: PermissionRule = {
        tool: parsedTool === "*" ? "*" : parsedTool.data,
        decision: decision as PermissionRule["decision"],
        ...(patternParts.length > 0 ? { pattern: patternParts.join(" ") } : {})
      };
      const permissions = {
        ...context.config.permissions,
        rules: [...context.config.permissions.rules, rule]
      };
      await saveProjectConfigPatch(context.cwd, { permissions });
      context.setConfigPatch?.({ permissions });
      await appendCommandEvent(context, "permission.changed", {
        action: "add",
        tool: rule.tool,
        decision: rule.decision,
        pattern: rule.pattern ?? ""
      });
      return { handled: true, output: `Added permission rule: ${rule.decision} ${rule.tool}${rule.pattern ? ` ${rule.pattern}` : ""}` };
    }

    case "hooks": {
      if (args.length === 0) {
        return { handled: true, output: renderHooks(context.config) };
      }

      if (args[0] === "enable" || args[0] === "disable") {
        const hooks = {
          ...context.config.hooks,
          enabled: args[0] === "enable"
        };
        await saveProjectConfigPatch(context.cwd, { hooks });
        context.setConfigPatch?.({ hooks });
        await appendCommandEvent(context, "hook.config.changed", { action: args[0] });
        return { handled: true, output: `Hooks ${hooks.enabled ? "enabled" : "disabled"}.` };
      }

      if (args[0] === "add") {
        const event = parseHookEvent(args[1]);
        const command = args.slice(2).join(" ");
        if (!event || !command) {
          return {
            handled: true,
            output: `Usage: /hooks add <event> <command>\nEvents: ${HookEventNameSchema.options.join(", ")}`
          };
        }

        const current = context.config.hooks.events[event] ?? [];
        const hooks = {
          ...context.config.hooks,
          events: {
            ...context.config.hooks.events,
            [event]: [...current, { command, timeoutMs: 30_000, continueOnError: false }]
          }
        };
        await saveProjectConfigPatch(context.cwd, { hooks });
        context.setConfigPatch?.({ hooks });
        await appendCommandEvent(context, "hook.config.changed", { action: "add", event, command });
        return { handled: true, output: `Added ${event} hook ${current.length + 1}: ${command}` };
      }

      if (args[0] === "remove") {
        const event = parseHookEvent(args[1]);
        const index = Number(args[2]);
        if (!event || !Number.isInteger(index) || index < 1) {
          return {
            handled: true,
            output: `Usage: /hooks remove <event> <index>\nEvents: ${HookEventNameSchema.options.join(", ")}`
          };
        }

        const current = context.config.hooks.events[event] ?? [];
        const existing = current[index - 1];
        if (!existing) {
          return { handled: true, output: `Hook not found: ${event} #${index}` };
        }

        const nextCommands = current.filter((_, commandIndex) => commandIndex !== index - 1);
        const hooks = {
          ...context.config.hooks,
          events: {
            ...context.config.hooks.events,
            [event]: nextCommands
          }
        };
        await saveProjectConfigPatch(context.cwd, { hooks });
        context.setConfigPatch?.({ hooks });
        await appendCommandEvent(context, "hook.config.changed", { action: "remove", event, index, command: existing.command });
        return { handled: true, output: `Removed ${event} hook ${index}: ${existing.command}` };
      }

      return {
        handled: true,
        output: [
          "Usage:",
          "/hooks",
          "/hooks enable",
          "/hooks disable",
          "/hooks add <event> <command>",
          "/hooks remove <event> <index>",
          `Events: ${HookEventNameSchema.options.join(", ")}`
        ].join("\n")
      };
    }

    case "login": {
      const projectScoped = args[0] === "--project";
      const apiKey = projectScoped ? args[1] : args[0];
      if (!apiKey) {
        return {
          handled: true,
          output: "Usage: /login <OPENROUTER_API_KEY> oppure /login --project <OPENROUTER_API_KEY>"
        };
      }

      if (!apiKey.startsWith("sk-or-")) {
        return { handled: true, output: "La chiave non sembra una OPENROUTER_API_KEY valida." };
      }

      if (projectScoped) {
        await saveProjectConfigPatch(context.cwd, { apiKey });
        context.setApiKey?.(apiKey);
        return { handled: true, output: "OPENROUTER_API_KEY salvata in .orcode/config.json." };
      }

      const path = await saveGlobalConfigPatch(context.cwd, { apiKey });
      context.setApiKey?.(apiKey);
      return { handled: true, output: `OPENROUTER_API_KEY salvata in ${path}.` };
    }

    case "new": {
      const sessionId = await context.sessionStore.createSession();
      context.setSessionId?.(sessionId);
      return { handled: true, output: `New session: ${sessionId}` };
    }

    case "clear": {
      const sessionId = await context.sessionStore.createSession();
      context.setSessionId?.(sessionId);
      return { handled: true, output: `Cleared screen context. New session: ${sessionId}` };
    }

    case "reset": {
      const previousSessionId = context.sessionId;
      const sessionId = await context.sessionStore.createSession();
      context.setSessionId?.(sessionId);
      const removed = await removePreviousState(context.sessionStore, previousSessionId);
      const summary = removed
        ? `Reset done. New session: ${sessionId}. Cleared agent state for ${previousSessionId.slice(-8)} (${removed}).`
        : `Reset done. New session: ${sessionId}. (No prior agent state to clear.)`;
      return { handled: true, output: summary };
    }

    case "sessions": {
      const sessions = await context.sessionStore.listSessions(25);
      return {
        handled: true,
        output: sessions.length
          ? sessions.map((session) => `${session.id}  events=${session.events}  updated=${session.updatedAt}`).join("\n")
          : "No sessions yet."
      };
    }

    case "resume": {
      const sessionId = args[0];
      if (!sessionId) {
        return handleCommand("/sessions", context);
      }

      const sessions = await context.sessionStore.listSessions(100);
      const match = sessions.find((session) => session.id === sessionId || session.id.endsWith(sessionId));
      if (!match) {
        return { handled: true, output: `Session not found: ${sessionId}` };
      }

      context.setSessionId?.(match.id);
      const restored = (await context.loadSessionTranscript?.(match.id)) ?? 0;
      return { handled: true, output: `Resumed session ${match.id}. Restored ${restored} transcript item${restored === 1 ? "" : "s"}.` };
    }

    case "continue": {
      const sessions = await context.sessionStore.listSessions(20);
      const candidate = sessions.find((session) => session.id !== context.sessionId && session.events > 1);
      if (!candidate) {
        return { handled: true, output: "No previous session with content found." };
      }
      context.setSessionId?.(candidate.id);
      const restored = (await context.loadSessionTranscript?.(candidate.id)) ?? 0;
      return { handled: true, output: `Continued session ${candidate.id}. Restored ${restored} transcript item${restored === 1 ? "" : "s"}.` };
    }

    case "export": {
      const outputPath = args[0] ?? `.orcode/exports/${context.sessionId}.md`;
      const exported = await context.sessionStore.exportMarkdown(context.sessionId, outputPath);
      await appendCommandEvent(context, "session.exported", { path: exported });
      return { handled: true, output: `Exported session to ${exported}` };
    }

    case "compact": {
      const result = await context.contextManager.compact(context.sessionId);
      return {
        handled: true,
        output: `Compacted ${result.summarizedEvents} events; kept ${result.keptEvents}.`
      };
    }

    case "cost": {
      const cost = await context.sessionStore.cost(context.sessionId);
      return {
        handled: true,
        output: `Session cost: $${cost.estimatedUsd.toFixed(6)} (${cost.inputTokens} input tokens, ${cost.outputTokens} output tokens)`
      };
    }

    case "status":
      return {
        handled: true,
        output: await renderStatus(context)
      };

    case "doctor":
      return {
        handled: true,
        output: await renderDoctor(context)
      };

    case "skills":
    case "skill": {
      if (args[0] === "install") {
        const global = args.includes("--global");
        const force = args.includes("--force");
        const url = args.find((arg) => !arg.startsWith("--") && arg !== "install");

        if (!url) {
          return {
            handled: true,
            output: "Usage: /skills install <github-url> [--global] [--force]"
          };
        }

        const result = await installGithubSkills({
          cwd: context.cwd,
          url,
          global,
          force
        });
        await context.skillRegistry.scan();
        await appendCommandEvent(context, "skill.installed", {
          count: result.installed.length,
          destinationRoot: result.destinationRoot
        });
        return {
          handled: true,
          output: [
            `Installed ${result.installed.length} skill(s) into ${result.destinationRoot}:`,
            ...result.installed.map((skill) => `- ${skill.name} <- ${skill.remotePath}`)
          ].join("\n")
        };
      }

      const skills = await context.skillRegistry.scan();
      return { handled: true, output: renderSkillList(skills) };
    }

    case "agents": {
      const sub = args[0];
      if (!context.agentRegistry) {
        return { handled: true, output: "Agent registry non disponibile in questo run." };
      }
      const agents = await context.agentRegistry.scan();
      if (!sub || sub === "list") {
        return { handled: true, output: renderAgentList(agents) };
      }
      if (sub === "show") {
        const target = args[1];
        if (!target) {
          return { handled: true, output: "Usage: /agents show <name>" };
        }
        const manifest = agents.find((agent) => agent.name === target || agent.name.endsWith(`:${target}`));
        if (!manifest) {
          return { handled: true, output: `Agent "${target}" non trovato.` };
        }
        const lines = [
          `▣ ${manifest.name}`,
          `  ${manifest.description}`,
          manifest.whenToUse ? `  When: ${manifest.whenToUse}` : "",
          manifest.model ? `  model: ${manifest.model}` : "",
          Array.isArray(manifest.tools) ? `  tools: [${manifest.tools.join(", ")}]` : manifest.tools === "all" ? "  tools: all" : "",
          manifest.skills && manifest.skills.length > 0 ? `  skills: [${manifest.skills.join(", ")}]` : "",
          manifest.maxSteps !== undefined ? `  maxSteps: ${manifest.maxSteps}` : "",
          manifest.maxCostUsd !== undefined ? `  maxCostUsd: $${manifest.maxCostUsd}` : "",
          "",
          manifest.body ? "system prompt:" : "",
          manifest.body ? manifest.body.slice(0, 1200) : ""
        ].filter(Boolean);
        return { handled: true, output: lines.join("\n") };
      }
      if (sub === "spawn") {
        const target = args[1];
        const prompt = args.slice(2).join(" ").trim();
        if (!target || !prompt) {
          return { handled: true, output: "Usage: /agents spawn <name> <prompt>" };
        }
        if (!context.spawnAgentByName) {
          return { handled: true, output: "Spawn non disponibile in questo run." };
        }
        const result = await context.spawnAgentByName(target, prompt);
        return { handled: true, output: result.output };
      }
      return { handled: true, output: `Unknown /agents subcommand: ${sub}\nUsage: /agents [list|show <name>|spawn <name> <prompt>]` };
    }

    case "spawn": {
      const target = args[0];
      const prompt = args.slice(1).join(" ").trim();
      if (!target || !prompt) {
        return { handled: true, output: "Usage: /spawn <agent-name> <prompt>" };
      }
      if (!context.spawnAgentByName) {
        return { handled: true, output: "Spawn non disponibile in questo run." };
      }
      const result = await context.spawnAgentByName(target, prompt);
      return { handled: true, output: result.output };
    }

    default: {
      const agentMatch = await resolveAgentCommand(command, context);
      if (agentMatch.kind === "single") {
        if (!context.spawnAgentByName) {
          return { handled: true, output: `Agent ${agentMatch.manifest.name} richiesto. Usa: /spawn ${agentMatch.manifest.name} <prompt>` };
        }
        return { handled: true, output: `Usage: /${command} <prompt>  →  spawn agent ${agentMatch.manifest.name}` };
      }
      if (agentMatch.kind === "ambiguous") {
        const lines = [
          `Agent /${command} è ambiguo. Match multipli:`,
          ...agentMatch.candidates.map((manifest) => `  ${manifest.name} — ${manifest.description}`),
          "",
          "Usa /spawn <full-name> <prompt>."
        ];
        return { handled: true, output: lines.join("\n") };
      }
      const skillMatch = await resolveSkillCommand(command, context);
      if (skillMatch.kind === "single") {
        const ok = (await context.activateSkillByName?.(skillMatch.manifest.name)) ?? false;
        if (!ok) {
          return { handled: true, output: `Skill ${skillMatch.manifest.name} non attivabile.` };
        }
        await appendCommandEvent(context, "skill.activated", { name: skillMatch.manifest.name, source: "slash" });
        const lines = [
          `★ Skill activated: ${skillMatch.manifest.name}`,
          `  ${skillMatch.manifest.description}`
        ];
        return { handled: true, output: lines.join("\n") };
      }
      if (skillMatch.kind === "ambiguous") {
        const lines = [
          `Skill /${command} è ambigua. Match multipli:`,
          ...skillMatch.candidates.map((manifest) => `  ${manifest.name} — ${manifest.description}`),
          "",
          "Usa il nome completo, es. /<plugin>:<skill>."
        ];
        return { handled: true, output: lines.join("\n") };
      }
      return { handled: true, output: `Unknown command: /${command}\n\n${HELP}` };
    }
  }
}

type SkillResolution =
  | { kind: "none" }
  | { kind: "single"; manifest: SkillResolutionManifest }
  | { kind: "ambiguous"; candidates: SkillResolutionManifest[] };

type SkillResolutionManifest = { name: string; description: string };

type AgentResolution =
  | { kind: "none" }
  | { kind: "single"; manifest: AgentResolutionManifest }
  | { kind: "ambiguous"; candidates: AgentResolutionManifest[] };

type AgentResolutionManifest = { name: string; description: string };

async function resolveAgentCommand(command: string, context: CommandContext): Promise<AgentResolution> {
  if (!context.agentRegistry) {
    return { kind: "none" };
  }
  const agents = await context.agentRegistry.scan();
  if (agents.length === 0) {
    return { kind: "none" };
  }
  const lowerCommand = command.toLowerCase();
  const exact = agents.filter((agent) => agent.name.toLowerCase() === lowerCommand);
  if (exact.length === 1 && exact[0]) {
    return { kind: "single", manifest: { name: exact[0].name, description: exact[0].description } };
  }
  const shortMatch = agents.filter((agent) => {
    const tail = agent.name.includes(":") ? agent.name.split(":").slice(-1)[0] ?? "" : agent.name;
    return tail.toLowerCase() === lowerCommand;
  });
  if (shortMatch.length === 1 && shortMatch[0]) {
    return { kind: "single", manifest: { name: shortMatch[0].name, description: shortMatch[0].description } };
  }
  if (shortMatch.length > 1) {
    return {
      kind: "ambiguous",
      candidates: shortMatch.map((agent) => ({ name: agent.name, description: agent.description }))
    };
  }
  return { kind: "none" };
}

async function resolveSkillCommand(command: string, context: CommandContext): Promise<SkillResolution> {
  const skills = await context.skillRegistry.scan();
  if (skills.length === 0) {
    return { kind: "none" };
  }
  const lowerCommand = command.toLowerCase();
  const exact = skills.filter((skill) => skill.name.toLowerCase() === lowerCommand);
  if (exact.length === 1 && exact[0]) {
    return { kind: "single", manifest: { name: exact[0].name, description: exact[0].description } };
  }

  const shortMatch = skills.filter((skill) => {
    const tail = skill.name.includes(":") ? skill.name.split(":").slice(-1)[0] ?? "" : skill.name;
    return tail.toLowerCase() === lowerCommand;
  });
  if (shortMatch.length === 1 && shortMatch[0]) {
    return { kind: "single", manifest: { name: shortMatch[0].name, description: shortMatch[0].description } };
  }
  if (shortMatch.length > 1) {
    return {
      kind: "ambiguous",
      candidates: shortMatch.map((skill) => ({ name: skill.name, description: skill.description }))
    };
  }

  return { kind: "none" };
}
