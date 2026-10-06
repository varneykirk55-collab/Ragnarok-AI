import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ToolDefinition } from "./types";
import { webSearch, fetchWebpage } from "../search/providers";
import { safeResolve, listWorkspaceFiles, isTextReadable } from "../files/workspace";
import { listMemories, createMemory } from "../memory/store";

const MAX_FILE_READ = 60000;

function parseArgs<T extends Record<string, unknown>>(input: Record<string, unknown>): T {
  return input as T;
}

const searchWeb: ToolDefinition = {
  name: "search_web",
  description: "Search the live web for current information. Returns titles, URLs, snippets, and sources. Use for news, prices, docs, current events.",
  category: "web",
  riskLevel: "low",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      max_results: { type: "number", description: "Max results (1-15)", default: 8 },
    },
    required: ["query"],
  },
  async execute(input, ctx) {
    const { query, max_results } = parseArgs<{ query: string; max_results?: number }>(input);
    if (!query?.trim()) return { ok: false, output: null, summary: "Empty query", error: "Query is required" };
    const res = await webSearch(query.trim(), { maxResults: Math.min(15, Math.max(1, max_results ?? 8)), privacyMode: ctx.privacyMode, signal: ctx.signal });
    return {
      ok: true,
      output: res,
      summary: `${res.results.length} results via ${res.provider}`,
      citations: res.results.map((r) => ({ title: r.title, url: r.url, source: r.source })),
    };
  },
};

const fetchWebpageTool: ToolDefinition = {
  name: "fetch_webpage",
  description: "Fetch and extract readable text from a public web page URL. Returns title and text content.",
  category: "web",
  riskLevel: "low",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full http(s) URL to fetch" },
      max_chars: { type: "number", description: "Max characters to extract", default: 12000 },
    },
    required: ["url"],
  },
  async execute(input, ctx) {
    const { url, max_chars } = parseArgs<{ url: string; max_chars?: number }>(input);
    const page = await fetchWebpage(url, { maxChars: Math.min(30000, max_chars ?? 12000), signal: ctx.signal });
    return { ok: true, output: page, summary: `Fetched ${page.title} (${page.text.length} chars)` };
  },
};

const readFile: ToolDefinition = {
  name: "read_file",
  description: "Read a text file from the project workspace. Paths are workspace-relative (e.g. 'notes/plan.md').",
  category: "files",
  riskLevel: "low",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative file path" } },
    required: ["path"],
  },
  async execute(input, ctx) {
    const { path: rel } = parseArgs<{ path: string }>(input);
    const abs = await safeResolve(ctx.projectId, rel);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) return { ok: false, output: null, summary: "File not found", error: `No such file: ${rel}` };
    if (stat.size > 500000) return { ok: false, output: null, summary: "File too large", error: "Files over 500KB cannot be read directly." };
    if (!isTextReadable(rel)) return { ok: false, output: null, summary: "Unsupported type", error: "Only text/code files can be read in V1." };
    const content = await fs.readFile(abs, "utf8");
    return { ok: true, output: { path: rel, size: stat.size, content: content.slice(0, MAX_FILE_READ) }, summary: `Read ${rel} (${stat.size} bytes)` };
  },
};

const writeFile: ToolDefinition = {
  name: "write_file",
  description: "Write or overwrite a text file in the project workspace. Creates parent folders. Use for reports, summaries, code, exports.",
  category: "files",
  riskLevel: "medium",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path" },
      content: { type: "string", description: "Full file content" },
    },
    required: ["path", "content"],
  },
  async execute(input, ctx) {
    const { path: rel, content } = parseArgs<{ path: string; content: string }>(input);
    if (!rel?.trim()) return { ok: false, output: null, summary: "Missing path", error: "Path is required" };
    if (typeof content !== "string") return { ok: false, output: null, summary: "Missing content", error: "Content must be a string" };
    if (content.length > 1000000) return { ok: false, output: null, summary: "Too large", error: "Content exceeds 1MB limit." };
    const abs = await safeResolve(ctx.projectId, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { ok: true, output: { path: rel, bytes: content.length }, summary: `Wrote ${rel} (${content.length} chars)` };
  },
};

