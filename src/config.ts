import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { PermissionDecisionSchema, ToolNameSchema, OrCodeError } from "./types.js";

export const PermissionModeSchema = z.enum(["default", "acceptEdits", "plan", "auto", "bypass"]);

export const HookEventNameSchema = z.enum(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]);

export const HookCommandSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  continueOnError: z.boolean().default(false)
});

export const HooksConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    events: z.record(z.string(), z.array(HookCommandSchema)).default({})
  })
  .default({ enabled: true, events: {} });

export const PermissionRuleSchema = z.object({
  tool: z.union([ToolNameSchema, z.literal("*")]),
  action: z.string().optional(),
  pattern: z.string().optional(),
  decision: PermissionDecisionSchema,
  reason: z.string().optional()
});

export const OrCodeConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  defaultModel: z.string().min(1).default("openai/gpt-5-nano"),
  workspaceRoot: z.string().min(1).optional(),
  permissionMode: PermissionModeSchema.default("default"),
  modelCacheTtlMs: z.number().int().positive().default(1000 * 60 * 60),
  maxSteps: z.number().int().min(1).max(50).default(25),
  maxCostUsd: z.number().positive().optional(),
  permissions: z
    .object({
      defaultMode: PermissionDecisionSchema.default("ask"),
      rules: z.array(PermissionRuleSchema).default([])
    })
    .default({ defaultMode: "ask", rules: [] }),
  skills: z
    .object({
      enabled: z.boolean().default(true),
      directories: z.array(z.string()).default([])
    })
    .default({ enabled: true, directories: [] }),
  hooks: HooksConfigSchema,
  ui: z
    .object({
      showReasoning: z.boolean().default(false)
    })
    .default({ showReasoning: false })
});

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type HookEventName = z.infer<typeof HookEventNameSchema>;
export type HookCommand = z.infer<typeof HookCommandSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type OrCodeConfig = z.infer<typeof OrCodeConfigSchema>;
export type PartialOrCodeConfig = Partial<OrCodeConfig>;

export type ConfigPaths = {
  globalConfigPath: string;
  projectConfigPath: string;
  globalEnvPath: string;
  projectEnvPath: string;
  globalDir: string;
  projectDir: string;
  cacheDir: string;
  sessionsDir: string;
};

export type LoadConfigOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_READ_RULES: PermissionRule[] = [
  { tool: "Read", decision: "allow", reason: "Read-only workspace inspection" },
  { tool: "ListDir", decision: "allow", reason: "Read-only workspace inspection" },
  { tool: "Grep", decision: "allow", reason: "Read-only workspace inspection" },
  { tool: "Glob", decision: "allow", reason: "Read-only workspace inspection" },
  { tool: "Write", decision: "ask", reason: "Writes need a diff preview" },
  { tool: "Edit", decision: "ask", reason: "Edits need a diff preview" },
  { tool: "Shell", decision: "ask", reason: "Shell commands must be approved" }
];

export function getConfigPaths(cwd = process.cwd()): ConfigPaths {
  const globalDir = path.join(homedir(), ".orcode");
  const projectDir = path.join(cwd, ".orcode");

  return {
    globalDir,
    projectDir,
    globalConfigPath: path.join(globalDir, "config.json"),
    projectConfigPath: path.join(projectDir, "config.json"),
    globalEnvPath: path.join(globalDir, ".env"),
    projectEnvPath: path.join(cwd, ".env"),
    cacheDir: path.join(globalDir, "cache"),
    sessionsDir: path.join(projectDir, "sessions")
  };
}

