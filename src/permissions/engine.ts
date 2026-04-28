import path from "node:path";
import type { PermissionRule } from "../config.js";
import type { PermissionDecision, ToolName } from "../types.js";

export type PermissionRequest = {
  tool: ToolName;
  action: string;
  target?: string;
  command?: string;
  preview?: string;
};

export type PermissionResult = {
  decision: PermissionDecision;
  reason: string;
  rule?: PermissionRule;
};

export type PermissionPrompter = (request: PermissionRequest, result: PermissionResult) => Promise<PermissionDecision>;

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function targetMatches(pattern: string | undefined, target: string | undefined): boolean {
  if (!pattern) {
    return true;
  }

  if (!target) {
    return false;
  }

  const normalizedPattern = pattern.split(path.sep).join("/");
  const normalizedTarget = target.split(path.sep).join("/");
  return wildcardToRegExp(normalizedPattern).test(normalizedTarget);
}

export class PermissionEngine {
  constructor(
    private readonly defaultMode: PermissionDecision,
    private readonly rules: PermissionRule[],
    private readonly prompter?: PermissionPrompter
  ) {}

  evaluate(request: PermissionRequest): PermissionResult {
    const matched = this.rules.find((rule) => {
      const toolMatches = rule.tool === "*" || rule.tool === request.tool;
      const actionMatches = !rule.action || rule.action === request.action;
      return toolMatches && actionMatches && targetMatches(rule.pattern, request.target ?? request.command);
    });

    if (matched) {
      return {
        decision: matched.decision,
        reason: matched.reason ?? `Matched ${matched.tool} permission rule.`,
        rule: matched
      };
    }

    return {
      decision: this.defaultMode,
      reason: `No matching permission rule; default is ${this.defaultMode}.`
    };
  }

  async decide(request: PermissionRequest): Promise<PermissionResult> {
    const evaluated = this.evaluate(request);
    if (evaluated.decision !== "ask") {
      return evaluated;
    }

    if (!this.prompter) {
      return evaluated;
    }

    const prompted = await this.prompter(request, evaluated);
    return {
      ...evaluated,
      decision: prompted,
      reason: prompted === "ask" ? evaluated.reason : `User selected ${prompted}.`
    };
  }
}
