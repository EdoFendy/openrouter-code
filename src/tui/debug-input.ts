import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let stream: fs.WriteStream | undefined;
let enabled = false;

const ESC_RE = new RegExp(String.fromCharCode(27), "g");
const CTRL_RE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]", "g");

export function isDebugInputEnabled(): boolean {
  return enabled;
}

export function initDebugInput(): string | undefined {
  if (process.env["OR_CODE_DEBUG_INPUT"] !== "1") return undefined;
  enabled = true;
  const dir = path.join(os.homedir(), ".orcode");
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "keypress.log");
  stream = fs.createWriteStream(logPath, { flags: "a" });
  const stdin = process.stdin;
  const stdout = process.stdout;
  log(`\n=== ${new Date().toISOString()} ===`);
  log(`platform=${process.platform} arch=${process.arch} node=${process.version}`);
  log(`stdin.isTTY=${stdin.isTTY} stdout.isTTY=${stdout.isTTY}`);
  log(`stdout.columns=${stdout.columns} stdout.rows=${stdout.rows}`);
  log(`TERM=${process.env["TERM"] ?? ""} TERM_PROGRAM=${process.env["TERM_PROGRAM"] ?? ""}`);
  log(`WT_SESSION=${process.env["WT_SESSION"] ?? ""}`);
  return logPath;
}

export function log(line: string): void {
  if (!stream) return;
  try {
    stream.write(line + "\n");
  } catch {
    // ignore
  }
}

export function logBytes(label: string, chunk: Buffer | string): void {
  if (!stream) return;
  const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
  const hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const printable = buf
    .toString("utf8")
    .replace(ESC_RE, "ESC")
    .replace(CTRL_RE, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`);
  log(`${label} bytes=[${hex}] str=${JSON.stringify(printable)}`);
}

export function logKeypress(str: string | undefined, k: unknown): void {
  if (!stream) return;
  log(`keypress str=${JSON.stringify(str)} key=${JSON.stringify(k)}`);
}

export function logEvent(label: string, data?: unknown): void {
  if (!stream) return;
  if (data === undefined) {
    log(label);
  } else {
    log(`${label} ${JSON.stringify(data)}`);
  }
}

export function close(): void {
  if (!stream) return;
  try {
    stream.end();
  } catch {
    // ignore
  }
  stream = undefined;
  enabled = false;
}