function defaults(cwd: string): OrCodeConfig {
  return OrCodeConfigSchema.parse({
    workspaceRoot: cwd,
    permissions: {
      defaultMode: "ask",
      rules: DEFAULT_READ_RULES
    }
  });
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new OrCodeError("config.invalid_json", `Config non valida: ${filePath}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function parseDotEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1] ?? "";
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (match[2]?.startsWith('"')) {
        value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    values[key] = value;
  }

  return values;
}

async function readDotEnvFile(filePath: string): Promise<Record<string, string>> {
  if (!existsSync(filePath)) {
    return {};
  }

  return parseDotEnv(await readFile(filePath, "utf8"));
}

function envToConfig(env: Record<string, string | undefined>): Record<string, unknown> {
  const envConfig: Record<string, unknown> = {};

  if (env.OPENROUTER_API_KEY) {
    envConfig.apiKey = env.OPENROUTER_API_KEY;
  }

  if (env.OR_CODE_MODEL) {
    envConfig.defaultModel = env.OR_CODE_MODEL;
  }

  if (env.OR_CODE_PERMISSION_MODE) {
    envConfig.permissionMode = env.OR_CODE_PERMISSION_MODE;
  }

  return envConfig;
}

function mergeConfig(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(next)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof merged[key] === "object" &&
      merged[key] !== null &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeConfig(merged[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<{ config: OrCodeConfig; paths: ConfigPaths }> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const paths = getConfigPaths(cwd);
  const globalConfig = await readJsonFile(paths.globalConfigPath);
  const projectConfig = await readJsonFile(paths.projectConfigPath);
  const globalEnvConfig = envToConfig(await readDotEnvFile(paths.globalEnvPath));
  const projectEnvConfig = envToConfig(await readDotEnvFile(paths.projectEnvPath));
  const processEnvConfig = envToConfig(env);
  const raw = [defaults(cwd), globalConfig, globalEnvConfig, projectConfig, projectEnvConfig, processEnvConfig].reduce(
    (current, next) => mergeConfig(current, next),
    {} as Record<string, unknown>
  );
  const parsed = OrCodeConfigSchema.safeParse(raw);

  if (!parsed.success) {
    throw new OrCodeError("config.invalid_schema", "Config or-code non valida.", {
      issues: parsed.error.issues.map((issue) => issue.message)
    });
  }

  return { config: parsed.data, paths };
}

export async function ensureConfigDirs(paths: ConfigPaths): Promise<void> {
  await Promise.all([mkdir(paths.globalDir, { recursive: true }), mkdir(paths.projectDir, { recursive: true })]);
  await Promise.all([mkdir(paths.cacheDir, { recursive: true }), mkdir(paths.sessionsDir, { recursive: true })]);
}

export async function saveProjectConfigPatch(cwd: string, patch: Record<string, unknown>): Promise<void> {
  const paths = getConfigPaths(cwd);
  await mkdir(paths.projectDir, { recursive: true });
  const current = await readJsonFile(paths.projectConfigPath);
  const next = mergeConfig(current, patch);
  await writeFile(paths.projectConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function saveGlobalConfigPatch(cwd: string, patch: Record<string, unknown>): Promise<string> {
  const paths = getConfigPaths(cwd);
  await mkdir(paths.globalDir, { recursive: true });
  const current = await readJsonFile(paths.globalConfigPath);
  const next = mergeConfig(current, patch);
  await writeFile(paths.globalConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return paths.globalConfigPath;
}

export function permissionsForMode(config: OrCodeConfig): OrCodeConfig["permissions"] {
  if (config.permissionMode === "default") {
    return config.permissions;
  }

  if (config.permissionMode === "acceptEdits") {
    return {
      defaultMode: config.permissions.defaultMode,
      rules: [
        { tool: "Write", decision: "allow", reason: "acceptEdits mode allows file writes after preview" },
        { tool: "Edit", decision: "allow", reason: "acceptEdits mode allows file edits after preview" },
        { tool: "Shell", decision: "ask", reason: "acceptEdits mode still asks for shell commands" },
        ...config.permissions.rules
      ]
    };
  }

  if (config.permissionMode === "plan") {
    return {
      defaultMode: "deny",
      rules: [
        { tool: "Read", decision: "allow", reason: "plan mode allows read-only inspection" },
        { tool: "ListDir", decision: "allow", reason: "plan mode allows read-only inspection" },
        { tool: "Grep", decision: "allow", reason: "plan mode allows read-only inspection" },
        { tool: "Glob", decision: "allow", reason: "plan mode allows read-only inspection" },
        { tool: "Write", decision: "deny", reason: "plan mode is read-only" },
        { tool: "Edit", decision: "deny", reason: "plan mode is read-only" },
        { tool: "Shell", decision: "deny", reason: "plan mode blocks shell commands" }
      ]
    };
  }

  if (config.permissionMode === "bypass") {
    return {
      defaultMode: "allow",
      rules: [
        { tool: "*", decision: "allow", reason: "bypass mode allows all tool permission checks inside the workspace" }
      ]
    };
  }

  return {
    defaultMode: "allow",
    rules: [
      { tool: "Shell", action: "execute", pattern: "rm *", decision: "deny", reason: "auto mode blocks destructive shell patterns" },
      { tool: "Shell", action: "execute", pattern: "sudo *", decision: "deny", reason: "auto mode blocks privilege escalation" },
      ...config.permissions.rules
    ]
  };
}
