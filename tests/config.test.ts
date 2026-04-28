import { describe, expect, it } from "vitest";
import { parseDotEnv } from "../src/config.js";

describe("config", () => {
  it("parses local .env values used by or-code", () => {
    const parsed = parseDotEnv([
      "# local development",
      "OPENROUTER_API_KEY=sk-or-v1-testvalue",
      'OR_CODE_MODEL="openai/gpt-5-nano"'
    ].join("\n"));

    expect(parsed.OPENROUTER_API_KEY).toBe("sk-or-v1-testvalue");
    expect(parsed.OR_CODE_MODEL).toBe("openai/gpt-5-nano");
  });
});
