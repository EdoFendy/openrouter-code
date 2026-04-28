import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { tool, type Tool } from "@openrouter/agent";
import { z } from "zod";
import type { PermissionEngine, PermissionRequest, PermissionResult } from "../permissions/engine.js";
import type { HookRunner, HookPayload } from "../runtime/hooks.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import type { SpawnAgentFn } from "../agents/agent-types.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import { OrCodeError, type JsonValue, type ToolName } from "../types.js";
import { truncateText, unifiedDiff } from "./diff.js";
import { assertReadableFile, resolveWorkspacePath, toWorkspaceRelative } from "./path-utils.js";

export type ToolAuditEvent = {
  type: "tool.preview" | "tool.result" | "tool.error" | "tool.denied";
  tool: ToolName;
  payload: Record<string, JsonValue>;
};

export type LocalToolsOptions = {
  workspaceRoot: string;
  permissionEngine: PermissionEngine;
  hookRunner?: HookRunner;
  audit?: (event: ToolAuditEvent) => Promise<void> | void;
  skillRegistry?: SkillRegistry;
  agentRegistry?: AgentRegistry;
  spawnAgent?: SpawnAgentFn;
};

const MAX_READ_BYTES = 200_000;
const MAX_TOOL_OUTPUT_CHARS = 60_000;
const MAX_SHELL_OUTPUT_CHARS = 16_000;

const PermissionOutputSchema = z.object({
  decision: z.enum(["allow", "ask", "deny"]),
  reason: z.string()
});

const PreviewOutputSchema = z.object({
  applied: z.boolean(),
  preview: z.string(),
  permission: PermissionOutputSchema
});

function permissionToOutput(result: PermissionResult): z.infer<typeof PermissionOutputSchema> {
  return {
    decision: result.decision,
    reason: result.reason
  };
}

async function audit(options: LocalToolsOptions, event: ToolAuditEvent): Promise<void> {
  await options.audit?.(event);
}

async function decide(options: LocalToolsOptions, request: PermissionRequest): Promise<PermissionResult> {
  return options.permissionEngine.decide(request);
}

async function preTool(options: LocalToolsOptions, toolName: ToolName, payload: HookPayload): Promise<void> {
  await options.hookRunner?.run("PreToolUse", { tool: toolName, ...payload });
}

async function postTool(options: LocalToolsOptions, toolName: ToolName, payload: HookPayload): Promise<void> {
  await options.hookRunner?.run("PostToolUse", { tool: toolName, ...payload });
}

function deniedOutput(permission: PermissionResult, preview: string): z.infer<typeof PreviewOutputSchema> {
  return {
    applied: false,
    preview,
    permission: permissionToOutput(permission)
  };
}

function classifyShell(command: string): string {
  const risky = /\b(rm|sudo|chmod|chown|dd|mkfs|diskutil|shutdown|reboot|curl|wget|ssh|scp|rsync)\b/.test(command);
  const mutating = /\b(mv|cp|mkdir|touch|git\s+(commit|push|reset|checkout)|npm\s+(install|publish)|bun\s+(add|install))\b/.test(
    command
  );

  if (risky) {
    return "high";
  }

  if (mutating) {
    return "medium";
  }

  return "low";
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: process.env.SHELL ?? true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settled = true;
      resolve({
        exitCode: null,
        stdout: truncateText(stdout, MAX_SHELL_OUTPUT_CHARS),
        stderr: truncateText(`${stderr}\nCommand timed out after ${timeoutMs}ms.`, MAX_SHELL_OUTPUT_CHARS)
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: truncateText(stdout, MAX_SHELL_OUTPUT_CHARS),
        stderr: truncateText(stderr, MAX_SHELL_OUTPUT_CHARS)
      });
    });
  });
}

