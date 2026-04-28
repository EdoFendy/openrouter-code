import React from "react";
import { Box, Text } from "ink";
import type { ReasoningStep } from "../../runtime/agent-events.js";

export type PhaseChainProps = {
  phases: ReasoningStep[];
};

export function PhaseChain(props: PhaseChainProps): React.ReactElement {
  return (
    <Box>
      {props.phases.map((phase, idx) => {
        const glyph = phaseGlyph(phase.status);
        const color = phase.status === "active" ? "cyan" : phase.status === "done" ? "green" : phase.status === "blocked" ? "yellow" : "gray";
        const bold = phase.status === "active";
        return (
          <React.Fragment key={phase.id}>
            <Text color={color} {...(bold ? { bold: true } : {})}>{glyph} {phase.id}</Text>
            {idx < props.phases.length - 1 ? <Text color="gray"> → </Text> : null}
          </React.Fragment>
        );
      })}
    </Box>
  );
}

function phaseGlyph(status: ReasoningStep["status"]): string {
  switch (status) {
    case "active":
      return "●";
    case "done":
      return "✓";
    case "blocked":
      return "⊘";
    case "pending":
    default:
      return "◌";
  }
}
