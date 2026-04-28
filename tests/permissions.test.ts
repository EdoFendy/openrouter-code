import { describe, expect, it } from "vitest";
import { permissionsForMode, type OrCodeConfig } from "../src/config.js";
import { PermissionEngine } from "../src/permissions/engine.js";

describe("permission engine", () => {
  it("denies by matching rule before default allow", () => {
    const engine = new PermissionEngine("allow", [{ tool: "Shell", decision: "deny", pattern: "rm *" }]);
    const result = engine.evaluate({ tool: "Shell", action: "execute", command: "rm -rf dist" });
    expect(result.decision).toBe("deny");
  });

  it("asks when no rule matches and default is ask", () => {
    const engine = new PermissionEngine("ask", []);
    const result = engine.evaluate({ tool: "Write", action: "write", target: "src/a.ts" });
    expect(result.decision).toBe("ask");
  });

  it("bypass mode allows all tool permission checks", () => {
    const permissions = permissionsForMode({
      defaultModel: "openai/gpt-5-nano",
      workspaceRoot: process.cwd(),
      permissionMode: "bypass",
      modelCacheTtlMs: 1000,
      maxSteps: 8,
      permissions: { defaultMode: "ask", rules: [] },
      skills: { enabled: true, directories: [] },
      ui: { showReasoning: false }
    } satisfies OrCodeConfig);
    const engine = new PermissionEngine(permissions.defaultMode, permissions.rules);
    const shell = engine.evaluate({ tool: "Shell", action: "execute", command: "npm test" });
    const write = engine.evaluate({ tool: "Write", action: "write", target: "src/a.ts" });

    expect(shell.decision).toBe("allow");
    expect(write.decision).toBe("allow");
  });
});
