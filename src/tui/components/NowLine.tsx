import React from "react";
import { Box, Text } from "ink";
import type { AgentRunView } from "../../runtime/agent-events.js";
import { formatElapsed } from "./text-utils.js";
import { PhaseChain } from "./PhaseChain.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export type NowLineProps = {
  view: AgentRunView;
  columns: number;
  tickFrame: number;
};

function getReasoningBlocks(reasoning: string, maxBlocks: number, maxWidth: number): string[] {
  return reasoning
    .split(/\n\n+/)
    .map((b) => b.replace(/\n/g, " ").trim())
    .filter((b) => b.length > 0)
    .slice(-maxBlocks)
    .map((b) => (b.length > maxWidth ? `${b.slice(0, maxWidth - 1)}…` : b));
}

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

  const spinner =
    view.status === "running"
      ? SPINNER_FRAMES[props.tickFrame % SPINNER_FRAMES.length]
      : view.status === "done"
        ? "✓"
        : view.status === "error"
          ? "✗"
          : "⊘";

  const stats = view.toolStats;
  const maxWidth = Math.max(20, props.columns - 8);
  const reasoningBlocks =
    view.reasoning && view.status === "running"
      ? getReasoningBlocks(view.reasoning, 2, maxWidth)
      : [];

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={labelColor} bold>{spinner} </Text>
        <Text color={labelColor}>{label}</Text>
        {elapsed ? <Text color="gray">  · {elapsed}</Text> : null}
        {stats.calls > 0 ? (
          <Text color="gray">  · step {Math.max(view.turns, 1)} · tools {stats.calls}/{stats.results}</Text>
        ) : null}
      </Box>
      <PhaseChain phases={view.phases} />
      {reasoningBlocks.length > 0 ? (
        <Box flexDirection="column" marginTop={0}>
          {reasoningBlocks.map((block, i) => (
            <Box key={i}>
              <Text color="gray" dimColor>  │ </Text>
              <Text color="gray">{block}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
