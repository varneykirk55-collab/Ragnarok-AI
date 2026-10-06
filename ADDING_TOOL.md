# Adding a Tool

Tools are `ToolDefinition` objects (`src/lib/tools/types.ts`) registered in one place.
The LLM, permission system, agent loop, and UI all consume the registry — no other
wiring needed.

## 1. Define the tool

Add to `src/lib/tools/builtin.ts` (or a new file imported there):

```ts
export const myTool: ToolDefinition = {
  name: "my_tool",                       // snake_case, stable (permissions key off this)
  description: "What it does, when to use it. Models read this to decide.",
  category: "files",                     // web | files | code | memory | browser | media | connectors
  riskLevel: "medium",                   // low | medium | high
  requiresApprovalDefault: true,        // medium/high tools usually true
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path" },
    },
    required: ["path"],
  },
  async execute(input, ctx) {
    // ctx: { conversationId?, projectId?, taskId?, privacyMode, workspaceRoot, signal? }
    // Validate input, do the work, return:
    return { ok: true, output: { /* JSON for the model */ }, summary: "One-line outcome" };
    // On failure: { ok: false, output: null, summary: "…", error: "details" }
  },
};
```

Then add `myTool` to `BUILTIN_TOOLS`.

## 2. Rules

- **Validate everything** — paths via `safeResolve()`, URLs via http(s)+SSRF checks.
- **Respect `ctx.privacyMode`** — no external calls when true (unless the tool is local-only).
- **Respect `ctx.signal`** — abort long operations.
- **Never return secrets** in `output`/`summary` — they go into prompts and logs.
- **Risk levels**: read-only/reversible → `low`; writes local files/runs code/
  external reads → `medium`; sends data externally, deletes, spends money, changes
  security → `high` + `requiresApprovalDefault: true`.
- **Size caps** — truncate outputs (models drown in 100KB dumps); save big artifacts
  to the workspace and return the path.

## 3. Permissions & UI (automatic)

- Default policy derives from risk level; users override in Settings → Tools.
- Chat mode auto-runs only `always_allow`; agent mode raises approvals otherwise.
- The tool appears in Tools settings and the agent's function list immediately.

## 4. Verify

1. Tools settings → confirm risk/policy row exists.
2. Chat: ask the assistant to use it (Auto route) — or call it directly:
   `POST /api/tools/execute { "toolName": "my_tool", "input": {...} }`.
3. Test deny/ask flows by flipping its policy.
4. Test from an agent task and confirm approvals pause/resume correctly.

For user plugins (REST/MCP/scripts), wrap the external call in the same
`ToolDefinition` shape — the permission/approval layer then applies automatically.
