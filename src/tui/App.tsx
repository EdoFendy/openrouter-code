import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { OrCodeConfig } from "../config.js";
import type { ModelRegistry } from "../openrouter/model-registry.js";
import { AgentRunner, CancelledError } from "../runtime/agent-runner.js";
import { initialRunView, reduceAgentEvent, type AgentRunView } from "../runtime/agent-events.js";
import type { ContextManager } from "../runtime/context-manager.js";
import type { SessionStore } from "../session/session-store.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import { readableError } from "../types.js";
import { handleCommand, isSlashCommand } from "../commands/slash.js";
import { suggestCommands } from "../commands/catalog.js";
import { looksLikeOpenRouterApiKey, redactSecrets } from "../security/secrets.js";
import { isCreateLikePrompt } from "../runtime/workspace-snapshot.js";
import { mapSessionEventsToTranscript } from "../session/transcript-mapper.js";
import type { AgentRegistry } from "../agents/agent-registry.js";
import { SubAgentRunner } from "../agents/sub-agent-runner.js";
import type { AgentRunResultSummary, AgentSpawnRequest } from "../agents/agent-types.js";
import { Header } from "./components/Header.js";
import { StatusBar } from "./components/StatusBar.js";
import { Transcript, type TranscriptItem, type ToolKind, type AgentTranscriptItem } from "./components/Transcript.js";
import { NowLine } from "./components/NowLine.js";
import { Preview } from "./components/Preview.js";
import { NoticeBanner, ProblemBanner, BypassBanner } from "./components/Notice.js";
import { Dock } from "./components/Dock.js";
import { FileChanges, type FileChange } from "./components/FileChanges.js";
import { FilePanel } from "./components/FilePanel.js";
import { useTerminalDimensions } from "./components/use-terminal-dimensions.js";

type Notice = {
  tone: "info" | "warning" | "error";
  text: string;
};

type RuntimeSnapshot = {
  skillsCount: number | undefined;
  skillNames: string[];
  sessionsCount: number | undefined;
};

type RunViewAction = { type: "reset" } | { type: "event"; event: Parameters<typeof reduceAgentEvent>[1] };

export type AppProps = {
  cwd: string;
  initialConfig: OrCodeConfig;
  registry: ModelRegistry;
  sessionStore: SessionStore;
  contextManager: ContextManager;
  skillRegistry: SkillRegistry;
  agentRegistry?: AgentRegistry;
  initialSessionId: string;
  startupNotice?: string;
};