const createDocument: ToolDefinition = {
  name: "create_document",
  description: "Create a formatted document (markdown, report, summary) in the workspace. Convenience wrapper around write_file with stub handling.",
  category: "files",
  riskLevel: "medium",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      format: { type: "string", enum: ["markdown", "text", "csv", "json"], default: "markdown" },
      content: { type: "string" },
      filename: { type: "string", description: "Optional filename; auto-generated from title if omitted" },
    },
    required: ["title", "content"],
  },
  async execute(input, ctx) {
    const { title, format, content, filename } = parseArgs<{ title: string; format?: string; content: string; filename?: string }>(input);
    const ext = format === "json" ? "json" : format === "csv" ? "csv" : format === "text" ? "txt" : "md";
    const slug = (title || "document").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
    const rel = filename || `documents/${slug}.${ext}`;
    const abs = await safeResolve(ctx.projectId, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { ok: true, output: { path: rel, bytes: content.length }, summary: `Created document ${rel}` };
  },
};

const inspectRepository: ToolDefinition = {
  name: "inspect_repository",
  description: "List files and folders in the project workspace (up to 4 levels deep). Use to explore project contents.",
  category: "files",
  riskLevel: "low",
  requiresApprovalDefault: false,
  parameters: { type: "object", properties: {} },
  async execute(_input, ctx) {
    const files = await listWorkspaceFiles(ctx.projectId);
    const preview = files.slice(0, 120);
    return { ok: true, output: { count: files.length, files: preview }, summary: `${files.length} files/folders in workspace` };
  },
};

const DANGEROUS_SHELL = [
  /rm\s+-rf\s+\/(?:\s|$)/, /mkfs/, /dd\s+if=/, /:\(\)\s*\{/, /shutdown|reboot|poweroff/, /chmod\s+-R\s+777\s+\//,
  />\s*\/dev\/sd/, /curl.*\|\s*(sh|bash)/, /wget.*\|\s*(sh|bash)/,
];

const runCode: ToolDefinition = {
  name: "run_code",
  description: "Execute Python code in a sandboxed subprocess (10s timeout, no network). Returns stdout/stderr. Destructive shell commands are blocked.",
  category: "code",
  riskLevel: "medium",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: {
      language: { type: "string", enum: ["python"], default: "python" },
      code: { type: "string", description: "Python source code to run" },
    },
    required: ["code"],
  },
  async execute(input, ctx) {
    const { code, language } = parseArgs<{ code: string; language?: string }>(input);
    if ((language || "python") !== "python") return { ok: false, output: null, summary: "Unsupported language", error: "Only Python is supported in V1." };
    if (!code?.trim()) return { ok: false, output: null, summary: "Empty code", error: "Code is required" };
    for (const re of DANGEROUS_SHELL) {
      if (re.test(code)) return { ok: false, output: null, summary: "Blocked dangerous pattern", error: "Code contains a blocked destructive pattern." };
    }
    // Block network/socket imports in sandbox V1
    if (/\b(socket|urllib|requests|http\.client|subprocess|os\.system)\b/.test(code)) {
      return { ok: false, output: null, summary: "Blocked module", error: "Network/subprocess modules are blocked in the V1 sandbox." };
    }
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      const child = execFile("python3", ["-c", code], { timeout: 10000, maxBuffer: 200000, env: { ...process.env, PYTHONDONTWRITEBUFFERED: "1" } }, (err, stdout, stderr) => {
        if (err && ((err as unknown as { killed?: boolean }).killed || /timed out/i.test(err.message))) resolve({ stdout: String(stdout).slice(0, 8000), stderr: "Execution timed out after 10s.", code: 124 });
        else resolve({ stdout: String(stdout).slice(0, 8000), stderr: String(stderr).slice(0, 8000), code: err ? 1 : 0 });
      });
      ctx.signal?.addEventListener("abort", () => { try { child.kill(); } catch {} });
    });
    return {
      ok: result.code === 0,
      output: result,
      summary: result.code === 0 ? `Exited 0 (${result.stdout.length} chars out)` : `Exited ${result.code}: ${result.stderr.slice(0, 300)}`,
      error: result.code === 0 ? undefined : result.stderr.slice(0, 1000),
    };
  },
};

