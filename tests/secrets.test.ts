import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/security/secrets.js";
import { SessionStore } from "../src/session/session-store.js";

describe("secret handling", () => {
  it("redacts OpenRouter keys in text", () => {
    expect(redactSecrets("key sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890")).toContain("[REDACTED_OPENROUTER_API_KEY]");
  });

  it("redacts session payloads before JSONL append", async () => {
    const dir = path.join(tmpdir(), `or-code-secrets-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const store = new SessionStore({ sessionsDir: dir });
    const sessionId = await store.createSession();
    await store.append(sessionId, "user.message", {
      text: "sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890"
    });

    const raw = await readFile(store.eventPath(sessionId), "utf8");
    expect(raw).not.toContain("sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(raw).toContain("[REDACTED_OPENROUTER_API_KEY]");
  });
});
