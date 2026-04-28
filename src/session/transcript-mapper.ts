import type { SessionEvent } from "../types.js";
import type { ToolKind, TranscriptItem, TodoEntry } from "../tui/components/Transcript.js";

const TOOL_KIND_MAP: Record<string, ToolKind> = {
  Write: "write",
  Edit: "edit",
  Shell: "shell",
  Read: "read",
  ListDir: "list",
  Glob: "search",
  Grep: "search",
  Skill: "skill"
};

function classifyTool(toolName: string): ToolKind {
  return TOOL_KIND_MAP[toolName] ?? "other";
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function summarizePayload(payload: Record<string, unknown>): string {
  const command = stringField(payload, "command");
  if (command) {
    return command;
  }
  const path = stringField(payload, "path");
  if (path) {
    return path;
  }
  const reason = stringField(payload, "reason");
  return reason ?? "";
}

export function mapSessionEventsToTranscript(events: SessionEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let lastTodoIndex = -1;

  for (const event of events) {
    const payload = event.payload;
    const tool = stringField(payload, "tool") ?? "";

    switch (event.type) {
      case "user.message": {
        const text = stringField(payload, "text") ?? "";
        if (text) {
          items.push({ kind: "text", role: "user", text, createdAt: event.createdAt });
        }
        break;
      }

      case "assistant.message": {
        const text = stringField(payload, "text") ?? "";
        if (text) {
          items.push({ kind: "text", role: "assistant", text, createdAt: event.createdAt });
        }
        break;
      }

      case "tool.result": {
        if (!tool) {
          break;
        }
        if (tool === "Skill") {
          const name = stringField(payload, "name") ?? "skill";
          const description = stringField(payload, "description") ?? "";
          const bytes = numberField(payload, "bytes");
          items.push({
            kind: "tool",
            toolKind: "skill",
            tool: "Skill",
            detail: name,
            status: "ok",
            ...(description ? { bashIn: description } : {}),
            ...(bytes !== undefined ? { bytes } : {}),
            createdAt: event.createdAt
          });
          break;
        }
        if (tool === "Todos") {
          const rawItems = Array.isArray(payload.items) ? payload.items : [];
          const entries: TodoEntry[] = rawItems
            .map((entry) => {
              if (entry && typeof entry === "object") {
                const e = entry as { content?: unknown; status?: unknown };
                const content = typeof e.content === "string" ? e.content : "";
                const status =
                  e.status === "in_progress" ? "in_progress" : e.status === "completed" ? "completed" : "pending";
                return content ? { content, status: status as TodoEntry["status"] } : undefined;
              }
              return undefined;
            })
            .filter((entry): entry is TodoEntry => entry !== undefined);
          if (entries.length > 0) {
            const todosItem: TranscriptItem = { kind: "todos", items: entries, createdAt: event.createdAt };
            if (lastTodoIndex >= 0) {
              items[lastTodoIndex] = todosItem;
            } else {
              items.push(todosItem);
              lastTodoIndex = items.length - 1;
            }
          }
          break;
        }

        const path = stringField(payload, "path");
        const command = stringField(payload, "command");
        const bytes = numberField(payload, "bytes");
        const lines = numberField(payload, "lines");
        const replacements = numberField(payload, "replacements");
        const linesDelta = numberField(payload, "linesDelta");
        const matches = numberField(payload, "count");
        const exitCode = numberField(payload, "exitCode");
        const stdout = stringField(payload, "stdout");
        const modeRaw = stringField(payload, "mode");
        const actionRaw = stringField(payload, "action");

        const detailFor = path ?? command ?? summarizePayload(payload);
        items.push({
          kind: "tool",
          toolKind: classifyTool(tool),
          tool,
          detail: detailFor,
          status: "ok",
          ...(bytes !== undefined ? { bytes } : {}),
          ...(lines !== undefined ? { lines } : {}),
          ...(replacements !== undefined ? { replacements } : {}),
          ...(linesDelta !== undefined ? { linesDelta } : {}),
          ...(matches !== undefined ? { matches } : {}),
          ...(exitCode !== undefined && exitCode !== null ? { exitCode } : {}),
          ...(modeRaw === "create" || modeRaw === "overwrite" ? { mode: modeRaw } : {}),
          ...(actionRaw === "added" || actionRaw === "removed" || actionRaw === "modified" ? { action: actionRaw } : {}),
          ...(tool === "Shell" && command ? { bashIn: command } : {}),
          ...(tool === "Shell" && stdout ? { bashOut: stdout } : {}),
          createdAt: event.createdAt
        });
        break;
      }

      case "tool.error":
      case "tool.denied": {
        if (!tool) {
          break;
        }
        const path = stringField(payload, "path");
        const command = stringField(payload, "command");
        const detailFor = path ?? command ?? summarizePayload(payload);
        items.push({
          kind: "tool",
          toolKind: classifyTool(tool),
          tool,
          detail: detailFor,
          status: event.type === "tool.denied" ? "denied" : "error",
          createdAt: event.createdAt
        });
        break;
      }

      case "model.changed": {
        const model = stringField(payload, "model") ?? "unknown";
        items.push({ kind: "text", role: "system", text: `Model set to ${model}`, createdAt: event.createdAt });
        break;
      }

      default:
        break;
    }
  }

  return items;
}
