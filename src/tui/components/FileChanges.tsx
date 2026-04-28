import React from "react";
import { Box, Text } from "ink";

export type FileChangeAction = "created" | "edited" | "shell" | "denied" | "error";

export type FileChange = {
  path: string;
  action: FileChangeAction;
  bytes?: number;
};

export type FileChangesProps = {
  files: FileChange[];
  columns: number;
  compact?: boolean;
};

export function FileChanges(props: FileChangesProps): React.ReactElement | null {
  if (props.files.length === 0) {
    return null;
  }

  const created = props.files.filter((file) => file.action === "created").length;
  const edited = props.files.filter((file) => file.action === "edited").length;
  const errors = props.files.filter((file) => file.action === "error" || file.action === "denied").length;

  const summaryParts: { label: string; color: string }[] = [];
  if (created > 0) {
    summaryParts.push({ label: `${created} created`, color: "green" });
  }
  if (edited > 0) {
    summaryParts.push({ label: `${edited} edited`, color: "cyan" });
  }
  if (errors > 0) {
    summaryParts.push({ label: `${errors} failed`, color: "red" });
  }

  const display = props.compact ? props.files.slice(-3) : props.files.slice(-6);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text color="white" bold>files </Text>
        <Text color="gray">({props.files.length}) </Text>
        {summaryParts.map((part, idx) => (
          <React.Fragment key={part.label}>
            {idx > 0 ? <Text color="gray"> · </Text> : null}
            <Text color={part.color}>{part.label}</Text>
          </React.Fragment>
        ))}
      </Box>
      {display.map((file) => {
        const glyph = file.action === "created" ? "+" : file.action === "edited" ? "~" : file.action === "shell" ? "$" : file.action === "denied" ? "⊘" : "✗";
        const color = file.action === "created" ? "green" : file.action === "edited" ? "cyan" : file.action === "shell" ? "magenta" : file.action === "denied" ? "yellow" : "red";
        const sizeStr = file.bytes !== undefined ? formatBytes(file.bytes) : "";
        return (
          <Box key={`${file.action}-${file.path}`}>
            <Text color={color}>{glyph} </Text>
            <Text>{trim(file.path, Math.max(20, props.columns - 18))}</Text>
            {sizeStr ? <Text color="gray">  · {sizeStr}</Text> : null}
          </Box>
        );
      })}
      {props.files.length > display.length ? (
        <Text color="gray">  + {props.files.length - display.length} earlier</Text>
      ) : null}
    </Box>
  );
}

function trim(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  if (max <= 3) {
    return value.slice(-max);
  }
  return `…${value.slice(-(max - 1))}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