const callApi: ToolDefinition = {
  name: "call_api",
  description: "Make an HTTP request to a public API (GET/POST/PUT/DELETE). SSRF-guarded (no localhost). Secrets must never be placed in URLs.",
  category: "web",
  riskLevel: "medium",
  requiresApprovalDefault: true,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
      headers: { type: "object", default: {} },
      body: { type: "string", description: "Optional string body" },
    },
    required: ["url"],
  },
  async execute(input, ctx) {
    const { url, method, headers, body } = parseArgs<{ url: string; method?: string; headers?: Record<string, string>; body?: string }>(input);
    let parsed: URL;
    try { parsed = new URL(url); } catch { return { ok: false, output: null, summary: "Invalid URL", error: "Invalid URL" }; }
    if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, output: null, summary: "Blocked protocol", error: "Only http(s) allowed" };
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local"))
      return { ok: false, output: null, summary: "Blocked host", error: "Local network URLs are blocked." };
    const res = await fetch(parsed.toString(), {
      method: method || "GET",
      headers: { "User-Agent": "Nexus-Personal-AI/1.0", ...(headers || {}) },
      body: body && method !== "GET" ? body : undefined,
      signal: ctx.signal ?? AbortSignal.timeout(20000),
    });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      output: { status: res.status, body: text.slice(0, 10000) },
      summary: `${method || "GET"} ${host} → ${res.status}`,
      error: res.ok ? undefined : text.slice(0, 500),
    };
  },
};

const rememberTool: ToolDefinition = {
  name: "save_memory",
  description: "Save a durable memory (preference, fact, decision, instruction). Memories persist locally and are retrieved by relevance.",
  category: "memory",
  riskLevel: "low",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: {
      content: { type: "string" },
      category: { type: "string", default: "facts" },
      title: { type: "string" },
      importance: { type: "number", default: 5 },
    },
    required: ["content"],
  },
  async execute(input, ctx) {
    const { content, category, title, importance } = parseArgs<{ content: string; category?: string; title?: string; importance?: number }>(input);
    if (!content?.trim()) return { ok: false, output: null, summary: "Empty", error: "Content required" };
    const row = await createMemory({ content: content.trim(), category: category || "facts", title, importance: importance ?? 5, projectId: ctx.projectId, source: "agent" });
    return { ok: true, output: { id: row.id }, summary: `Saved memory (${category || "facts"})` };
  },
};

const recallMemory: ToolDefinition = {
  name: "recall_memory",
  description: "Search local long-term memories by keyword. Returns relevant memories with categories.",
  category: "memory",
  riskLevel: "low",
  requiresApprovalDefault: false,
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number", default: 8 } },
    required: ["query"],
  },
  async execute(input, ctx) {
    const { query, limit } = parseArgs<{ query: string; limit?: number }>(input);
    const all = await listMemories({ limit: 300, enabledOnly: true });
    const q = query.toLowerCase();
    const hits = all
      .filter((m) => (!m.projectId || m.projectId === ctx.projectId) && (m.title + " " + m.content).toLowerCase().includes(q.split(" ")[0]))
      .slice(0, limit ?? 8);
    return { ok: true, output: { memories: hits }, summary: `${hits.length} memories found` };
  },
};

// Placeholders for planned tools — registered as unavailable so UI is honest.
function plannedTool(name: string, description: string, category: string): ToolDefinition {
  return {
    name,
    description: `${description} [PLANNED — not implemented in V1]`,
    category,
    riskLevel: "medium",
    requiresApprovalDefault: true,
    parameters: { type: "object", properties: {} },
    async execute() {
      return { ok: false, output: null, summary: "Not implemented", error: `${name} is planned but not implemented in V1.` };
    },
  };
}

export const BUILTIN_TOOLS: ToolDefinition[] = [
  searchWeb,
  fetchWebpageTool,
  readFile,
  writeFile,
  createDocument,
  inspectRepository,
  runCode,
  callApi,
  rememberTool,
  recallMemory,
  plannedTool("browse_website", "Interactive browser automation (navigate, click, type, extract).", "browser"),
  plannedTool("generate_image", "Generate images via connected image providers. Use /api/image for V1 image gen.", "media"),
  plannedTool("read_email", "Read email via connected email connector.", "connectors"),
  plannedTool("send_email", "Send email (always requires approval).", "connectors"),
  plannedTool("read_calendar", "Read calendar events.", "connectors"),
  plannedTool("create_calendar_event", "Create a calendar event.", "connectors"),
];

export const PLANNED_TOOL_NAMES = new Set([
  "browse_website", "generate_image", "read_email", "send_email", "read_calendar", "create_calendar_event",
]);
