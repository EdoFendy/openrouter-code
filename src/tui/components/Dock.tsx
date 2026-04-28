import React from "react";
import { Box, Text } from "ink";
import type { CommandSpec } from "../../commands/catalog.js";

export type DockProps = {
  input: string;
  running: boolean;
  hasApiKey: boolean;
  suggestions: CommandSpec[];
  columns: number;
};

export function Dock(props: DockProps): React.ReactElement {
  const promptColor = props.running || !props.hasApiKey ? "gray" : "white";
  const showPalette = props.input.trim().startsWith("/") && props.suggestions.length > 0;

  return (
    <Box flexDirection="column">
      {showPalette ? <Palette suggestions={props.suggestions} columns={props.columns} /> : null}
      <Text color="gray">{"─".repeat(Math.max(20, props.columns))}</Text>
      <HintLine running={props.running} hasApiKey={props.hasApiKey} suggestions={props.suggestions} />
      <Box>
        <Text color={promptColor}>❯ </Text>
        <Text color={promptColor}>{props.input}</Text>
        <Text color="cyan">▌</Text>
      </Box>
    </Box>
  );
}

function Palette(props: { suggestions: CommandSpec[]; columns: number }): React.ReactElement {
  const groups = groupByCategory(props.suggestions);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {groups.map((group) => (
        <Box key={group.category} flexDirection="column">
          <Text color="cyan" bold>{group.category}</Text>
          {group.items.map((spec, index) => (
            <Box key={spec.controlId}>
              <Text color={index === 0 ? "cyan" : "gray"}>{index === 0 ? "›" : " "} </Text>
              <Text color={index === 0 ? "white" : "gray"}>{spec.usage}</Text>
              <Text color="gray">  {spec.summary}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function HintLine(props: { running: boolean; hasApiKey: boolean; suggestions: CommandSpec[] }): React.ReactElement {
  if (!props.hasApiKey) {
    return <Text color="yellow">/login &lt;key&gt; required before model calls</Text>;
  }
  if (props.running) {
    return <Text color="gray">working — Enter held · PgUp/PgDn scroll · <Text color="yellow">Esc Esc cancel run</Text> · Ctrl-C exit</Text>;
  }

  const next = props.suggestions[0];
  if (next) {
    return (
      <Box>
        <Text color="gray">Tab </Text>
        <Text color="cyan">/{next.name}</Text>
        <Text color="gray">  ·  Enter send  ·  ↑↓ history  ·  PgUp/PgDn scroll  ·  Esc clear  ·  Ctrl-C exit</Text>
      </Box>
    );
  }

  return <Text color="gray">Tab complete  ·  Enter send  ·  ↑↓ history  ·  PgUp/PgDn scroll  ·  Esc clear  ·  Ctrl-C exit</Text>;
}

function groupByCategory(specs: CommandSpec[]): { category: string; items: CommandSpec[] }[] {
  const map = new Map<string, CommandSpec[]>();
  for (const spec of specs) {
    const list = map.get(spec.category) ?? [];
    list.push(spec);
    map.set(spec.category, list);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}
