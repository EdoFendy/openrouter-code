import React from "react";
import { Box, Text } from "ink";
import type { AgentRunView } from "../../runtime/agent-events.js";
import { compactLine, formatElapsed } from "./text-utils.js";
import { PhaseChain } from "./PhaseChain.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type NowLineProps = {
  view: AgentRunView;
  columns: number;
  tickFrame: number;
};

export function NowLine(props: NowLineProps): React.ReactElement | null {
  const view = props.view;
  if (view.status === "idle") {
    return null;
  }

  const activePhase = view.phases.find((phase) => phase.status === "active" || phase.status === "blocked");
  const elapsed = formatElapsed(view.startedAt, view.completedAt ?? view.updatedAt);
  const labelMap: Record<string, string> = {
    understand: "reading request",
    plan: "planning",
    act: "acting",
    verify: "verifying",
    compose: "composing"
  };
  const label = activePhase ? (labelMap[activePhase.id] ?? activePhase.id) : view.currentAction.toLowerCase();
  const labelColor =
    view.status === "error"
      ? "red"
      : view.status === "blocked"
        ? "yellow"
        : view.status === "done"
          ? "green"
          : activePhase?.id === "compose"
            ? "green"
            : activePhase?.id === "act"
              ? "magenta"
              : "cyan";

  const spinner = view.status === "running" ? SPINNER_FRAMES[props.tickFrame % SPINNER_FRAMES.length] : view.status === "done" ? "✓" : view.status === "error" ? "✗" : "⊘";
  const stats = view.toolStats;
  const reasoningPreview = view.reasoning && view.status === "running" ? compactLine(view.reasoning, Math.max(40, props.columns - 4)) : undefined;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={labelColor} bold>{spinner} </Text>
        <Text color={labelColor}>{label}</Text>
        {elapsed ? <Text color="gray">  · {elapsed}</Text> : null}
        {stats.calls > 0 ? <Text color="gray">  · step {Math.max(view.turns, 1)} · tools {stats.calls}/{stats.results}</Text> : null}
      </Box>
      <PhaseChain phases={view.phases} />
      {reasoningPreview ? <Text color="gray">  {reasoningPreview}</Text> : null}
    </Box>
  );
}
