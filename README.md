# Ragnarok — Personal AI Command Center

A **local-first, self-hosted personal AI assistant** that acts as your single interface to
multiple AI models, tools, files, web research, memory, projects, and autonomous agents.

> **The assistant is permanent. Models, providers, and tools are interchangeable.**

```
                  USER
                   │
                   ▼
        PERSONAL AI INTERFACE (Ragnarok)
                   │
                   ▼
          ORCHESTRATOR / AGENT
             ╱             ╲
            ▼               ▼
     MODEL ROUTER       TOOL ROUTER
    ╱   │   │   ╲      ╱ │ │ │ │ ╲
   ▼    ▼   ▼    ▼    ▼  ▼ ▼ ▼ ▼  ▼
 OpenAI Cl. Gem. Ollama Web Files Code APIs
```

## What it does (V1)

- **Multi-model chat** — OpenAI, Anthropic, Google, xAI, Ollama, any OpenAI-compatible server
  (LM Studio, llama.cpp, vLLM, Together, DeepSeek…). Streaming, markdown, code blocks,
  citations, attachments, stop / retry / edit-resend / regenerate / verify.
- **3 routing modes** — Automatic (capability-aware scoring), Ask-me (confirm before use),
  Manual (pin a model). Per-conversation + global. Privacy Mode restricts to local only.
- **Fallback routing** — provider fallback models → other providers → honest error. Handles
  auth failures, rate limits, retired models, timeouts, outages.
- **Real web research** — modular search (free DuckDuckGo+Wikipedia built in; optional
  Tavily / Brave / Serper / self-hosted SearXNG), safe page retrieval, citations, fact-check mode.
  Chat Web Access can be Auto / On / Off; live sources are cited and external page content is untrusted data.
- **Reasoning controls** — Auto / Fast / Balanced / Deep / Maximum effort, saved defaults, per-chat override,
  complexity-aware routing, and native provider effort controls where supported.
- **Two-way browser voice** — push-to-talk and continuous spoken conversations using browser speech recognition
  and installed system voices; saved voice profiles, voice preview, wake phrase, timeout, mute, interrupt, and clear mic state.
  Speech recognition requires a supported browser and microphone permission; some browsers process recognition through
  their own hosted service. Ragnarok does not store raw audio. Wake phrases are best-effort browser recognition, not an
  always-on OS service, and may stop in background tabs or on locked devices.
- **Agent mode** — goal → plan → tools → observe → complete, with activity feed, approvals,
  STOP, pause/resume, retry limits, persistent history.
- **Permissions** — per-tool policies (Always allow / Ask / Always ask / Disabled) +
  low/medium/high risk classification. High-risk actions always ask first.
- **Sandboxed code execution** — Python (10s timeout, no network/subprocess), destructive
  patterns blocked.
- **Projects** — isolated conversations, files, memories, instructions.
- **Memory** — local long-term memory with relevance retrieval, categories, pins, enable/disable.
  Try “Remember that…”, “Forget…”.
- **Files** — project-scoped workspace sandbox (no access outside it).
- **Image generation** — OpenAI-compatible image APIs + labeled free fallback.
- **Cost tracking** — per-provider/model tokens + estimated cost, daily/monthly budgets.
- **Automations** — scheduled agent goals (stored locally, Run Now + scheduler script).
- **Backup/restore** — one-click JSON export/import (secrets never exported).
- **Connectors** — search-connector framework (email/calendar/GitHub planned).

## System requirements

- Node.js 20+
- PostgreSQL 14+ (or use Docker Compose below)
- Optional: [Ollama](https://ollama.com) for local models
- Python 3 for the code-execution sandbox

## Quick start (Docker — recommended for local self-hosting)

```bash
git clone <this-repo> && cd Ragnarok-AI
cp .env.example .env
# edit .env: set SECRET_ENCRYPTION_KEY to a long random string
docker compose up --build
```

Then open **http://localhost:3000**.

Services: `app` (Next.js) + `db` (PostgreSQL 16). Data persists in Docker volumes
(`nexus-db-data`, `nexus-workspaces`; legacy Docker volume names are retained so existing data mounts continue to work).

## Quick start (bare metal)

```bash
npm install
cp .env.example .env
# set DATABASE_URL + SECRET_ENCRYPTION_KEY in .env
npx drizzle-kit push
npm run build
npm start
# open http://localhost:3000
```

Dev mode: `npm run dev`.

## Provider configuration

1. Open **Providers** (sidebar → System → Providers).
2. **Add provider** → choose type:
   - **Cloud**: paste API key, keep default base URL, Test, Fetch models, pick default.
   - **Ollama (local)**: install + `ollama serve`, `ollama pull llama3.1`, base URL
     `http://localhost:11434`, Test, Fetch models, pick default.
   - **LM Studio / llama.cpp / vLLM**: start server with OpenAI-compatible endpoint,
     add as *OpenAI-Compatible*, set base URL (e.g. `http://localhost:1234/v1`).
3. Repeat for as many providers as you like. Routing + fallback use all enabled providers.

Keys are encrypted at rest (AES-256-GCM via `SECRET_ENCRYPTION_KEY`) and never sent to the browser.

## Local-model setup (Ollama)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull llama3.1        # general chat
ollama pull qwen2.5-coder   # coding
```

Then add an **Ollama (local)** provider in Ragnarok pointing at `http://localhost:11434`.
Enable **Privacy Mode** to force local-only operation.

## Automations scheduler (optional)

Automations store schedules in the DB. To run due automations in the background:

```bash
# every minute via cron:
* * * * * cd /path/to/Ragnarok-AI && npx tsx scripts/scheduler.ts >> data/scheduler.log 2>&1
```

Or run once manually: `npx tsx scripts/scheduler.ts --once`.

## Updating

```bash
git pull
npm install
npx drizzle-kit push
npm run build
# restart: docker compose up --build -d   (or npm start)
```

Back up first via **Settings → Backup & restore → Download backup**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “No enabled providers” | Add a provider in Providers settings (cloud key or Ollama). |
| Ollama test fails | Is `ollama serve` running? Check firewall, base URL, `curl localhost:11434/api/tags`. |
| “Model not found” | Model retired/renamed — Providers → Fetch models → pick a new default. |
| Auth failed | Key wrong/expired — rotate it (Configure → Replace API key). |
| Search fails in Privacy Mode | Expected: configure self-hosted SearXNG or disable Privacy Mode. |
| Agent stuck “awaiting approval” | Open Tasks → select task → Approve/Reject. |
| DB connection errors | Check `DATABASE_URL`; for Docker ensure `db` service is healthy. |
| Secrets in logs? | Never by design — keys are redacted; report any leak as a bug. |

## Security notes

- Bind to `localhost` by default. For phone-away-from-home access use a **VPN**
  (Tailscale/WireGuard) or authenticated reverse proxy — never expose the port publicly.
- Workspace file access is sandboxed per project; paths cannot escape (`..` blocked).
- Web/file/tool content is treated as **untrusted data**, never as instructions.
- Code execution: Python-only, 10s timeout, network/subprocess modules blocked.

## Docs

- `ARCHITECTURE.md` — components, model/tool layers, agent loop, memory, permissions, security boundaries
- `ADDING_PROVIDER.md` — integrate a new AI provider
- `ADDING_TOOL.md` — add a new tool