export function createLocalTools(options: LocalToolsOptions): readonly Tool[] {
  const readTool = tool({
    name: "Read",
    description: "Read a UTF-8 text file inside the workspace. Use for inspection only.",
    inputSchema: z.object({
      path: z.string().min(1),
      maxBytes: z.number().int().positive().max(1_000_000).optional()
    }),
    outputSchema: z.object({
      path: z.string(),
      content: z.string(),
      truncated: z.boolean()
    }),
    execute: async ({ path: inputPath, maxBytes }) => {
      const effectiveMaxBytes = maxBytes ?? MAX_READ_BYTES;
      const absolute = resolveWorkspacePath(options.workspaceRoot, inputPath);
      const relative = toWorkspaceRelative(options.workspaceRoot, absolute);
      await preTool(options, "Read", { action: "read", target: relative });
      const permission = await decide(options, { tool: "Read", action: "read", target: relative });
      if (permission.decision !== "allow") {
        await audit(options, { type: "tool.denied", tool: "Read", payload: { path: relative, reason: permission.reason } });
        await postTool(options, "Read", { action: "read", target: relative, status: "denied", reason: permission.reason });
        throw new OrCodeError("permission.denied", `Lettura non consentita: ${relative}`, { reason: permission.reason });
      }

      await assertReadableFile(absolute, effectiveMaxBytes);
      const content = await readFile(absolute, "utf8");
      const lines = content.length === 0 ? 0 : content.split("\n").length;
      const output = {
        path: relative,
        content: truncateText(content, MAX_TOOL_OUTPUT_CHARS),
        truncated: content.length > MAX_TOOL_OUTPUT_CHARS
      };
      await audit(options, {
        type: "tool.result",
        tool: "Read",
        payload: { path: relative, bytes: content.length, lines, truncated: output.truncated }
      });
      await postTool(options, "Read", { action: "read", target: relative, status: "ok", truncated: output.truncated });
      return output;
    }
  });

  const listDirTool = tool({
    name: "ListDir",
    description: "List files and directories inside the workspace.",
    inputSchema: z.object({
      path: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional()
    }),
    outputSchema: z.object({
      path: z.string(),
      entries: z.array(z.object({ name: z.string(), type: z.enum(["file", "dir", "other"]) })),
      truncated: z.boolean()
    }),
    execute: async ({ path: inputPath, limit }) => {
      const effectivePath = inputPath ?? ".";
      const effectiveLimit = limit ?? 200;
      const absolute = resolveWorkspacePath(options.workspaceRoot, effectivePath);
      const relative = toWorkspaceRelative(options.workspaceRoot, absolute);
      await preTool(options, "ListDir", { action: "list", target: relative });
      const permission = await decide(options, { tool: "ListDir", action: "list", target: relative });
      if (permission.decision !== "allow") {
        await postTool(options, "ListDir", { action: "list", target: relative, status: "denied", reason: permission.reason });
        throw new OrCodeError("permission.denied", `Lista directory non consentita: ${relative}`, { reason: permission.reason });
      }

      const entries = await readdir(absolute, { withFileTypes: true });
      const output = {
        path: relative,
        entries: entries.slice(0, effectiveLimit).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? ("dir" as const) : entry.isFile() ? ("file" as const) : ("other" as const)
        })),
        truncated: entries.length > effectiveLimit
      };
      await audit(options, { type: "tool.result", tool: "ListDir", payload: { path: relative, count: output.entries.length } });
      await postTool(options, "ListDir", { action: "list", target: relative, status: "ok", count: output.entries.length, truncated: output.truncated });
      return output;
    }
  });

  const globTool = tool({
    name: "Glob",
    description: "Find workspace paths matching a glob pattern.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      cwd: z.string().optional(),
      limit: z.number().int().positive().max(5000).optional()
    }),
    outputSchema: z.object({
      pattern: z.string(),
      matches: z.array(z.string()),
      truncated: z.boolean()
    }),
    execute: async ({ pattern, cwd, limit }) => {
      const effectiveCwd = cwd ?? ".";
      const effectiveLimit = limit ?? 500;
      const absoluteCwd = resolveWorkspacePath(options.workspaceRoot, effectiveCwd);
      const relativeCwd = toWorkspaceRelative(options.workspaceRoot, absoluteCwd);
      await preTool(options, "Glob", { action: "glob", target: relativeCwd, pattern });
      const permission = await decide(options, { tool: "Glob", action: "glob", target: relativeCwd });
      if (permission.decision !== "allow") {
        await postTool(options, "Glob", { action: "glob", target: relativeCwd, pattern, status: "denied", reason: permission.reason });
        throw new OrCodeError("permission.denied", `Glob non consentito: ${relativeCwd}`, { reason: permission.reason });
      }

      const matches = await fg(pattern, {
        cwd: absoluteCwd,
        dot: true,
        onlyFiles: false,
        unique: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"]
      });
      const output = { pattern, matches: matches.slice(0, effectiveLimit), truncated: matches.length > effectiveLimit };
      await audit(options, { type: "tool.result", tool: "Glob", payload: { pattern, count: output.matches.length } });
      await postTool(options, "Glob", { action: "glob", target: relativeCwd, pattern, status: "ok", count: output.matches.length, truncated: output.truncated });
      return output;
    }
  });

  const grepTool = tool({
    name: "Grep",
    description: "Search UTF-8 text files in the workspace using a JavaScript regex.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      path: z.string().optional(),
      glob: z.string().optional(),
      caseSensitive: z.boolean().optional(),
      limit: z.number().int().positive().max(1000).optional()
    }),
    outputSchema: z.object({
      pattern: z.string(),
      matches: z.array(z.object({ path: z.string(), line: z.number(), text: z.string() })),
      truncated: z.boolean()
    }),
    execute: async ({ pattern, path: inputPath, glob, caseSensitive, limit }) => {
      const effectivePath = inputPath ?? ".";
      const effectiveGlob = glob ?? "**/*";
      const effectiveCase = caseSensitive ?? false;
      const effectiveLimit = limit ?? 100;
      const absoluteBase = resolveWorkspacePath(options.workspaceRoot, effectivePath);
      const relativeBase = toWorkspaceRelative(options.workspaceRoot, absoluteBase);
      await preTool(options, "Grep", { action: "grep", target: relativeBase, pattern, glob: effectiveGlob });
      const permission = await decide(options, { tool: "Grep", action: "grep", target: relativeBase });
      if (permission.decision !== "allow") {
        await postTool(options, "Grep", { action: "grep", target: relativeBase, pattern, glob: effectiveGlob, status: "denied", reason: permission.reason });
        throw new OrCodeError("permission.denied", `Grep non consentito: ${relativeBase}`, { reason: permission.reason });
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, effectiveCase ? "" : "i");
      } catch (error) {
        throw new OrCodeError("grep.invalid_regex", `Regex non valida: ${pattern}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const files = await fg(effectiveGlob, {
        cwd: absoluteBase,
        dot: true,
        onlyFiles: true,
        unique: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/coverage/**"]
      });
      const matches: Array<{ path: string; line: number; text: string }> = [];

      for (const file of files) {
        if (matches.length >= effectiveLimit) {
          break;
        }

        const absolute = path.join(absoluteBase, file);
        try {
          const content = await readFile(absolute, "utf8");
          const lines = content.split("\n");
          for (let index = 0; index < lines.length; index += 1) {
            const text = lines[index] ?? "";
            if (regex.test(text)) {
              matches.push({
                path: toWorkspaceRelative(options.workspaceRoot, absolute),
                line: index + 1,
                text: truncateText(text, 500)
              });
              regex.lastIndex = 0;
            }

            if (matches.length >= effectiveLimit) {
              break;
            }
          }
        } catch {
          // Ignore unreadable/binary-ish files; Grep is best-effort read-only inspection.
        }
      }

      const output = { pattern, matches, truncated: matches.length >= effectiveLimit };
      await audit(options, { type: "tool.result", tool: "Grep", payload: { pattern, count: matches.length } });
      await postTool(options, "Grep", { action: "grep", target: relativeBase, pattern, glob: effectiveGlob, status: "ok", count: matches.length, truncated: output.truncated });
      return output;
    }
  });

  const writeTool = tool({
    name: "Write",
    description:
      "Preview or apply a full-file write inside the workspace. Defaults to preview; set apply=true only after the diff is approved.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      apply: z.boolean().optional()
    }),
    outputSchema: PreviewOutputSchema.extend({
      path: z.string()
    }),
    execute: async ({ path: inputPath, content, apply }) => {
      const effectiveApply = apply ?? false;
      const absolute = resolveWorkspacePath(options.workspaceRoot, inputPath);
      const relative = toWorkspaceRelative(options.workspaceRoot, absolute);
      await preTool(options, "Write", { action: "write", target: relative, apply: effectiveApply });
      const before = existsSync(absolute) ? await readFile(absolute, "utf8") : "";
      const preview = unifiedDiff(relative, before, content);
      await audit(options, { type: "tool.preview", tool: "Write", payload: { path: relative, preview } });

      if (!effectiveApply) {
        await postTool(options, "Write", { action: "write", target: relative, status: "preview", applied: false });
        return { path: relative, ...deniedOutput({ decision: "ask", reason: "Preview only; set apply=true after approval." }, preview) };
      }

      const permission = await decide(options, { tool: "Write", action: "write", target: relative, preview });
      if (permission.decision !== "allow") {
        await audit(options, { type: permission.decision === "deny" ? "tool.denied" : "tool.preview", tool: "Write", payload: { path: relative, preview } });
        await postTool(options, "Write", { action: "write", target: relative, status: permission.decision, applied: false, reason: permission.reason });
        return { path: relative, ...deniedOutput(permission, preview) };
      }

      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
      const lines = content.length === 0 ? 0 : content.split("\n").length;
      const mode = before === "" ? "create" : "overwrite";
      const output = { path: relative, applied: true, preview, permission: permissionToOutput(permission) };
      await audit(options, {
        type: "tool.result",
        tool: "Write",
        payload: { path: relative, applied: true, bytes: content.length, lines, mode }
      });
      await postTool(options, "Write", { action: "write", target: relative, status: "ok", applied: true });
      return output;
    }
  });

  const editTool = tool({
    name: "Edit",
    description:
      "Preview or apply a string replacement inside a workspace file. Defaults to preview; set apply=true only after the diff is approved.",
    inputSchema: z.object({
      path: z.string().min(1),
      oldText: z.string().min(1),
      newText: z.string(),
      replaceAll: z.boolean().optional(),
      apply: z.boolean().optional()
    }),
    outputSchema: PreviewOutputSchema.extend({
      path: z.string(),
      replacements: z.number().int().nonnegative()
    }),
    execute: async ({ path: inputPath, oldText, newText, replaceAll, apply }) => {
      const effectiveApply = apply ?? false;
      const effectiveReplaceAll = replaceAll ?? false;
      const absolute = resolveWorkspacePath(options.workspaceRoot, inputPath);
      const relative = toWorkspaceRelative(options.workspaceRoot, absolute);
      await preTool(options, "Edit", { action: "edit", target: relative, apply: effectiveApply, replaceAll: effectiveReplaceAll });
      await assertReadableFile(absolute, MAX_READ_BYTES);
      const before = await readFile(absolute, "utf8");
      const occurrences = before.split(oldText).length - 1;

      if (occurrences === 0) {
        throw new OrCodeError("edit.no_match", `Testo da sostituire non trovato in ${relative}.`);
      }

      if (!effectiveReplaceAll && occurrences > 1) {
        throw new OrCodeError("edit.ambiguous_match", `Testo trovato ${occurrences} volte in ${relative}; usa replaceAll=true o un oldText più preciso.`);
      }

      const after = effectiveReplaceAll ? before.split(oldText).join(newText) : before.replace(oldText, newText);
      const preview = unifiedDiff(relative, before, after);
      await audit(options, { type: "tool.preview", tool: "Edit", payload: { path: relative, preview, replacements: occurrences } });

      if (!effectiveApply) {
        await postTool(options, "Edit", { action: "edit", target: relative, status: "preview", applied: false, replacements: effectiveReplaceAll ? occurrences : 1 });
        return {
          path: relative,
          replacements: effectiveReplaceAll ? occurrences : 1,
          ...deniedOutput({ decision: "ask", reason: "Preview only; set apply=true after approval." }, preview)
        };
      }

      const permission = await decide(options, { tool: "Edit", action: "edit", target: relative, preview });
      if (permission.decision !== "allow") {
        await postTool(options, "Edit", { action: "edit", target: relative, status: permission.decision, applied: false, reason: permission.reason });
        return {
          path: relative,
          replacements: effectiveReplaceAll ? occurrences : 1,
          ...deniedOutput(permission, preview)
        };
      }

      await writeFile(absolute, after, "utf8");
      const replacements = effectiveReplaceAll ? occurrences : 1;
      const beforeLines = before.split("\n").length;
      const afterLines = after.split("\n").length;
      const linesDelta = afterLines - beforeLines;
      const action = linesDelta > 0 ? "added" : linesDelta < 0 ? "removed" : "modified";
      const output = {
        path: relative,
        replacements,
        applied: true,
        preview,
        permission: permissionToOutput(permission)
      };
      await audit(options, {
        type: "tool.result",
        tool: "Edit",
        payload: { path: relative, replacements, linesDelta, action, bytes: after.length }
      });
      await postTool(options, "Edit", { action: "edit", target: relative, status: "ok", applied: true, replacements });
      return output;
    }
  });

  const shellTool = tool({
    name: "Shell",
    description:
      "Preview or execute a shell command in the workspace. Defaults to preview; commands only execute after permission allows them.",
    inputSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
      apply: z.boolean().optional()
    }),
    outputSchema: z.object({
      command: z.string(),
      cwd: z.string(),
      risk: z.enum(["low", "medium", "high"]),
      executed: z.boolean(),
      exitCode: z.number().nullable().optional(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      permission: PermissionOutputSchema
    }),
    execute: async ({ command, cwd, timeoutMs, apply }) => {
      const effectiveCwd = cwd ?? ".";
      const effectiveTimeoutMs = timeoutMs ?? 30_000;
      const effectiveApply = apply ?? false;
      const absoluteCwd = resolveWorkspacePath(options.workspaceRoot, effectiveCwd);
      const relativeCwd = toWorkspaceRelative(options.workspaceRoot, absoluteCwd);
      const risk = classifyShell(command) as "low" | "medium" | "high";
      const preview = `command: ${command}\ncwd: ${relativeCwd}\nrisk: ${risk}\ntimeoutMs: ${effectiveTimeoutMs}`;
      await preTool(options, "Shell", { action: "execute", target: relativeCwd, command, risk, apply: effectiveApply });
      await audit(options, { type: "tool.preview", tool: "Shell", payload: { command, cwd: relativeCwd, risk } });

      if (!effectiveApply) {
        await postTool(options, "Shell", { action: "execute", target: relativeCwd, command, risk, status: "preview", executed: false });
        return {
          command,
          cwd: relativeCwd,
          risk,
          executed: false,
          permission: { decision: "ask" as const, reason: "Preview only; set apply=true after approval." }
        };
      }

      const permission = await decide(options, { tool: "Shell", action: "execute", target: relativeCwd, command, preview });
      if (permission.decision !== "allow") {
        await audit(options, { type: permission.decision === "deny" ? "tool.denied" : "tool.preview", tool: "Shell", payload: { command, cwd: relativeCwd } });
        await postTool(options, "Shell", { action: "execute", target: relativeCwd, command, risk, status: permission.decision, executed: false, reason: permission.reason });
        return {
          command,
          cwd: relativeCwd,
          risk,
          executed: false,
          permission: permissionToOutput(permission)
        };
      }

      const result = await runShell(command, absoluteCwd, effectiveTimeoutMs);
      const output = {
        command,
        cwd: relativeCwd,
        risk,
        executed: true,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        permission: permissionToOutput(permission)
      };
      await audit(options, {
        type: "tool.result",
        tool: "Shell",
        payload: {
          command,
          exitCode: result.exitCode,
          stdout: truncateText(result.stdout, 1200),
          stderr: truncateText(result.stderr, 1200)
        }
      });
      await postTool(options, "Shell", { action: "execute", target: relativeCwd, command, risk, status: "ok", executed: true, exitCode: result.exitCode ?? null });
      return output;
    }
  });

  const todosTool = tool({
    name: "Todos",
    description:
      "Publish or update the agent task list visible in the TUI. Call this at the start of complex tasks (>=3 files) and again after each phase to mark progress. Replaces the previous task list entirely each call.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            content: z.string().min(1),
            status: z.enum(["pending", "in_progress", "completed"]).optional()
          })
        )
        .min(1)
        .max(30)
    }),
    outputSchema: z.object({
      count: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      inProgress: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative()
    }),
    execute: async ({ items }) => {
      const normalizedItems = items.map((item) => ({
        content: item.content,
        status: (item.status ?? "pending") as "pending" | "in_progress" | "completed"
      }));
      const counts = normalizedItems.reduce(
        (acc, item) => {
          if (item.status === "pending") {
            acc.pending += 1;
          } else if (item.status === "in_progress") {
            acc.inProgress += 1;
          } else {
            acc.completed += 1;
          }
          return acc;
        },
        { pending: 0, inProgress: 0, completed: 0 }
      );
      const output = {
        count: normalizedItems.length,
        pending: counts.pending,
        inProgress: counts.inProgress,
        completed: counts.completed
      };
      await audit(options, {
        type: "tool.result",
        tool: "Todos",
        payload: { items: normalizedItems as unknown as JsonValue, ...output }
      });
      await postTool(options, "Todos", { action: "todos", target: ".", status: "ok", count: normalizedItems.length });
      return output;
    }
  });

  const skillTool = tool({
    name: "Skill",
    description:
      "Activate a workspace skill on demand. Call this only when the user's request matches a skill's whenToUse. The tool returns the skill's full instructions (SKILL.md body); follow them for the rest of the task. Discover available skills from the metadata listed in the system prompt.",
    inputSchema: z.object({
      name: z.string().min(1)
    }),
    outputSchema: z.object({
      name: z.string(),
      description: z.string(),
      whenToUse: z.string(),
      body: z.string(),
      bytes: z.number().int().nonnegative()
    }),
    execute: async ({ name }) => {
      if (!options.skillRegistry) {
        throw new OrCodeError("skill.unavailable", "Skill registry non configurato.");
      }
      const loaded = await options.skillRegistry.load(name);
      const bytes = Buffer.byteLength(loaded.body, "utf8");
      const output = {
        name: loaded.name,
        description: loaded.description,
        whenToUse: loaded.whenToUse,
        body: loaded.body,
        bytes
      };
      await audit(options, {
        type: "tool.result",
        tool: "Skill",
        payload: { name: loaded.name, description: loaded.description, bytes }
      });
      await postTool(options, "Skill", { action: "skill", target: loaded.name, status: "ok" });
      return output;
    }
  });

  const agentTool = tool({
    name: "Agent",
    description:
      "Spawn a sub-agent to handle a focused subtask. Use either `name` (a pre-defined agent from the registry) OR `role` (an ad-hoc specialist that inherits your model). Provide `prompt` describing the task. Optionally override `tools`, `model`, `maxSteps`, `maxCostUsd`. Returns the sub-agent's final text plus telemetry. Sub-agents run in fresh state and cannot read parent conversation.",
    inputSchema: z.object({
      name: z.string().min(1).optional(),
      role: z.string().min(1).optional(),
      prompt: z.string().min(1),
      tools: z.union([z.array(z.string()), z.literal("all")]).optional(),
      model: z.string().optional(),
      maxSteps: z.number().int().positive().max(50).optional(),
      maxCostUsd: z.number().positive().optional(),
      isolation: z.enum(["shared", "worktree"]).optional()
    }),
    outputSchema: z.object({
      agentName: z.string(),
      modelUsed: z.string(),
      text: z.string(),
      durationMs: z.number().nonnegative(),
      steps: z.number().int().nonnegative(),
      cost: z.object({
        inputTokens: z.number().nonnegative(),
        outputTokens: z.number().nonnegative(),
        estimatedUsd: z.number().nonnegative()
      }),
      toolStats: z.object({
        calls: z.number().int().nonnegative(),
        results: z.number().int().nonnegative(),
        writes: z.number().int().nonnegative(),
        edits: z.number().int().nonnegative(),
        shells: z.number().int().nonnegative()
      }),
      truncated: z.boolean().optional(),
      reachedMaxDepth: z.boolean().optional()
    }),
    execute: async ({ name, role, prompt, tools: toolFilter, model, maxSteps, maxCostUsd, isolation }) => {
      if (!options.spawnAgent) {
        throw new OrCodeError("agent.spawn_unavailable", "Sub-agent spawning is not configured for this run.");
      }
      if (!name && !role) {
        throw new OrCodeError("agent.invalid_request", "Provide either `name` (registered agent) or `role` (ad-hoc specialist).");
      }
      if (name && role) {
        throw new OrCodeError("agent.invalid_request", "Provide either `name` OR `role`, not both.");
      }
      if (name && options.agentRegistry && !options.agentRegistry.get(name)) {
        const available = options.agentRegistry.list().map((manifest) => manifest.name);
        throw new OrCodeError(
          "agent.not_found",
          `Agent "${name}" non trovato. Disponibili: ${available.length > 0 ? available.join(", ") : "(nessuno)"}.`
        );
      }
      const request = {
        prompt,
        ...(name !== undefined ? { name } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(toolFilter !== undefined ? { tools: toolFilter } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(maxSteps !== undefined ? { maxSteps } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
        ...(isolation !== undefined ? { isolation } : {})
      };
      const summary = await options.spawnAgent(request);
      const output = {
        agentName: summary.agentName,
        modelUsed: summary.modelUsed,
        text: summary.text,
        durationMs: summary.durationMs,
        steps: summary.steps,
        cost: summary.cost,
        toolStats: summary.toolStats,
        ...(summary.truncated !== undefined ? { truncated: summary.truncated } : {}),
        ...(summary.reachedMaxDepth !== undefined ? { reachedMaxDepth: summary.reachedMaxDepth } : {})
      };
      await audit(options, {
        type: "tool.result",
        tool: "Agent",
        payload: {
          agentName: summary.agentName,
          modelUsed: summary.modelUsed,
          durationMs: summary.durationMs,
          steps: summary.steps,
          textPreview: summary.text.slice(0, 800),
          textBytes: summary.text.length,
          cost: summary.cost as unknown as JsonValue,
          toolStats: summary.toolStats as unknown as JsonValue
        }
      });
      await postTool(options, "Agent", { action: "spawn", target: summary.agentName, status: "ok" });
      return output;
    }
  });

  return [readTool, writeTool, editTool, grepTool, globTool, listDirTool, shellTool, todosTool, skillTool, agentTool] as const;
}
