import React from "react";
import { Box, Text } from "ink";
import type { OrCodeConfig } from "../../config.js";
import { compactLine } from "./text-utils.js";

export type NoticeTone = "info" | "warning" | "error";

export type NoticeBannerProps = {
  tone: NoticeTone;
  text: string;
  columns: number;
};

export function NoticeBanner(props: NoticeBannerProps): React.ReactElement {
  const color = props.tone === "error" ? "red" : props.tone === "warning" ? "yellow" : "cyan";
  const symbol = props.tone === "error" ? "✖" : props.tone === "warning" ? "⚠" : "ℹ";
  return (
    <Box>
      <Text color={color}>{symbol} {compactLine(props.text, Math.max(40, props.columns - 4))}</Text>
    </Box>
  );
}

export type ProblemBannerProps = {
  message: string;
  mode: OrCodeConfig["permissionMode"];
  columns: number;
};

export function ProblemBanner(props: ProblemBannerProps): React.ReactElement {
  const recovery =
    props.mode === "plan"
      ? "Plan mode is read-only. /mode bypass to skip approvals."
      : props.mode === "bypass"
        ? "Bypass active — execution or workspace error, not a permission prompt."
        : "/mode bypass to allow workspace tools without prompts, /doctor for env checks.";

  return (
    <Box flexDirection="column">
      <Text color="red">✖ {compactLine(props.message, Math.max(40, props.columns - 4))}</Text>
      <Text color="gray">  {recovery}</Text>
    </Box>
  );
}

export function BypassBanner(): React.ReactElement {
  return (
    <Box>
      <Text color="yellow" bold>⚠ BYPASS</Text>
      <Text color="yellow"> permissions enabled — workspace writes/shell run without approval</Text>
    </Box>
  );
}
