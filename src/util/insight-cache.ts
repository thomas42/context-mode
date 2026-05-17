import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORED_DIRS = new Set(["node_modules"]);

function* sourceFiles(dir: string, root = dir): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* sourceFiles(path, root);
      continue;
    }
    if (entry.isFile()) yield relative(root, path);
  }
}

export function isInsightCacheStale(sourceDir: string, cacheDir: string): boolean {
  if (!existsSync(cacheDir)) return true;

  for (const relPath of sourceFiles(sourceDir)) {
    const sourcePath = join(sourceDir, relPath);
    const cachePath = join(cacheDir, relPath);
    if (!existsSync(cachePath)) return true;
    if (statSync(sourcePath).mtimeMs > statSync(cachePath).mtimeMs) return true;
  }

  return false;
}
