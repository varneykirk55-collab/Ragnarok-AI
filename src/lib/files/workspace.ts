import path from "node:path";
import fs from "node:fs/promises";
import { getSetting } from "../server-settings";

export async function workspaceRoot(): Promise<string> {
  const root = await getSetting("workspaceRoot", "./data/workspaces").catch(() => "./data/workspaces");
  const abs = path.resolve(process.cwd(), String(root));
  await fs.mkdir(abs, { recursive: true });
  return abs;
}

/** Resolve a workspace-relative path safely (blocks directory traversal). */
export async function safeResolve(projectId: string | null | undefined, relPath: string): Promise<string> {
  const root = await workspaceRoot();
  const scope = projectId ? path.join(root, sanitizeSegment(projectId)) : path.join(root, "shared");
  await fs.mkdir(scope, { recursive: true });
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(scope, cleaned);
  if (!resolved.startsWith(scope + path.sep) && resolved !== scope) {
    throw new Error("Blocked: path escapes the allowed workspace.");
  }
  return resolved;
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 64) || "project";
}

export async function listWorkspaceFiles(projectId: string | null | undefined): Promise<Array<{ name: string; path: string; size: number; dir: boolean }>> {
  const root = await workspaceRoot();
  const scope = projectId ? path.join(root, sanitizeSegment(projectId)) : path.join(root, "shared");
  await fs.mkdir(scope, { recursive: true });
  const out: Array<{ name: string; path: string; size: number; dir: boolean }> = [];
  async function walk(dir: string, rel: string, depth: number) {
    if (depth > 4) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.slice(0, 200)) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ name: e.name, path: relPath, size: 0, dir: true });
        await walk(path.join(dir, e.name), relPath, depth + 1);
      } else {
        const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
        out.push({ name: e.name, path: relPath, size: stat?.size ?? 0, dir: false });
      }
    }
  }
  await walk(scope, "", 0);
  return out.slice(0, 500);
}

export const ALLOWED_READ_EXT = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".xml", ".html", ".htm",
  ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h",
  ".css", ".scss", ".yml", ".yaml", ".toml", ".ini", ".env", ".log", ".sh", ".sql",
]);

export function isTextReadable(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_READ_EXT.has(ext) || !ext;
}
