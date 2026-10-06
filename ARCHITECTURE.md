# Nexus Architecture

## Design principle

**The assistant is permanent. Models, providers, and tools are interchangeable.**

```
User → Nexus UI → Orchestrator (chat route / agent runner)
                      ├── Model Router (classify → score → select → fallback)
                      ├── Tool Router (registry → permissions → approvals → execute)
                      ├── Context Builder (immediate + project + memory + tool layers)
                      └── Memory Store (local, relevance-retrieved)
```

## Major components

| Area | Location | Notes |
|---|---|---|
| UI shell | `src/components/NexusApp.tsx` | Sidebar + views, responsive, mobile drawer |
| Chat | `src/components/ChatPanel.tsx`, `src/app/api/chat/route.ts` | SSE streaming, tool rounds, ask-mode |
| Providers | `src/lib/providers/*` | `ProviderAdapter` interface + 6 adapters |
| Routing | `src/lib/router/router.ts` | Classification + scoring + fallback chains |
| LLM calls | `src/lib/llm/chat.ts` | `chatWithFallback()` with typed errors |
| Tools | `src/lib/tools/*` | Registry, permissions, 10 builtins + planned stubs |
| Search | `src/lib/search/providers.ts` | Free + keyed providers, SSRF-guarded fetch |
| Agent | `src/lib/agent/runner.ts` | Plan→act→observe loop, approvals, stop |
| Memory | `src/lib/memory/store.ts` | CRUD, keyword-relevance retrieval, commands |
| Context | `src/lib/context/builder.ts` | Layered assembly with size caps |
| Files | `src/lib/files/workspace.ts` | Sandboxed per-project workspaces |
| Usage | `src/lib/usage/*` | Token/cost tracking + budgets |
| Secrets | `src/lib/crypto.ts` | AES-256-GCM, redaction helpers |
| Settings | `src/lib/server-settings.ts` | Typed key-value settings |

## Model / provider architecture

`ProviderAdapter` (`src/lib/providers/types.ts`) standardizes:

- `listModels()` — dynamic model discovery (no hard-coded model names in core logic)
- `testConnection()` — human-readable diagnostics
- `chat()` — streaming + tool calling, normalized to `ChatResult`
- `generateImage()` (optional)

Adapters: `openai-compatible.ts` (OpenAI, xAI, Ollama, generic), `anthropic.ts`, `google.ts`.
New providers register via `registerAdapter()` — no changes elsewhere needed.

`ResolvedProvider` is the server-side-only view (decrypted key). The browser only ever
sees `listProvidersSafe()` (no secrets).

## Tool architecture

`ToolDefinition`: name, description, JSON-schema parameters, risk level, approval default,
`execute(input, ctx)`. Tools are pure functions of `(input, ToolContext)` — easy to test.

- `toLLMTools()` exposes available tools to models as function-calling schemas.
- `checkPermission()` enforces policy: `always_allow | ask | always_ask | deny`.
- Chat mode auto-runs only `always_allow` tools; agent mode creates `approvals` rows and
  pauses (`awaiting_approval`) until resolved via `resumeAfterApproval()`.
- Planned tools are registered with `[PLANNED]` descriptions and hard-deny execution —
  the UI shows them honestly instead of faking capability.

## Agent loop

`runAgentTask(taskId)`:

1. Route goal → capability → provider/model.
2. Seed system prompt (goal, rules, project/memory context).
3. Loop (max `maxSteps`): LLM call (with tools) → permission check per call →
   execute or create approval+pause → append observations → repeat.
4. Completion when model emits `TASK_COMPLETE:`; failure after `maxRetries` or step cap.
5. Every iteration persists `task_steps` rows; UI polls `GET /api/agent/tasks/[id]`.

Interruptibility: in-memory stop flags + persisted `stopped/paused` status; STOP button
in Tasks view. Partial work (files, steps, outcome) is preserved.

## Memory

V1 retrieval = keyword scoring (TF overlap + query coverage) + pin/importance/recency boosts.
Global vs project-scoped; cross-project retrieval only when the project opts in.
`memoryEnabled=false` disables retrieval entirely. Upgrade path: embeddings + pgvector
without changing the `retrieveMemories()` interface.

## Permissions

Risk: low (read-only/reversible) → auto; medium → configurable; high → always ask.
`tool_permissions` table overrides defaults. Approvals store exact proposed action +
payload; agent resumes after decision. Emergency STOP halts active tasks.

## Security boundaries

- **Secrets**: encrypted at rest, never logged (redaction), never sent to client.
- **Filesystem**: `safeResolve()` confines all access to `data/workspaces/<project>/`.
- **Network**: `fetchWebpage`/`call_api` enforce http(s), block localhost/`.local` (SSRF guard).
- **Code**: Python sandbox (no network/subprocess imports, 10s timeout, output caps).
- **Prompt injection**: system prompts label tool/web content as DATA; high-risk tools
  require human approval regardless of what external content claims.
- **Remote access**: no built-in exposure; documented VPN/reverse-proxy path.

## Database

PostgreSQL via Drizzle (`src/db/schema.ts`). Tables: providers, models, projects,
conversations, messages, memories, project_files, agent_tasks, task_steps, approvals,
tool_permissions, usage_events, automations, connectors, settings, audit_logs.
Schema is ORM-defined and portable — a SQLite migration only requires swapping the
Drizzle driver + column types.
