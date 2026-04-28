export type ControlCoverage = {
  controlId: string;
  risk: "P0" | "P1" | "P2";
  minimumTest: string;
};

export const CONTROL_COVERAGE: ControlCoverage[] = [
  { controlId: "cmd.help", risk: "P1", minimumTest: "shared command catalog renders help without drift" },
  { controlId: "cmd.models", risk: "P0", minimumTest: "model registry derives capabilities from OpenRouter schema" },
  { controlId: "cmd.model.set", risk: "P1", minimumTest: "project config patch persists selected model" },
  { controlId: "cmd.mode.set", risk: "P1", minimumTest: "permission mode patch persists selected profile" },
  { controlId: "cmd.mode.bypass", risk: "P0", minimumTest: "bypass mode resolves workspace tool permissions to allow" },
  { controlId: "cmd.permissions", risk: "P0", minimumTest: "permission add/remove mutates project rules predictably" },
  { controlId: "cmd.new", risk: "P1", minimumTest: "session JSONL is created" },
  { controlId: "cmd.compact", risk: "P2", minimumTest: "context manager keeps recent events and writes compact event" },
  { controlId: "cmd.skills", risk: "P1", minimumTest: "skill registry parses SKILL.md frontmatter" },
  { controlId: "tool.read", risk: "P0", minimumTest: "path traversal is denied" },
  { controlId: "tool.write.preview", risk: "P0", minimumTest: "write without apply returns diff and does not mutate file" },
  { controlId: "tool.write.apply", risk: "P0", minimumTest: "write with allow rule mutates file" },
  { controlId: "tool.edit.preview", risk: "P0", minimumTest: "ambiguous edit refuses to mutate without precise input" },
  { controlId: "tool.grep", risk: "P1", minimumTest: "grep handles invalid regex and bounded result sets" },
  { controlId: "tool.glob", risk: "P1", minimumTest: "glob ignores node_modules, dist, git, and coverage" },
  { controlId: "tool.listdir", risk: "P1", minimumTest: "directory listing stays inside workspace" },
  { controlId: "tool.shell.preview", risk: "P0", minimumTest: "shell preview classifies risk and does not execute" },
  { controlId: "tool.shell.execute", risk: "P0", minimumTest: "shell without allow rule does not execute" },
  { controlId: "tui.input.submit", risk: "P0", minimumTest: "enter submits only when idle and preserves running draft" },
  { controlId: "tui.input.cancel", risk: "P2", minimumTest: "ctrl-c exits cleanly" },
  { controlId: "tui.input.clear", risk: "P2", minimumTest: "ctrl-u clears the draft without touching transcript" },
  { controlId: "tui.history.prev", risk: "P1", minimumTest: "up arrow restores previous submitted prompt" },
  { controlId: "tui.history.next", risk: "P1", minimumTest: "down arrow advances or clears recalled prompt" },
  { controlId: "tui.palette.complete", risk: "P1", minimumTest: "tab completes the top slash command suggestion" },
  { controlId: "tui.palette.dismiss", risk: "P2", minimumTest: "escape clears palette/input state" }
];
