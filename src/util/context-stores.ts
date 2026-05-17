import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ContextStoreInfo {
  id: string;
  label: string;
  platform: string;
  rootDir: string;
  sessionDir: string;
  contentDir: string;
  sessionDbs: number;
  contentDbs: number;
  totalBytes: number;
}

function configHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function candidateStores(): Array<{ id: string; label: string; platform: string; rootDir: string }> {
  return [
    { id: "claude-code", label: "Claude Code", platform: "claude-code", rootDir: join(homedir(), ".claude", "context-mode") },
    { id: "codex", label: "Codex CLI", platform: "codex", rootDir: join(homedir(), ".codex", "context-mode") },
    { id: "opencode", label: "OpenCode", platform: "opencode", rootDir: join(configHome(), "opencode", "context-mode") },
    { id: "kilo", label: "KiloCode", platform: "kilo", rootDir: join(configHome(), "kilo", "context-mode") },
    { id: "gemini-cli", label: "Gemini CLI", platform: "gemini-cli", rootDir: join(homedir(), ".gemini", "context-mode") },
    { id: "cursor", label: "Cursor", platform: "cursor", rootDir: join(homedir(), ".cursor", "context-mode") },
    { id: "vscode-copilot", label: "VS Code Copilot", platform: "vscode-copilot", rootDir: join(homedir(), ".vscode", "context-mode") },
    { id: "jetbrains-copilot", label: "JetBrains Copilot", platform: "jetbrains-copilot", rootDir: join(configHome(), "JetBrains", "context-mode") },
    { id: "kiro", label: "Kiro", platform: "kiro", rootDir: join(homedir(), ".kiro", "context-mode") },
    { id: "pi", label: "Pi Coding Agent", platform: "pi", rootDir: join(homedir(), ".pi", "context-mode") },
    { id: "omp", label: "OMP", platform: "omp", rootDir: join(homedir(), ".omp", "context-mode") },
    { id: "openclaw", label: "OpenClaw", platform: "openclaw", rootDir: join(homedir(), ".openclaw", "context-mode") },
  ];
}

function dbStats(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".db")) continue;
    try {
      bytes += statSync(join(dir, name)).size;
      count += 1;
    } catch {
      // Ignore races with writers/removers.
    }
  }
  return { count, bytes };
}

export function discoverContextStores(): ContextStoreInfo[] {
  return candidateStores()
    .map((candidate) => {
      const sessionDir = join(candidate.rootDir, "sessions");
      const contentDir = join(candidate.rootDir, "content");
      const sessions = dbStats(sessionDir);
      const content = dbStats(contentDir);
      return {
        ...candidate,
        sessionDir,
        contentDir,
        sessionDbs: sessions.count,
        contentDbs: content.count,
        totalBytes: sessions.bytes + content.bytes,
      };
    })
    .filter((store) =>
      existsSync(store.rootDir) ||
      store.sessionDbs > 0 ||
      store.contentDbs > 0 ||
      store.totalBytes > 0
    )
    .sort((a, b) => b.totalBytes - a.totalBytes || a.label.localeCompare(b.label));
}
