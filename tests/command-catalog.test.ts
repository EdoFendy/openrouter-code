import { describe, expect, it } from "vitest";
import { renderCommandHelp, renderShortcutLine, suggestCommands } from "../src/commands/catalog.js";

describe("command catalog", () => {
  it("suggests slash commands by prefix", () => {
    const suggestions = suggestCommands("/mo");
    expect(suggestions.map((suggestion) => suggestion.name)).toContain("model");
    expect(suggestions.map((suggestion) => suggestion.name)).toContain("models");
  });

  it("renders help from the shared command registry", () => {
    const help = renderCommandHelp();
    expect(help).toContain("/mode [default|acceptEdits|plan|auto|bypass]");
    expect(help).toContain("/permissions [allow|ask|deny ToolName [pattern]] | /permissions remove <index>");
    expect(help).toContain("Filters: --tools");
  });

  it("renders stable shortcut copy for the TUI footer", () => {
    expect(renderShortcutLine()).toContain("Enter send prompt or command when idle");
    expect(renderShortcutLine()).toContain("Tab complete the highlighted slash command");
  });
});
