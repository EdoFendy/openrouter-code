import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ConversationState, StateAccessor, Tool } from "@openrouter/agent";
import { redactSecrets } from "../security/secrets.js";
import { SessionEventSchema, type CostSnapshot, type JsonValue, type SessionEvent } from "../types.js";

export type SessionStoreOptions = {
  sessionsDir: string;
};

export class SessionStore {
  constructor(private readonly options: SessionStoreOptions) {}

  async createSession(): Promise<string> {
    await mkdir(this.options.sessionsDir, { recursive: true });
    const sessionId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
    await this.append(sessionId, "session.created", {});
    return sessionId;
  }

  async append(sessionId: string, type: string, payload: Record<string, JsonValue>): Promise<SessionEvent> {
    await mkdir(this.options.sessionsDir, { recursive: true });
    const event: SessionEvent = {
      id: randomUUID(),
      sessionId,
      type,
      createdAt: new Date().toISOString(),
      payload: redactJson(payload) as Record<string, JsonValue>
    };
    await writeFile(this.eventPath(sessionId), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
    return event;
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    const filePath = this.eventPath(sessionId);
    if (!existsSync(filePath)) {
      return [];
    }

    const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean);
    const events: SessionEvent[] = [];
    for (const line of lines) {
      const parsed = SessionEventSchema.safeParse(JSON.parse(line) as unknown);
      if (parsed.success) {
        events.push(parsed.data);
      }
    }
    return events;
  }

  async latestSessionId(): Promise<string | undefined> {
    if (!existsSync(this.options.sessionsDir)) {
      return undefined;
    }

    const entries = await import("node:fs/promises").then((fs) => fs.readdir(this.options.sessionsDir));
    const jsonl = entries.filter((entry) => entry.endsWith(".jsonl")).sort();
    return jsonl.at(-1)?.replace(/\.jsonl$/, "");
  }

  async listSessions(limit = 20): Promise<Array<{ id: string; path: string; events: number; updatedAt: string }>> {
    if (!existsSync(this.options.sessionsDir)) {
      return [];
    }

    const fs = await import("node:fs/promises");
    const entries = (await fs.readdir(this.options.sessionsDir)).filter((entry) => entry.endsWith(".jsonl")).sort().reverse();
    const sessions: Array<{ id: string; path: string; events: number; updatedAt: string }> = [];

    for (const entry of entries.slice(0, limit)) {
      const id = entry.replace(/\.jsonl$/, "");
      const filePath = path.join(this.options.sessionsDir, entry);
      const [stat, raw] = await Promise.all([fs.stat(filePath), readFile(filePath, "utf8")]);
      sessions.push({
        id,
        path: filePath,
        events: raw.split("\n").filter(Boolean).length,
        updatedAt: stat.mtime.toISOString()
      });
    }

    return sessions;
  }

  async exportMarkdown(sessionId: string, outputPath: string): Promise<string> {
    const events = await this.read(sessionId);
    const lines = [`# or-code session ${sessionId}`, ""];

    for (const event of events) {
      if (event.type === "user.message" || event.type === "assistant.message" || event.type.startsWith("tool.") || event.type === "session.compacted") {
        lines.push(`## ${event.type} - ${event.createdAt}`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(event.payload, null, 2));
        lines.push("```");
        lines.push("");
      }
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
    return outputPath;
  }

  stateAccessor<TTools extends readonly Tool[]>(sessionId: string): StateAccessor<TTools> {
    const statePath = this.statePath(sessionId);
    return {
      load: async () => {
        if (!existsSync(statePath)) {
          return null;
        }
        return JSON.parse(await readFile(statePath, "utf8")) as ConversationState<TTools>;
      },
      save: async (state) => {
        await mkdir(this.options.sessionsDir, { recursive: true });
        await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      }
    };
  }

  async cost(sessionId: string): Promise<CostSnapshot> {
    const events = await this.read(sessionId);
    return events.reduce<CostSnapshot>(
      (total, event) => {
        const cost = event.payload.cost;
        if (cost && typeof cost === "object" && !Array.isArray(cost)) {
          const snapshot = cost as Record<string, unknown>;
          total.inputTokens += typeof snapshot.inputTokens === "number" ? snapshot.inputTokens : 0;
          total.outputTokens += typeof snapshot.outputTokens === "number" ? snapshot.outputTokens : 0;
          total.estimatedUsd += typeof snapshot.estimatedUsd === "number" ? snapshot.estimatedUsd : 0;
        }
        return total;
      },
      { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
    );
  }

  eventPath(sessionId: string): string {
    return path.join(this.options.sessionsDir, `${sessionId}.jsonl`);
  }

  statePath(sessionId: string): string {
    return path.join(this.options.sessionsDir, `${sessionId}.state.json`);
  }
}

function redactJson(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item)]));
  }

  return value;
}
