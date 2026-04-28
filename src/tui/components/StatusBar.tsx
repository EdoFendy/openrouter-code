import React from "react";
import { Box, Text } from "ink";
import type { OrCodeConfig } from "../../config.js";
import type { AgentRunView } from "../../runtime/agent-events.js";

export type StatusBarProps = {
  config: OrCodeConfig;
  runView: AgentRunView;
  running: boolean;
  hasApiKey: boolean;
  skillsCount: number | undefined;
  sessionsCount: number | undefined;
  stateBytes: number | undefined;
  heapMb: number | undefined;
};

export function StatusBar(props: StatusBarProps): React.ReactElement {
  const bypass = props.config.permissionMode === "bypass";
  const status = props.running ? "working" : props.runView.status === "idle" ? "ready" : props.runView.status;
  const statusColor = props.runView.status === "error" ? "red" : props.runView.status === "blocked" ? "yellow" : props.running ? "cyan" : bypass ? "yellow" : "green";
  const dot = props.running ? "◐" : "●";
  const skills = props.skillsCount === undefined ? "…" : String(props.skillsCount);
  const sessions = props.sessionsCount === undefined ? "…" : String(props.sessionsCount);
  const elapsed = props.running ? computeElapsed(props.runView.startedAt) : undefined;
  const elapsedColor = !elapsed ? "gray" : elapsed.seconds > 120 ? "red" : elapsed.seconds > 30 ? "yellow" : "gray";
  const silent = props.running ? computeElapsed(props.runView.updatedAt ?? props.runView.startedAt) : undefined;
  const showSilent = silent && silent.seconds > 30;
  const silentColor = silent && silent.seconds > 120 ? "red" : "yellow";
  const stats = props.runView.toolStats;
  const stateBytes = props.stateBytes ?? 0;
  const stateLabel = formatStateBytes(stateBytes);
  const stateColor = stateBytes >= 300 * 1024 ? "red" : stateBytes >= 100 * 1024 ? "yellow" : "gray";

  return (
    <Box>
      <Text color={statusColor}>{dot} </Text>
      <Text color={statusColor}>{status}</Text>
      {elapsed ? (
        <>
          <Text color="gray"> </Text>
          <Text color={elapsedColor}>{elapsed.label}</Text>
        </>
      ) : null}
      <Text color="gray"> │ </Text>
      <Text color={bypass ? "yellow" : "gray"}>{props.config.permissionMode}</Text>
      <Text color="gray"> │ </Text>
      <Text color="gray">{skills}sk · {sessions}ses</Text>
      {stateLabel ? (
        <>
          <Text color="gray"> · </Text>
          <Text color={stateColor}>{stateLabel}</Text>
        </>
      ) : null}
      {props.heapMb && props.heapMb > 0 ? (
        <>
          <Text color="gray"> · </Text>
          <Text color={props.heapMb > 1500 ? "red" : props.heapMb > 1000 ? "yellow" : "gray"}>heap {props.heapMb}MB</Text>
        </>
      ) : null}
      {props.running && (stats.writes > 0 || stats.edits > 0 || stats.shells > 0) ? (
        <>
          <Text color="gray"> │ </Text>
          <Text color="cyan">w{stats.writes}/e{stats.edits}/s{stats.shells}</Text>
        </>
      ) : null}
      {showSilent && silent ? (
        <>
          <Text color="gray"> │ </Text>
          <Text color={silentColor}>silent {silent.label}</Text>
        </>
      ) : null}
      {!props.hasApiKey ? (
        <>
          <Text color="gray"> │ </Text>
          <Text color="red">no API key</Text>
        </>
      ) : null}
    </Box>
  );
}

function formatStateBytes(bytes: number): string {
  if (bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `state ${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `state ${(bytes / 1024).toFixed(0)}KB`;
  }
  return `state ${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function computeElapsed(startedAt: string | undefined): { seconds: number; label: string } | undefined {
  if (!startedAt) {
    return undefined;
  }
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return undefined;
  }
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return { seconds, label: `${seconds}s` };
  }
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return { seconds, label: `${minutes}m${rem.toString().padStart(2, "0")}s` };
}
