# Repair log — `repair/app-startup`

Diagnosis and fixes for why Ragnarok failed to build, deploy, or initialise its database.
No features were removed; changes are limited to startup, build, and configuration paths.

## Problems found and fixed

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `npm run build` fails: `Error: DATABASE_URL is required` / `Failed to collect page data for /api/agent/approvals`. Breaks every Docker build (no DB env at build time). | `src/db/index.ts` threw at **import** time; `next build` imports every route module while collecting page data. | The DB connection is now created lazily on first use. A missing `DATABASE_URL` still raises the same clear error, but only when a query runs. Regression test: `tests/db-lazy-connection.test.mjs`. |
| 2 | `npx drizzle-kit push` (per README) created tables in the wrong database; the app then failed with "relation does not exist". | `drizzle.config.json` hardcoded `postgres:postgres@…/app_db`, while the app, `.env.example` and Docker Compose use `nexus:nexus@…/nexus`. JSON config can't read env vars. | Replaced it with `drizzle.config.ts`, which reads `DATABASE_URL` from the environment or `.env`. Dockerfile updated to match. |
| 3 | Docker build fails at `COPY --from=builder /app/public ./public`. | No `public/` directory existed in the repo. | Added `public/.gitkeep`. |
| 4 | Dockerfile ran `drizzle-kit push` during image build. | There is no database at build time, so the step always failed (hidden by `|| true`). | Removed that step. The runtime `CMD` still pushes the schema when the container starts. |
| 5 | `npx tsx scripts/scheduler.ts` failed: `no PostgreSQL user name specified`. | The scheduler never loaded `.env`, so `DATABASE_URL` was unset. `tsx` was also only available as a transitive dependency. | Added `import "dotenv/config"`, pinned `tsx` as a devDependency, and added an `npm run scheduler` script. |
| 6 | The documented cron line started a new never-ending scheduler process every minute. | Without `--once`, the script loops with `setInterval` and never exits. | The README and script header now use `npm run scheduler -- --once` for cron. |

## Verification performed (real runs, not just static checks)

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 11/11 pass. The new regression test fails on the old `src/db/index.ts`.
- `npm run build` with `DATABASE_URL` **unset**: succeeds.
- PostgreSQL 16 + README bare-metal flow (`cp .env.example .env` → `npx drizzle-kit push` → `npm run build` → `npm start`): all 16 tables are created in the `nexus` DB, and `/api/health` returns `{"ok":true}`.
- Against the bundled `scripts/mock-llm.mjs` (OpenAI-compatible):
  - Provider create, test, and fetch-models all work.
  - Chat SSE streaming works, and messages persist.
  - "Remember that…" stores a memory.
  - An agent task runs plan → `write_file` tool → completed.
  - `run_code` returns `42`, blocks `subprocess`, and blocks `../` path traversal.
  - All list endpoints return 200.
- Playwright (Chromium): the home page renders. Sending a chat through the UI shows the streamed reply, with zero console errors and zero HTTP errors.
- `npm run dev`: health and home page return 200.
- `npm run scheduler -- --once`: launches a due automation and resumes its task.

## Remaining limitations

- **Docker image not verified end to end.** In the sandbox used for this repair, build containers had no network access. `apk add` failed on DNS or the TLS proxy before reaching the app layers. Every individual problem in the Dockerfile above was fixed, and the same build command passes on the host, but `docker compose up --build` should be run once on a normal machine.
- Real cloud providers (OpenAI, Anthropic, …) and live web search were not exercised: no API keys, restricted egress. The mock provider covers the shared OpenAI-compatible path.
- `next build` prints a harmless Turbopack warning ("whole project was traced unintentionally") caused by the runtime-configurable workspace root in `src/lib/files/workspace.ts`. It only affects output-file tracing and does not affect runtime.
- The Docker `CMD` still uses `drizzle-kit push … || true`, so a schema-push failure at container start is logged but not fatal (pre-existing behaviour, left as is).
- Memory titles from "Remember that X" keep the leading word "that" (cosmetic).
