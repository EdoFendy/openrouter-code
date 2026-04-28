import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HookRunner } from "../src/runtime/hooks.js";

describe("hook runner", () => {
  it("runs configured hooks with env and JSON stdin", async () => {
    const cwd = path.join(tmpdir(), `or-code-hooks-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const outputPath = path.join(cwd, "hook.txt");
    const command = [
      process.execPath,
      "-e",
      JSON.stringify(
        [
          "const fs=require('fs');",
          "let input='';",
          "process.stdin.on('data', chunk => input += chunk);",
          "process.stdin.on('end', () => {",
          "const payload = JSON.parse(input);",
          `fs.writeFileSync(${JSON.stringify(outputPath)}, process.env.OR_CODE_HOOK_EVENT + ':' + payload.prompt);`,
          "});"
        ].join("")
      )
    ].join(" ");
    const runner = new HookRunner({
      workspaceRoot: cwd,
      sessionId: "s1",
      config: {
        enabled: true,
        events: {
          UserPromptSubmit: [{ command, timeoutMs: 1000, continueOnError: false }]
        }
      }
    });

    await runner.run("UserPromptSubmit", { prompt: "hello" });
    await expect(readFile(outputPath, "utf8")).resolves.toBe("UserPromptSubmit:hello");
  });

  it("fails closed unless continueOnError is enabled", async () => {
    const cwd = path.join(tmpdir(), `or-code-hook-fail-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const runner = new HookRunner({
      workspaceRoot: cwd,
      sessionId: "s1",
      config: {
        enabled: true,
        events: {
          PreToolUse: [{ command: `${process.execPath} -e "process.exit(7)"`, timeoutMs: 1000, continueOnError: false }]
        }
      }
    });

    await expect(runner.run("PreToolUse", { tool: "Shell" })).rejects.toThrow("Hook PreToolUse failed");
  });
});
