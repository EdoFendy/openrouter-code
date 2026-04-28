import React from "react";
import { Box, Text } from "ink";
import type { OrCodeConfig } from "../../config.js";
import { tailPath, tailToken } from "./text-utils.js";

export type HeaderProps = {
  cwd: string;
  config: OrCodeConfig;
  sessionId: string;
  columns: number;
  splash?: boolean;
};

export function Header(props: HeaderProps): React.ReactElement {
  const budget = Math.max(40, props.columns - 2);
  const sess = tailToken(props.sessionId, 8);
  const model = tailToken(props.config.defaultModel, 28);
  const cwdBudget = Math.max(12, budget - 24 - model.length - sess.length);
  const cwd = tailPath(props.cwd, cwdBudget);

  if (props.splash) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan" bold>{"   ██████╗ ██████╗ "}</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{"  ██╔═══██╗██╔══██╗   "}</Text>
          <Text bold>or-code</Text>
          <Text color="gray"> v0.1.0</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{"  ██║   ██║██████╔╝   "}</Text>
          <Text color="gray">OpenRouter · agentic CLI</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{"  ██║   ██║██╔══██╗   "}</Text>
          <Text color="cyan">{model}</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{"  ╚██████╔╝██║  ██║   "}</Text>
          <Text color="gray">{cwd} · {sess}</Text>
        </Box>
        <Box>
          <Text color="cyan" bold>{"   ╚═════╝ ╚═╝  ╚═╝"}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="cyan" bold>▗▘ </Text>
      <Text bold>or-code</Text>
      <Text color="gray"> · </Text>
      <Text color="cyan">{model}</Text>
      <Text color="gray"> · </Text>
      <Text color="gray">{cwd}</Text>
      <Text color="gray"> · </Text>
      <Text color="gray">{sess}</Text>
    </Box>
  );
}
