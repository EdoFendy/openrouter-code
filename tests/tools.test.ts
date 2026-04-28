import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PermissionEngine } from "../src/permissions/engine.js";
import { HookRunner } from "../src/runtime/hooks.js";
import { createLocalTools } from "../src/tools/local-tools.js";

function getTool(tools: readonly unknown[], name: string) {
  const found = tools.find((tool) => {
    const maybe = tool as { function?: { name?: string; execute?: unknown } };
    return maybe.function?.name === name;
  }) as { function: { execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>> } } | undefined;

  if (!found) {
    throw new Error(`Missing tool ${name}`);
  }
  return found;
}

describe("local tools", () => {
  it("previews write without mutating when apply is false", async () => {
    const root = path.join(tmpdir(), `or-code-tools-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const filePath = path.join(root, "a.txt");
    await writeFile(filePath, "before\n", "utf8");

    const tools = createLocalTools({
      workspaceRoot: root,
      permissionEngine: new PermissionEngine("allow", [])
    });
    const write = getTool(tools, "Write");
    const result = await write.function.execute({ path: "a.txt", content: "after\n", apply: false });

    expect(result.applied).toBe(false);
    expect(String(result.preview)).toContain("-before");
    expect(await readFile(filePath, "utf8")).toBe("before\n");
  });

  it("does not execute shell when permission asks and no prompter exists", async () => {
    const root = path.join(tmpdir(), `or-code-shell-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const tools = createLocalTools({
      workspaceRoot: root,
      permissionEngine: new PermissionEngine("ask", [])
    });
    const shell = getTool(tools, "Shell");
    const result = await shell.function.execute({ command: "echo unsafe > out.txt", cwd: ".", timeoutMs: 1000, apply: true });
    expect(result.executed).toBe(false);
  });

  it("lets PreToolUse hooks block tool execution", async () => {
    const root = path.join(tmpdir(), `or-code-hook-tools-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const tools = createLocalTools({
      workspaceRoot: root,
      permissionEngine: new PermissionEngine("allow", []),
      hookRunner: new HookRunner({
        workspaceRoot: root,
        sessionId: "s1",
        config: {
          enabled: true,
          events: {
            PreToolUse: [{ command: `${process.execPath} -e "process.exit(9)"`, timeoutMs: 1000, continueOnError: false }]
          }
        }
      })
    });
    const shell = getTool(tools, "Shell");

    await expect(shell.function.execute({ command: "echo ok", cwd: ".", timeoutMs: 1000, apply: true })).rejects.toThrow("Hook PreToolUse failed");
  });
});
