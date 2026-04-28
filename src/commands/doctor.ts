import { existsSync } from "node:fs";
import { permissionsForMode, type OrCodeConfig } from "../config.js";
import type { ModelRegistry } from "../openrouter/model-registry.js";
import type { SessionStore } from "../session/session-store.js";
import type { SkillRegistry } from "../skills/skill-registry.js";

export type DoctorContext = {
  config: OrCodeConfig;
  registry: ModelRegistry;
  sessionStore: SessionStore;
  skillRegistry: SkillRegistry;
  sessionId: string;
};

function line(status: "ok" | "warn" | "fail", label: string, detail: string): string {
  return `[${status}] ${label.padEnd(18)} ${detail}`;
}

export async function renderStatus(context: DoctorContext): Promise<string> {
  const skills = await context.skillRegistry.scan();
  const cost = context.sessionId === "no-session" ? undefined : await context.sessionStore.cost(context.sessionId);
  const effectivePermissions = permissionsForMode(context.config);
  const permissionCounts = effectivePermissions.rules.reduce(
    (counts, rule) => {
      counts[rule.decision] += 1;
      return counts;
    },
    { allow: 0, ask: 0, deny: 0 }
  );

  return [
    "or-code status",
    line("ok", "model", context.config.defaultModel),
    line(context.config.apiKey ? "ok" : "fail", "api key", context.config.apiKey ? "configured" : "missing"),
    line("ok", "workspace", context.config.workspaceRoot ?? process.cwd()),
    line("ok", "session", context.sessionId),
    line("ok", "skills", `${skills.length} discovered`),
    line("ok", "hooks", `${context.config.hooks.enabled ? "enabled" : "disabled"}, ${Object.values(context.config.hooks.events).reduce((total, commands) => total + commands.length, 0)} configured`),
    line("ok", "permissions", `mode=${context.config.permissionMode}, effective=${effectivePermissions.defaultMode}, allow=${permissionCounts.allow}, ask=${permissionCounts.ask}, deny=${permissionCounts.deny}`),
    line("ok", "cost", cost ? `$${cost.estimatedUsd.toFixed(6)} (${cost.inputTokens}/${cost.outputTokens} tokens)` : "no active session")
  ].join("\n");
}

export async function renderDoctor(context: DoctorContext): Promise<string> {
  const checks: string[] = ["or-code doctor"];
  checks.push(line(context.config.apiKey ? "ok" : "fail", "OPENROUTER_API_KEY", context.config.apiKey ? "configured" : "missing"));
  checks.push(line(existsSync(context.config.workspaceRoot ?? process.cwd()) ? "ok" : "fail", "workspace", context.config.workspaceRoot ?? process.cwd()));

  try {
    const model = await context.registry.findById(context.config.defaultModel, context.config.apiKey ? { apiKey: context.config.apiKey } : {});
    checks.push(
      line(
        model ? "ok" : "warn",
        "model registry",
        model
          ? `${model.id} | tools=${model.supportsTools} reasoning=${model.supportsReasoning || model.supportsIncludeReasoning} structured=${model.supportsStructuredOutputs}`
          : `model not found in registry: ${context.config.defaultModel}`
      )
    );
  } catch (error) {
    checks.push(line("warn", "model registry", error instanceof Error ? error.message : String(error)));
  }

  const skills = await context.skillRegistry.scan();
  checks.push(line(skills.length > 0 ? "ok" : "warn", "skills", `${skills.length} discovered`));
  checks.push(line("ok", "hooks", `${context.config.hooks.enabled ? "enabled" : "disabled"}, ${Object.values(context.config.hooks.events).reduce((total, commands) => total + commands.length, 0)} configured`));
  const effectivePermissions = permissionsForMode(context.config);
  checks.push(line(context.config.permissionMode === "bypass" || effectivePermissions.defaultMode === "allow" ? "warn" : "ok", "permissions", `mode=${context.config.permissionMode}, effective=${effectivePermissions.defaultMode}`));
  checks.push(line("ok", "node", process.version));

  return checks.join("\n");
}
