import React from "react";
import { Box, Text } from "ink";
import { clampPreview } from "./text-utils.js";

export type PreviewProps = {
  preview: string;
  pendingApprovalCount: number;
  columns: number;
};

export function Preview(props: PreviewProps): React.ReactElement {
  const maxLines = 18;
  const lineBudget = Math.max(40, props.columns - 4);
  const { body, hiddenLines } = clampPreview(props.preview, maxLines, lineBudget);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text color="cyan" bold>preview</Text>
        {props.pendingApprovalCount > 0 ? (
          <Text color="yellow"> · {props.pendingApprovalCount} pending</Text>
        ) : null}
      </Box>
      <Text color="gray">{body}</Text>
      {hiddenLines > 0 ? <Text color="gray">+ {hiddenLines} more line{hiddenLines === 1 ? "" : "s"}</Text> : null}
    </Box>
  );
}
