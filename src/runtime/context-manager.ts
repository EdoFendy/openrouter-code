import { writeFile } from "node:fs/promises";
import type { SessionStore } from "../session/session-store.js";
import type { JsonValue } from "../types.js";

export type CompactResult = {
  sessionId: string;
  keptEvents: number;
  summarizedEvents: number;
  summary: string;
};

export class ContextManager {
  constructor(private readonly sessionStore: SessionStore) {}

  async compact(sessionId: string, keepLast = 30): Promise<CompactResult> {
    const events = await this.sessionStore.read(sessionId);
    const kept = events.slice(-keepLast);
    const summarized = events.slice(0, Math.max(0, events.length - kept.length));
    const summary = summarized
      .map((event) => `${event.createdAt} ${event.type}`)
      .slice(-200)
      .join("\n");

    const compacted = {
      sessionId,
      keptEvents: kept.length,
      summarizedEvents: summarized.length,
      summary
    };

    await this.sessionStore.append(sessionId, "session.compacted", compacted as unknown as Record<string, JsonValue>);
    await writeFile(
      this.sessionStore.eventPath(`${sessionId}.compact`),
      `${JSON.stringify({ compacted, kept }, null, 2)}\n`,
      "utf8"
    );

    return compacted;
  }
}