export function App(props: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [config, setConfig] = useState(props.initialConfig);
  const [sessionId, setSessionId] = useState(props.initialSessionId);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [runtime, setRuntime] = useState<RuntimeSnapshot>({ skillsCount: undefined, skillNames: [], sessionsCount: undefined });
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [stateBytes, setStateBytes] = useState<number>(0);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [heapMb, setHeapMb] = useState<number>(0);
  const [activeSkillNames, setActiveSkillNames] = useState<string[]>([]);
  const lastEscAt = useRef<number>(0);
  const currentPrompt = useRef<string>("");
  const lastToolEventAtRef = useRef<number>(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeWriteInfo, setActiveWriteInfo] = useState<{ tool: "Write" | "Edit"; path: string; preview: string; lines?: number } | undefined>(undefined);
  const cursorPosRef = useRef(0);
  const autoStoppedRef = useRef(false);
  const lastProseWarnBucket = useRef(0);
  const lastHeapMbRef = useRef(0);
  const inPasteRef = useRef(false);
  const pasteBufferRef = useRef("");
  const prePasteInputRef = useRef("");
  const prePasteCursorRef = useRef(0);
  const inputRef = useRef("");

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { cursorPosRef.current = cursorPos; }, [cursorPos]);

  useEffect(() => {
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[?2004h");

    const applyPaste = (pasted: string): void => {
      const pre = prePasteInputRef.current;
      const pos = prePasteCursorRef.current;
      const cleaned = pasted.replace(/\r\n|\r/g, "\n");
      setInput(pre.slice(0, pos) + cleaned + pre.slice(pos));
      setCursorPos(pos + cleaned.length);
      setHistoryCursor(undefined);
      setTimeout(() => { inPasteRef.current = false; }, 0);
    };

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (!inPasteRef.current && str.includes("\x1b[200~")) {
        inPasteRef.current = true;
        prePasteInputRef.current = inputRef.current;
        prePasteCursorRef.current = cursorPosRef.current;
        pasteBufferRef.current = "";
        const after = str.slice(str.indexOf("\x1b[200~") + 6);
        if (after.includes("\x1b[201~")) {
          applyPaste(after.slice(0, after.indexOf("\x1b[201~")));
        } else {
          pasteBufferRef.current = after;
        }
        return;
      }
      if (inPasteRef.current) {
        if (str.includes("\x1b[201~")) {
          pasteBufferRef.current += str.slice(0, str.indexOf("\x1b[201~"));
          applyPaste(pasteBufferRef.current);
          pasteBufferRef.current = "";
        } else {
          pasteBufferRef.current += str;
        }
      }
    };

    process.stdin.prependListener("data", onData);
    return () => {
      process.stdout.write("\x1b[?2004l");
      process.stdin.off("data", onData);
    };
  }, []);

  useEffect(() => {
    if (props.startupNotice) {
      setNotice({ tone: "warning", text: props.startupNotice });
    }
  }, [props.startupNotice]);

  useEffect(() => {
    if (transcript.length > MAX_TRANSCRIPT_ITEMS) {
      setTranscript((items) => pruneTranscript(items));
    }
  }, [transcript.length]);
  const [runView, dispatchRunView] = useReducer((state: AgentRunView, action: RunViewAction) => {
    if (action.type === "reset") {
      return initialRunView();
    }

    return reduceAgentEvent(state, action.event);
  }, initialRunView());
  const runner = useMemo(() => new AgentRunner(), []);
  const suggestions = useMemo(() => suggestCommands(input, 8, runtime.skillNames), [input, runtime.skillNames]);
  const dim = useTerminalDimensions();

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [skills, sessions] = await Promise.all([props.skillRegistry.scan(), props.sessionStore.listSessions(100)]);
        if (active) {
          setRuntime({
            skillsCount: skills.length,
            skillNames: skills.map((skill) => skill.name),
            sessionsCount: sessions.length
          });
        }
      } catch (error) {
        if (active) {
          setNotice({ tone: "warning", text: `Runtime scan failed: ${readableError(error)}` });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [props.sessionStore, props.skillRegistry]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const id = setInterval(() => setNowTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const id = setInterval(() => {
      const referenceMs = lastToolEventAtRef.current > 0
        ? lastToolEventAtRef.current
        : runView.startedAt
          ? new Date(runView.startedAt).getTime()
          : 0;
      if (!referenceMs) {
        return;
      }
      const silentMs = Date.now() - referenceMs;
      if (silentMs > 90_000) {
        if (!autoStoppedRef.current) {
          autoStoppedRef.current = true;
          void runner.cancel();
          setTranscript((items) => [
            ...items,
            textItem(
              "system",
              `× run auto-cancelled: ${Math.round(silentMs / 1000)}s without tool progress. Model is stuck on prose loop. Try /reset and a tools-friendly model (claude-sonnet-4-6, gpt-5).`
            )
          ]);
        }
      } else if (silentMs > 45_000) {
        const bucket = Math.floor(silentMs / 15_000);
        if (bucket > lastProseWarnBucket.current) {
          lastProseWarnBucket.current = bucket;
          setNotice({
            tone: "warning",
            text: `No tool progress for ${bucket * 15}s — model in prose loop. Esc Esc to cancel. Auto-cancel at 90s.`
          });
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [running, runView.startedAt, runner]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const id = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedMb = Math.round(usage.heapUsed / (1024 * 1024));
      const heapTotalMb = Math.round(usage.heapTotal / (1024 * 1024));
      setHeapMb(heapUsedMb);
      const ratio = usage.heapUsed / Math.max(1, usage.heapTotal);
      if (heapUsedMb > 1500 || ratio > 0.9) {
        if (!autoStoppedRef.current) {
          autoStoppedRef.current = true;
          void runner.cancel();
          setTranscript((items) => [
            ...items,
            textItem(
              "system",
              `× run auto-cancelled: heap pressure ${heapUsedMb}MB / ${heapTotalMb}MB. Restart with /reset, or use NODE_OPTIONS=--max-old-space-size=4096.`
            )
          ]);
        }
      } else if (heapUsedMb > 1000 || ratio > 0.75) {
        if (Math.abs(heapUsedMb - lastHeapMbRef.current) >= 10) {
          lastHeapMbRef.current = heapUsedMb;
          setNotice({
            tone: "warning",
            text: `Heap pressure: ${heapUsedMb}MB / ${heapTotalMb}MB (${Math.round(ratio * 100)}%). Run will auto-cancel above 1.5GB.`
          });
        }
      }
    }, 4000);
    return () => clearInterval(id);
  }, [running, runner]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const statePath = props.sessionStore.statePath(sessionId);
        const fs = await import("node:fs/promises");
        const stat = await fs.stat(statePath).catch(() => undefined);
        if (!cancelled) {
          setStateBytes(stat ? stat.size : 0);
        }
      } catch {
        if (!cancelled) {
          setStateBytes(0);
        }
      }
    };

    void refresh();
    const id = setInterval(() => void refresh(), running ? 2000 : 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [props.sessionStore, sessionId, running]);

  async function spawnAgentTopLevel(request: AgentSpawnRequest): Promise<AgentRunResultSummary> {
    if (!props.agentRegistry) {
      throw new Error("Agent registry non disponibile.");
    }

    const agentRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sourceFromName = request.name ? "manifest" : "ad-hoc";
    const initialItem: TranscriptItem = {
      kind: "agent",
      agentRunId,
      agentName: request.name ?? `ad-hoc:${(request.role ?? "agent").slice(0, 24)}`,
      modelUsed: request.model ?? config.defaultModel,
      source: sourceFromName,
      status: "running",
      steps: 0,
      subLog: [],
      createdAt: nowIso()
    };
    setTranscript((items) => [...items, initialItem]);

    const updateItem = (updater: (item: AgentTranscriptItem) => AgentTranscriptItem): void => {
      setTranscript((items) =>
        items.map((entry) =>
          entry.kind === "agent" && entry.agentRunId === agentRunId ? updater(entry) : entry
        )
      );
    };

    const subRunner = new SubAgentRunner({
      parentSessionId: sessionId,
      parentChain: [],
      parentDepth: 0,
      parentConfig: config,
      parentModel: config.defaultModel,
      parentSkillNames: activeSkillNames,
      agentRegistry: props.agentRegistry,
      skillRegistry: props.skillRegistry,
      modelRegistry: props.registry,
      sessionStore: props.sessionStore,
      onSubAgentEvent: async (sub, event) => {
        if (event.type === "tool.result") {
          const tool = event.tool;
          const path = typeof event.payload.path === "string" ? event.payload.path : "";
          const command = typeof event.payload.command === "string" ? event.payload.command : "";
          const detail = path || command || `${tool} result`;
          const glyph = tool === "Write" ? "+" : tool === "Edit" ? "~" : tool === "Shell" ? "$" : "▸";
          const color = tool === "Write" ? "green" : tool === "Edit" ? "cyan" : tool === "Shell" ? "magenta" : "gray";
          updateItem((item) => ({ ...item, subLog: [...item.subLog, { glyph, color, text: `${tool} ${detail}` }].slice(-30) }));
        } else if (event.type === "tool.error" || event.type === "tool.denied") {
          const tool = event.tool;
          const detail = typeof event.payload.path === "string" ? event.payload.path : (typeof event.payload.command === "string" ? event.payload.command : tool);
          const glyph = event.type === "tool.denied" ? "⊘" : "✗";
          const color = event.type === "tool.denied" ? "yellow" : "red";
          updateItem((item) => ({ ...item, subLog: [...item.subLog, { glyph, color, text: `${tool} ${detail}` }].slice(-30) }));
        } else if (event.type === "turn.completed") {
          updateItem((item) => ({ ...item, steps: item.steps + 1 }));
        } else if (event.type === "run.failed") {
          updateItem((item) => ({ ...item, status: "error", errorMessage: event.message }));
        }
      }
    });

    try {
      const summary = await subRunner.spawn(request);
      updateItem((item) => ({
        ...item,
        agentName: summary.agentName,
        modelUsed: summary.modelUsed,
        status: "ok",
        steps: summary.steps || item.steps,
        durationMs: summary.durationMs,
        costUsd: summary.cost.estimatedUsd,
        toolStats: summary.toolStats,
        finalText: summary.text
      }));
      return summary;
    } catch (error) {
      const message = readableError(error);
      updateItem((item) => ({ ...item, status: "error", errorMessage: message }));
      throw error;
    }
  }

  function commandFromNaturalLanguage(value: string): string | undefined {
    const githubUrl = value.match(/https:\/\/github\.com\/[^\s]+/)?.[0];
    if (!githubUrl) {
      return undefined;
    }

    if (/\b(installa|install|aggiungi|add)\b/i.test(value) && /\b(skill|skills)\b/i.test(value)) {
      return `/skills install ${githubUrl}`;
    }

    return undefined;
  }

  function pushHistory(value: string): void {
    setHistory((current) => {
      const next = current.at(-1) === value ? current : [...current, value];
      return next.slice(-80);
    });
    setHistoryCursor(undefined);
  }

  function recallHistory(direction: "previous" | "next"): void {
    if (history.length === 0) {
      setNotice({ tone: "info", text: "No input history in this TUI session." });
      return;
    }

    const nextCursor =
      direction === "previous"
        ? historyCursor === undefined
          ? history.length - 1
          : Math.max(0, historyCursor - 1)
        : historyCursor === undefined
          ? undefined
          : historyCursor + 1 >= history.length
            ? undefined
            : historyCursor + 1;

    const recalled = nextCursor === undefined ? "" : history[nextCursor] ?? "";
    setHistoryCursor(nextCursor);
    setInput(recalled);
    setCursorPos(recalled.length);
    setNotice(undefined);
  }

  async function submit(value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (running) {
      setNotice({ tone: "warning", text: "Run already in progress. Draft preserved; submit when the agent is idle." });
      return;
    }

    setNotice(undefined);
    setInput("");
    setCursorPos(0);
    setScrollOffset(0);
    setActiveWriteInfo(undefined);
    autoStoppedRef.current = false;
    lastProseWarnBucket.current = 0;
    lastHeapMbRef.current = 0;
    pushHistory(trimmed);
    currentPrompt.current = trimmed;
    setTranscript((items) => [...items, textItem("user", redactSecrets(trimmed))]);
    setFileChanges([]);
    dispatchRunView({ type: "reset" });
    lastToolEventAtRef.current = Date.now();
    setRunning(true);

    let pendingAssistantDelta = "";
    let pendingReasoningDelta = "";
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flushDeltas = (): void => {
      if (pendingAssistantDelta) {
        dispatchRunView({ type: "event", event: { type: "assistant.delta", delta: pendingAssistantDelta, createdAt: nowIso() } });
        pendingAssistantDelta = "";
      }
      if (pendingReasoningDelta) {
        dispatchRunView({ type: "event", event: { type: "reasoning.delta", delta: pendingReasoningDelta, createdAt: nowIso() } });
        pendingReasoningDelta = "";
      }
      flushTimer = undefined;
    };
    const scheduleFlush = (): void => {
      if (!flushTimer) {
        flushTimer = setTimeout(flushDeltas, 100);
      }
    };

    try {
      if (looksLikeOpenRouterApiKey(trimmed)) {
        setTranscript((items) => [
          ...items,
          textItem(
            "system",
            "Sembra una OPENROUTER_API_KEY. Non l'ho inviata al modello. Usa /login <key>, export OPENROUTER_API_KEY=..., oppure mettila in .env."
          )
        ]);
        return;
      }

      const detectedCommand = isSlashCommand(trimmed) ? trimmed : commandFromNaturalLanguage(trimmed);
      if (detectedCommand) {
        const result = await handleCommand(detectedCommand, {
          cwd: props.cwd,
          config,
          registry: props.registry,
          sessionStore: props.sessionStore,
          contextManager: props.contextManager,
          skillRegistry: props.skillRegistry,
          sessionId,
          setSessionId,
          setModel: (model) => setConfig((current) => ({ ...current, defaultModel: model })),
          setApiKey: (apiKey) => setConfig((current) => ({ ...current, apiKey })),
          setConfigPatch: (patch) => setConfig((current) => ({ ...current, ...patch })),
          loadSessionTranscript: async (sid) => {
            const events = await props.sessionStore.read(sid);
            const restored = mapSessionEventsToTranscript(events);
            setTranscript(restored);
            setFileChanges([]);
            setScrollOffset(0);
            return restored.length;
          },
          activateSkillByName: async (name) => {
            try {
              await props.skillRegistry.load(name);
              setActiveSkillNames((current) => (current.includes(name) ? current : [...current, name]));
              return true;
            } catch {
              return false;
            }
          },
          ...(props.agentRegistry ? { agentRegistry: props.agentRegistry } : {}),
          spawnAgentByName: async (name, prompt) => {
            if (!props.agentRegistry) {
              return { ok: false, output: "Agent registry non disponibile." };
            }
            try {
              const summary = await spawnAgentTopLevel({ name, prompt });
              return { ok: true, output: `▣ Spawned ${summary.agentName} · ${summary.modelUsed} · ${summary.steps} steps · ${(summary.durationMs / 1000).toFixed(1)}s\n\n${summary.text}` };
            } catch (error) {
              return { ok: false, output: readableError(error) };
            }
          }
        });
        const item = textItem("system", result.output);
        if (/^\/(?:clear|new|reset)\b/.test(detectedCommand)) {
          setTranscript([item]);
          setFileChanges([]);
          setActiveSkillNames([]);
        } else {
          setTranscript((items) => [...items, item]);
        }
        return;
      }

      const skills = await props.skillRegistry.scan();
      setRuntime((current) => ({
        ...current,
        skillsCount: skills.length,
        skillNames: skills.map((skill) => skill.name)
      }));
      const modelCapability = await props.registry.findById(config.defaultModel, config.apiKey ? { apiKey: config.apiKey } : {});
      if (!modelCapability) {
        setNotice({ tone: "warning", text: `Model metadata not found for ${config.defaultModel}. Continuing with provider defaults.` });
      } else if (modelCapability.supportsTools === false) {
        setNotice({
          tone: "warning",
          text: `${config.defaultModel} non supporta tool calling. File creation/edit non funzioneranno. Cambia con /model <id> (es. anthropic/claude-sonnet-4-6).`
        });
      }
      const localStats = { writes: 0, edits: 0, shells: 0, anyTool: 0 };
      const seenPreviewKeys = new Set<string>();
      const loadedActiveSkills = await Promise.all(
        activeSkillNames.map((name) =>
          props.skillRegistry.load(name).catch(() => undefined)
        )
      );
      const activeSkills = loadedActiveSkills.filter((skill): skill is NonNullable<typeof skill> => skill !== undefined);
      const result = await runner.runStreaming(trimmed, {
        config,
        sessionStore: props.sessionStore,
        sessionId,
        availableSkills: skills,
        activeSkills,
        skillRegistry: props.skillRegistry,
        ...(props.agentRegistry ? { agentRegistry: props.agentRegistry, spawnAgent: spawnAgentTopLevel } : {}),
        ...(modelCapability ? { modelCapability } : {}),
        onEvent: (event) => {
          if (event.type === "assistant.delta") {
            pendingAssistantDelta += event.delta;
            scheduleFlush();
            return;
          }
          if (event.type === "reasoning.delta") {
            pendingReasoningDelta += event.delta;
            scheduleFlush();
            return;
          }

          if (pendingAssistantDelta || pendingReasoningDelta) {
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = undefined;
            }
            flushDeltas();
          }

          dispatchRunView({ type: "event", event });

          if (
            event.type === "tool.result" ||
            event.type === "tool.error" ||
            event.type === "tool.denied" ||
            event.type === "tool.preview" ||
            event.type === "tool.call"
          ) {
            lastToolEventAtRef.current = Date.now();
          }

          if (event.type === "tool.result" || event.type === "tool.error" || event.type === "tool.denied") {
            if (event.type === "tool.result" && event.tool === "Skill") {
              const skillName = stringPayload(event.payload, "name") ?? "skill";
              const skillDescription = stringPayload(event.payload, "description") ?? "";
              const skillBytes = numberPayload(event.payload, "bytes");
              const skillItem: TranscriptItem = {
                kind: "tool",
                toolKind: "skill",
                tool: "Skill",
                detail: skillName,
                status: "ok",
                ...(skillDescription ? { bashIn: skillDescription } : {}),
                ...(skillBytes !== undefined ? { bytes: skillBytes } : {}),
                createdAt: nowIso()
              };
              setTranscript((items) => [...items, skillItem]);
              return;
            }

            if (event.type === "tool.result" && event.tool === "Todos") {
              const todosPayload = event.payload as { items?: unknown };
              const rawItems = Array.isArray(todosPayload.items) ? todosPayload.items : [];
              const todoEntries = rawItems
                .map((entry) => {
                  if (entry && typeof entry === "object") {
                    const e = entry as { content?: unknown; status?: unknown };
                    const content = typeof e.content === "string" ? e.content : "";
                    const status = e.status === "in_progress" ? "in_progress" : e.status === "completed" ? "completed" : "pending";
                    return content ? { content, status: status as "pending" | "in_progress" | "completed" } : undefined;
                  }
                  return undefined;
                })
                .filter((entry): entry is { content: string; status: "pending" | "in_progress" | "completed" } => entry !== undefined);

              const todosItem: TranscriptItem = { kind: "todos", items: todoEntries, createdAt: nowIso() };
              setTranscript((items) => {
                const lastIdx = findLastTodoIndex(items);
                if (lastIdx >= 0) {
                  const next = [...items];
                  next[lastIdx] = todosItem;
                  return next;
                }
                return [...items, todosItem];
              });
              return;
            }

            const status: "ok" | "error" | "denied" = event.type === "tool.result" ? "ok" : event.type === "tool.denied" ? "denied" : "error";
            const path = stringPayload(event.payload, "path");
            const command = stringPayload(event.payload, "command");
            const bytes = numberPayload(event.payload, "bytes");
            const lines = numberPayload(event.payload, "lines");
            const replacements = numberPayload(event.payload, "replacements");
            const linesDelta = numberPayload(event.payload, "linesDelta");
            const matches = numberPayload(event.payload, "count");
            const exitCode = numberPayload(event.payload, "exitCode");
            const stdout = stringPayload(event.payload, "stdout");
            const modeRaw = stringPayload(event.payload, "mode");
            const actionRaw = stringPayload(event.payload, "action");

            const detailFor = path ?? command ?? summarizeToolPayload(event.payload);
            const item: TranscriptItem = {
              kind: "tool",
              toolKind: classifyTool(event.tool),
              tool: event.tool,
              detail: detailFor,
              status,
              ...(bytes !== undefined ? { bytes } : {}),
              ...(lines !== undefined ? { lines } : {}),
              ...(replacements !== undefined ? { replacements } : {}),
              ...(linesDelta !== undefined ? { linesDelta } : {}),
              ...(matches !== undefined ? { matches } : {}),
              ...(exitCode !== undefined && exitCode !== null ? { exitCode } : {}),
              ...(modeRaw === "create" || modeRaw === "overwrite" ? { mode: modeRaw } : {}),
              ...(actionRaw === "added" || actionRaw === "removed" || actionRaw === "modified" ? { action: actionRaw } : {}),
              ...(event.tool === "Shell" && command ? { bashIn: command } : {}),
              ...(event.tool === "Shell" && stdout ? { bashOut: stdout } : {}),
              createdAt: nowIso()
            };
            setTranscript((items) => [...items, item]);

            if (event.type === "tool.result") {
              localStats.anyTool += 1;
              if (event.tool === "Write") {
                localStats.writes += 1;
                setActiveWriteInfo((prev) => prev ? { ...prev, ...(lines !== undefined ? { lines } : {}) } : undefined);
                if (path) {
                  setFileChanges((current) => mergeChange(current, { path, action: "created", ...(bytes !== undefined ? { bytes } : {}) }));
                }
              } else if (event.tool === "Edit") {
                localStats.edits += 1;
                setActiveWriteInfo((prev) => prev ? { ...prev, ...(lines !== undefined ? { lines } : {}) } : undefined);
                if (path) {
                  setFileChanges((current) => mergeChange(current, { path, action: "edited", ...(bytes !== undefined ? { bytes } : {}) }));
                }
              } else if (event.tool === "Shell") {
                localStats.shells += 1;
                setActiveWriteInfo(undefined);
                if (command) {
                  setFileChanges((current) => mergeChange(current, { path: command.slice(0, 80), action: "shell" }));
                }
              } else {
                setActiveWriteInfo(undefined);
              }
            } else if (event.type === "tool.error" || event.type === "tool.denied") {
              if (event.tool === "Write" || event.tool === "Edit") {
                setActiveWriteInfo(undefined);
              }
              if (path) {
                setFileChanges((current) =>
                  mergeChange(current, {
                    path,
                    action: event.type === "tool.denied" ? "denied" : "error"
                  })
                );
              }
            }
          } else if (event.type === "tool.preview") {
            const path = stringPayload(event.payload, "path") ?? "";
            const previewText = typeof event.payload.preview === "string" ? event.payload.preview : "";
            if ((event.tool === "Write" || event.tool === "Edit") && path) {
              setActiveWriteInfo({ tool: event.tool as "Write" | "Edit", path, preview: previewText });
            }
            const key = `${event.tool}:${path}`;
            if (seenPreviewKeys.has(key)) {
              return;
            }
            seenPreviewKeys.add(key);
            const item: TranscriptItem = {
              kind: "tool",
              toolKind: classifyTool(event.tool),
              tool: event.tool,
              detail: path || summarizeToolPayload(event.payload),
              status: "preview",
              createdAt: nowIso()
            };
            setTranscript((items) => [...items, item]);
          }
        }
      });
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      flushDeltas();

      const approvalText =
        result.requiresApproval && result.pendingToolCalls.length > 0
          ? `\n\nPending approvals:\n${result.pendingToolCalls.map((call) => `- ${call.name} ${call.id}`).join("\n")}`
          : "";
      setTranscript((items) => [...items, textItem("assistant", `${result.text}${approvalText}`)]);

      if (isCreateLikePrompt(currentPrompt.current) && localStats.writes === 0 && localStats.edits === 0) {
        setNotice({
          tone: "warning",
          text: `Modello non ha creato/modificato file (Write=0, Edit=0, Shell=${localStats.shells}). Cambia con /model anthropic/claude-sonnet-4-6 o openai/gpt-5 e riprova.`
        });
      }
    } catch (error) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (error instanceof CancelledError) {
        // already surfaced via the cancel banner / transcript line
      } else {
        const message = readableError(error);
        setNotice({ tone: "error", text: message });
        setTranscript((items) => [...items, textItem("error", message)]);
      }
    } finally {
      setRunning(false);
      setActiveWriteInfo(undefined);
    }
  }

  useInput((value, key) => {
    if (inPasteRef.current) return;

    if (key.ctrl && value === "c") {
      exit();
      return;
    }

    if (key.ctrl && value === "u") {
      setInput("");
      setCursorPos(0);
      setHistoryCursor(undefined);
      setNotice(undefined);
      return;
    }

    if (key.ctrl && value === "a") {
      setCursorPos(0);
      return;
    }

    if (key.ctrl && value === "e") {
      setCursorPos(inputRef.current.length);
      return;
    }

    if (key.ctrl && value === "k") {
      const pos = cursorPosRef.current;
      setInput((current) => current.slice(0, pos));
      setHistoryCursor(undefined);
      return;
    }

    if (key.ctrl && value === "w") {
      const pos = cursorPosRef.current;
      const current = inputRef.current;
      if (pos === 0) return;
      let newPos = pos;
      while (newPos > 0 && current[newPos - 1] === " ") newPos--;
      while (newPos > 0 && current[newPos - 1] !== " ") newPos--;
      setInput(current.slice(0, newPos) + current.slice(pos));
      setCursorPos(newPos);
      setHistoryCursor(undefined);
      return;
    }

    if (key.ctrl && value === "p") {
      recallHistory("previous");
      return;
    }

    if (key.ctrl && value === "n") {
      recallHistory("next");
      return;
    }

    if (key.escape) {
      const now = Date.now();
      if (running && now - lastEscAt.current < 1500) {
        lastEscAt.current = 0;
        void runner.cancel();
        setTranscript((items) => [...items, textItem("system", "× run cancelled by user (Esc Esc)")]);
        setNotice({ tone: "warning", text: "Run cancelled. Draft preserved." });
        return;
      }
      lastEscAt.current = now;
      if (!running) {
        setInput("");
        setCursorPos(0);
        setHistoryCursor(undefined);
        setNotice(undefined);
      } else {
        setNotice({ tone: "info", text: "Press Esc again within 1.5s to cancel the running model." });
      }
      return;
    }

    if (key.home) {
      setCursorPos(0);
      return;
    }

    if (key.end) {
      setCursorPos(inputRef.current.length);
      return;
    }

    if (key.upArrow) {
      setScrollOffset((current) => current + 3);
      return;
    }

    if (key.downArrow) {
      setScrollOffset((current) => Math.max(0, current - 3));
      return;
    }

    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPos((p) => Math.min(inputRef.current.length, p + 1));
      return;
    }

    if (key.pageUp) {
      setScrollOffset((current) => current + Math.max(4, transcriptRows - 2));
      return;
    }

    if (key.pageDown) {
      setScrollOffset((current) => Math.max(0, current - Math.max(4, transcriptRows - 2)));
      return;
    }

    if (key.tab && suggestions[0]) {
      const completed = `/${suggestions[0].name} `;
      setInput(completed);
      setCursorPos(completed.length);
      setHistoryCursor(undefined);
      setNotice(undefined);
      return;
    }

    if (key.return) {
      void submit(input);
      return;
    }

    if (key.backspace) {
      const pos = cursorPosRef.current;
      if (pos === 0) return;
      setInput((current) => current.slice(0, pos - 1) + current.slice(pos));
      setCursorPos(pos - 1);
      setHistoryCursor(undefined);
      setNotice(undefined);
      return;
    }

    if (key.delete) {
      const pos = cursorPosRef.current;
      setInput((current) => {
        if (pos >= current.length) return current;
        return current.slice(0, pos) + current.slice(pos + 1);
      });
      setHistoryCursor(undefined);
      setNotice(undefined);
      return;
    }

    if (value) {
      const pos = cursorPosRef.current;
      setInput((current) => current.slice(0, pos) + value + current.slice(pos));
      setCursorPos(pos + value.length);
      setHistoryCursor(undefined);
      setNotice(undefined);
    }
  });

  const bypass = config.permissionMode === "bypass";
  const compact = dim.rows < 20;
  const showNowLine = runView.status !== "idle";
  const showPreview = Boolean(runView.latestPreview) && !running;
  const showProblem = Boolean(runView.lastError);
  const showNotice = Boolean(notice);
  const showPalette = input.trim().startsWith("/") && suggestions.length > 0;

  const fileChangesRows = fileChanges.length > 0 ? Math.min(8, 2 + Math.min(6, fileChanges.length)) : 0;
  const activeWriteRows = activeWriteInfo && running
    ? Math.min(10, 3 + Math.min(6, activeWriteInfo.preview.split("\n").length))
    : 0;
  const reasoningRows = running && runView.reasoning
    ? Math.min(2, runView.reasoning.split(/\n\n+/).filter((b) => b.trim().length > 0).length)
    : 0;
  const splashHeader = transcript.length === 0 && !running;
  const splashRows = splashHeader ? 6 : 1;
  const reservedRows =
    splashRows /* header */ +
    1 /* statusbar */ +
    (bypass && !compact ? 1 : 0) +
    (showNowLine ? 2 + reasoningRows : 0) /* spinner + phases + reasoning */ +
    activeWriteRows +
    fileChangesRows +
    (showPreview ? Math.min(20, 6) : 0) +
    (showProblem ? 2 : 0) +
    (showNotice ? 1 : 0) +
    (showPalette ? Math.min(suggestions.length + 2, 10) : 0) +
    3 /* dock: separator + hint + input */;

  const transcriptRows = Math.max(4, dim.rows - reservedRows - 1);

  return (
    <Box flexDirection="column" width={dim.columns}>
      <Header
        cwd={props.cwd}
        config={config}
        sessionId={sessionId}
        columns={dim.columns}
        splash={transcript.length === 0 && !running}
      />
      <StatusBar
        config={config}
        runView={runView}
        running={running}
        hasApiKey={Boolean(config.apiKey)}
        skillsCount={runtime.skillsCount}
        sessionsCount={runtime.sessionsCount}
        stateBytes={stateBytes}
        heapMb={heapMb}
      />
      {bypass && !compact ? <BypassBanner /> : null}

      <Box flexDirection="column" marginTop={1}>
        <Transcript
          items={transcript}
          liveAnswer={running ? runView.answer : ""}
          columns={dim.columns}
          maxRows={transcriptRows}
          scrollOffset={scrollOffset}
        />
      </Box>

      {showNowLine ? (
        <Box flexDirection="column" marginTop={1}>
          <NowLine view={runView} columns={dim.columns} tickFrame={nowTick} />
          {activeWriteInfo ? (
            <Box marginTop={1}>
              <FilePanel
                tool={activeWriteInfo.tool}
                path={activeWriteInfo.path}
                preview={activeWriteInfo.preview}
                lines={activeWriteInfo.lines}
                columns={dim.columns}
              />
            </Box>
          ) : null}
          {fileChanges.length > 0 ? (
            <Box marginTop={1}>
              <FileChanges files={fileChanges} columns={dim.columns} compact={compact} />
            </Box>
          ) : null}
        </Box>
      ) : fileChanges.length > 0 ? (
        <Box marginTop={1}>
          <FileChanges files={fileChanges} columns={dim.columns} compact={compact} />
        </Box>
      ) : null}

      {showProblem && runView.lastError ? (
        <Box marginTop={1}>
          <ProblemBanner message={runView.lastError} mode={config.permissionMode} columns={dim.columns} />
        </Box>
      ) : null}

      {showPreview && runView.latestPreview ? (
        <Box marginTop={1}>
          <Preview preview={runView.latestPreview} pendingApprovalCount={runView.pendingApprovalCount} columns={dim.columns} />
        </Box>
      ) : null}

      {showNotice && notice ? (
        <Box marginTop={1}>
          <NoticeBanner tone={notice.tone} text={notice.text} columns={dim.columns} />
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Dock input={input} cursorPos={cursorPos} running={running} hasApiKey={Boolean(config.apiKey)} suggestions={suggestions} columns={dim.columns} />
      </Box>
    </Box>
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function textItem(role: "system" | "user" | "assistant" | "error", text: string): TranscriptItem {
  return { kind: "text", role, text, createdAt: nowIso() };
}

const TOOL_KIND_MAP: Record<string, ToolKind> = {
  Write: "write",
  Edit: "edit",
  Shell: "shell",
  Read: "read",
  ListDir: "list",
  Glob: "search",
  Grep: "search",
  Skill: "skill"
};

function classifyTool(toolName: string): ToolKind {
  return TOOL_KIND_MAP[toolName] ?? "other";
}

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberPayload(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function summarizeToolPayload(payload: Record<string, unknown>): string {
  const command = stringPayload(payload, "command");
  if (command) {
    return command;
  }
  const path = stringPayload(payload, "path");
  if (path) {
    const replacements = numberPayload(payload, "replacements");
    return replacements !== undefined ? `${path} · ${replacements} replacement${replacements === 1 ? "" : "s"}` : path;
  }
  const count = numberPayload(payload, "count");
  if (count !== undefined) {
    return `${count} result${count === 1 ? "" : "s"}`;
  }
  const exitCode = numberPayload(payload, "exitCode");
  if (exitCode !== undefined) {
    return `exit=${exitCode}`;
  }
  const reason = stringPayload(payload, "reason");
  return reason ?? "";
}

function mergeChange(current: FileChange[], next: FileChange): FileChange[] {
  const filtered = current.filter((file) => !(file.path === next.path && file.action === next.action));
  return [...filtered, next].slice(-50);
}

function findLastTodoIndex(items: TranscriptItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "todos") {
      return index;
    }
  }
  return -1;
}

const MAX_TRANSCRIPT_ITEMS = 300;

function pruneTranscript(items: TranscriptItem[]): TranscriptItem[] {
  if (items.length <= MAX_TRANSCRIPT_ITEMS) {
    return items;
  }
  return items.slice(items.length - MAX_TRANSCRIPT_ITEMS);
}
