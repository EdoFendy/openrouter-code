import { execSync } from "node:child_process";

export function readClipboard(): string {
  try {
    if (process.platform === "darwin") {
      return execSync("pbpaste", { encoding: "utf8", timeout: 2000 });
    }
    if (process.platform === "win32") {
      const out = execSync(
        "powershell.exe -NoProfile -NonInteractive -Command Get-Clipboard",
        { encoding: "utf8", timeout: 3000 }
      );
      return out.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
    }
    for (const cmd of [
      "xclip -selection clipboard -o",
      "xsel --clipboard --output",
      "wl-paste --no-newline"
    ]) {
      try {
        return execSync(cmd, { encoding: "utf8", timeout: 2000 });
      } catch {
        // try next tool
      }
    }
    return "";
  } catch {
    return "";
  }
}
