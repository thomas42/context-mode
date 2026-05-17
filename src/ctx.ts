#!/usr/bin/env node
/**
 * Human-facing context-mode CLI.
 *
 * `context-mode` remains the MCP stdio entrypoint. This binary is free to
 * provide normal terminal UX for the same meta operations agents call via MCP.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverContextStores } from "./util/context-stores.js";

type JsonRpcResponse = {
  id?: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { message: string };
};

const args = process.argv.slice(2);

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function main(): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageVersion());
    return;
  }
  if (command === "stats") {
    printStatsList();
    return;
  }
  if (command === "purge") {
    if (!args.includes("--confirm")) {
      console.error("Refusing to purge without --confirm.");
      process.exit(2);
    }
    await printMcpTool("ctx_purge", { confirm: true });
    return;
  }
  if (command === "doctor" || command === "upgrade" || command === "insight") {
    if (command === "doctor") {
      runDoctorAll();
      return;
    }
    forwardContextMode(command, args.slice(1));
    return;
  }
  if (command === "stores") {
    printStores();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run: ctx --help");
  process.exit(2);
}

function printHelp(): void {
  console.log(`ctx ${packageVersion()}

Usage:
  ctx stats                  Show context savings and usage stats
  ctx doctor                 Diagnose every discovered context-mode store
  ctx upgrade                Update hooks and installed plugin files
  ctx purge --confirm        Permanently delete this project's context-mode data
  ctx insight [--port PORT]  Open Insight dashboard
  ctx stores                 List discovered context-mode stores
  ctx --version              Print version
  ctx --help                 Show this help`);
}

function printStores(): void {
  const stores = discoverContextStores();
  if (stores.length === 0) {
    console.log("No context-mode stores found.");
    return;
  }
  for (const store of stores) {
    console.log(`${store.id}\t${store.label}\t${store.sessionDbs} session dbs\t${store.contentDbs} content dbs\t${store.rootDir}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function printStatsList(): void {
  const stores = discoverContextStores();
  const totals = stores.reduce(
    (acc, store) => ({
      sessionDbs: acc.sessionDbs + store.sessionDbs,
      contentDbs: acc.contentDbs + store.contentDbs,
      totalBytes: acc.totalBytes + store.totalBytes,
    }),
    { sessionDbs: 0, contentDbs: 0, totalBytes: 0 },
  );

  console.log(`version: ${packageVersion()}`);
  console.log(`stores: ${stores.length}`);
  console.log(`session_dbs: ${totals.sessionDbs}`);
  console.log(`content_dbs: ${totals.contentDbs}`);
  console.log(`total_size: ${formatBytes(totals.totalBytes)}`);
  for (const store of stores) {
    console.log(`- store: ${store.id}`);
    console.log(`  label: ${store.label}`);
    console.log(`  sessions: ${store.sessionDbs}`);
    console.log(`  content: ${store.contentDbs}`);
    console.log(`  size: ${formatBytes(store.totalBytes)}`);
    console.log(`  root: ${store.rootDir}`);
  }
}

function runDoctorAll(): void {
  const stores = discoverContextStores();
  const platforms = stores.length > 0
    ? stores.map((store) => store.platform).filter((platform) => platform !== "default")
    : ["claude-code", "codex", "opencode"];
  const uniquePlatforms = [...new Set(platforms)];
  let failed = false;

  for (const platform of uniquePlatforms) {
    console.log(`\n== ${platform} ==`);
    const result = spawnSync(process.execPath, [contextModeCliPath(), "doctor"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        CONTEXT_MODE_PLATFORM: platform,
      },
    });
    if (result.error) throw result.error;
    const output = `${result.stdout}${result.stderr}`.trim();
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim())
      .filter((line) =>
        line.startsWith("◆") ||
        line.startsWith("◇") ||
        line.startsWith("●") ||
        line.includes(": PASS") ||
        line.includes(": FAIL") ||
        line.includes(": WARN")
      );
    for (const line of lines) {
      console.log(line);
    }
    if ((result.status ?? 1) !== 0 || output.includes(": FAIL") || output.includes(" FAIL ")) {
      failed = true;
    }
  }

  if (failed) process.exit(1);
}

function pluginRoot(): string {
  const file = fileURLToPath(import.meta.url);
  const dir = dirname(file);
  if (dir.endsWith("/build") || dir.endsWith("\\build") || dir.endsWith("/src") || dir.endsWith("\\src")) {
    return resolve(dir, "..");
  }
  return dir;
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(pluginRoot(), "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function contextModeCliPath(): string {
  const root = pluginRoot();
  const bundle = resolve(root, "cli.bundle.mjs");
  if (existsSync(bundle)) return bundle;
  return resolve(root, "build", "cli.js");
}

function serverPath(): string {
  const root = pluginRoot();
  const bundle = resolve(root, "server.bundle.mjs");
  if (existsSync(bundle)) return bundle;
  return resolve(root, "build", "server.js");
}

function forwardContextMode(command: string, rest: string[]): void {
  const result = spawnSync(process.execPath, [contextModeCliPath(), command, ...rest], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

async function printMcpTool(name: string, toolArgs: Record<string, unknown>): Promise<void> {
  const text = await callMcpTool(name, toolArgs);
  console.log(text);
}

async function callMcpTool(name: string, toolArgs: Record<string, unknown>): Promise<string> {
  const child = spawn(process.execPath, [serverPath()], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CONTEXT_MODE_STARTUP_SWEEP: "0",
    },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ctx-cli", version: packageVersion() },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name,
      arguments: toolArgs,
    },
  });

  const response = await waitForResponse(child, () => stdout, 2);
  try { child.stdin.end(); } catch { /* best effort */ }
  try { child.kill("SIGTERM"); } catch { /* best effort */ }

  if (response.error) throw new Error(response.error.message);
  if (response.result?.isError) {
    throw new Error(response.result.content?.map((c) => c.text).join("\n") || `${name} failed`);
  }
  const text = response.result?.content?.map((c) => c.text).join("\n") ?? "";
  if (!text && stderr.trim()) return stderr.trim();
  return text;
}

function waitForResponse(
  child: ReturnType<typeof spawn>,
  getStdout: () => string,
  id: number,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* best effort */ }
      reject(new Error("Timed out waiting for context-mode MCP response"));
    }, 30_000);

    const poll = setInterval(() => {
      const response = parseResponse(getStdout(), id);
      if (!response) return;
      clearTimeout(timeout);
      clearInterval(poll);
      resolve(response);
    }, 25);

    child.on("exit", (code, signal) => {
      const response = parseResponse(getStdout(), id);
      if (response) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve(response);
        return;
      }
      clearTimeout(timeout);
      clearInterval(poll);
      reject(new Error(`context-mode MCP exited before response (code=${code}, signal=${signal})`));
    });
  });
}

function parseResponse(stdout: string, id: number): JsonRpcResponse | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as JsonRpcResponse;
      if (parsed.id === id) return parsed;
    } catch {
      // Ignore non-JSON process output.
    }
  }
  return null;
}
