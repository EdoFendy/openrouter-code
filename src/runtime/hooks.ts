import { spawn } from "node:child_process";
import type { HookCommand, HookEventName, HooksConfig } from "../config.js";
import { redactSecrets } from "../security/secrets.js";
import { OrCodeError, type JsonValue } from "../types.js";
import { truncateText } from "../tools/diff.js";

export type HookPayload = Record<string, JsonValue>;

export type HookRunResult = {
  event: HookEventName;
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type HookRunnerOptions = {
  config: HooksConfig;
  workspaceRoot: string;
  sessionId: string;
  audit?: (result: HookRunResult) => Promise<void> | void;
};

const MAX_HOOK_OUTPUT_CHARS = 20_000;

function hookCommands(config: HooksConfig, event: HookEventName): HookCommand[] {
  if (!config.enabled) {
    return [];
  }

  return config.events[event] ?? [];
}

function serializePayload(payload: HookPayload): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ error: "payload_not_serializable" });
  }
}

function runHookCommand(
  command: HookCommand,
  options: HookRunnerOptions,
  event: HookEventName,
  payload: HookPayload
): Promise<HookRunResult> {
  const startedAt = Date.now();
  const payloadJson = serializePayload(payload);

  return new Promise((resolve, reject) => {
    const child = spawn(command.command, {
      cwd: options.workspaceRoot,
      shell: process.env.SHELL ?? true,
      env: {
        ...process.env,
        OR_CODE_HOOK_EVENT: event,
        OR_CODE_HOOK_SESSION_ID: options.sessionId,
        OR_CODE_WORKSPACE_ROOT: options.workspaceRoot,
        OR_CODE_HOOK_PAYLOAD: payloadJson
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (exitCode: number | null, extraStderr = ""): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        event,
        command: command.command,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout: redactSecrets(truncateText(stdout, MAX_HOOK_OUTPUT_CHARS)),
        stderr: redactSecrets(truncateText(`${stderr}${extraStderr}`, MAX_HOOK_OUTPUT_CHARS))
      });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(null, `\nHook timed out after ${command.timeoutMs}ms.`);
    }, command.timeoutMs);

    child.stdin.write(payloadJson);
    child.stdin.end();
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
      settle(exitCode);
    });
  });
}

export class HookRunner {
  constructor(private readonly options: HookRunnerOptions) {}

  async run(event: HookEventName, payload: HookPayload = {}): Promise<HookRunResult[]> {
    const commands = hookCommands(this.options.config, event);
    const results: HookRunResult[] = [];

    for (const command of commands) {
      const result = await runHookCommand(command, this.options, event, payload);
      results.push(result);
      await this.options.audit?.(result);

      if (result.exitCode !== 0 && !command.continueOnError) {
        throw new OrCodeError("hook.failed", `Hook ${event} failed: ${command.command}`, {
          event,
          command: command.command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr
        });
      }
    }

    return results;
  }
}
