import { describe, expect, it } from "vitest";
import { LoopDetector, buildSignature } from "../src/runtime/loop-detector.js";

describe("loop detector", () => {
  it("triggers tool_loop after identical tool call repeats", () => {
    const detector = new LoopDetector();
    expect(detector.noteToolCall("Shell", "{\"command\":\"ls\"}")).toBeUndefined();
    expect(detector.noteToolCall("Shell", "{\"command\":\"ls\"}")).toBeUndefined();
    const event = detector.noteToolCall("Shell", "{\"command\":\"ls\"}");
    expect(event?.type).toBe("tool_loop");
    expect(event?.type === "tool_loop" ? event.signature.name : "").toBe("Shell");
  });

  it("does not trigger when tool calls differ", () => {
    const detector = new LoopDetector();
    expect(detector.noteToolCall("Shell", "{\"command\":\"ls\"}")).toBeUndefined();
    expect(detector.noteToolCall("Read", "{\"path\":\"a\"}")).toBeUndefined();
    expect(detector.noteToolCall("Read", "{\"path\":\"b\"}")).toBeUndefined();
    expect(detector.noteToolCall("Write", "{\"path\":\"x\"}")).toBeUndefined();
  });

  it("triggers no_progress when turn ends without tool calls", () => {
    const detector = new LoopDetector();
    detector.noteTurnStart();
    detector.noteAssistantDelta("a".repeat(200));
    const event = detector.noteTurnEnd();
    expect(event?.type).toBe("no_progress");
  });

  it("does not trigger no_progress when turn had tool call", () => {
    const detector = new LoopDetector();
    detector.noteTurnStart();
    detector.noteToolCall("Shell", "{\"command\":\"ls\"}");
    detector.noteAssistantDelta("a".repeat(200));
    expect(detector.noteTurnEnd()).toBeUndefined();
  });

  it("hashes args deterministically", () => {
    const left = buildSignature("Read", "{\"path\":\"foo\"}");
    const right = buildSignature("Read", "{\"path\":\"foo\"}");
    expect(left.argsHash).toBe(right.argsHash);
  });
});
