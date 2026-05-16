export function parseInsightPort(args: string[]): number {
  const raw = getRawPort(args);
  if (raw === undefined) return 4747;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid insight port: ${raw}`);
  }

  return port;
}

function getRawPort(args: string[]): string | undefined {
  if (args.length === 0) return undefined;

  const first = args[0];
  if (first === "--port") return args[1] ?? "";
  if (first.startsWith("--port=")) return first.slice("--port=".length);
  return first;
}
