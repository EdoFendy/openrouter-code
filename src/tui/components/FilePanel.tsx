import React from "react";
import { Box, Text } from "ink";
import { clampPreview } from "./text-utils.js";

export type FilePanelProps = {
  tool: "Write" | "Edit";
  path: string;
  preview: string;
  lines?: number | undefined;
  columns: number;
};

export function FilePanel(props: FilePanelProps): React.ReactElement {
  const isWrite = props.tool === "Write";
  const color = isWrite ? "green" : "cyan";
  const verb = isWrite ? "writing" : "editing";
  const lineBudget = Math.max(20, props.columns - 6);
  const { body, hiddenLines } = clampPreview(props.preview, 6, lineBudget);
  const previewLines = body.split("\n");

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box>
        <Text color={color} bold>{verb}</Text>
        <Text color="gray"> · </Text>
        <Text color="white" bold>{props.path}</Text>
      </Box>
      {previewLines.map((line, i) => (
        <Text key={i} color="gray">{line || " "}</Text>
      ))}
      {hiddenLines > 0 ? (
        <Text color="gray">  …{hiddenLines} more line{hiddenLines === 1 ? "" : "s"}</Text>
      ) : null}
      {props.lines !== undefined ? (
        <Text color={color} bold>  {props.lines > 0 ? `+${props.lines}` : `${props.lines}`} lines</Text>
      ) : null}
    </Box>
  );
}
