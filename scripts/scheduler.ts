/**
 * Ragnarok automation scheduler (V1).
 *
 * Polls the `automations` table for due interval-based automations and
 * launches agent tasks for them. Run every minute via cron:
 *
 *   * * * * * cd /path/to/Ragnarok-AI && npx tsx scripts/scheduler.ts >> data/scheduler.log 2>&1
 *
 * Or once: npx tsx scripts/scheduler.ts --once
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function tick() {
  const { rows } = await pool.query(
    `SELECT * FROM automations WHERE enabled = true AND schedule_kind = 'interval'`
  );
  const now = Date.now();
  for (const a of rows) {
    const minutes = Number(a.schedule_value) || 0;
    if (minutes <= 0) continue;
    const last = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
    if (now - last < minutes * 60 * 1000) continue;
    console.log(`[scheduler] launching automation "${a.name}"`);
    const task = await pool.query(
      `INSERT INTO agent_tasks (goal, project_id, status, max_steps) VALUES ($1, $2, 'pending', 25) RETURNING id`,
      [a.goal, a.project_id]
    );
    await pool.query(
      `UPDATE automations SET last_run_at = NOW(), last_status = 'launched:' || $2 WHERE id = $1`,
      [a.id, String(task.rows[0].id)]
    );
    // NOTE: in V1 the task is picked up on next app interaction or via
    // POST /api/agent/tasks/:id {action:"resume"}. For fully autonomous
    // background running, call the resume endpoint from here when the app
    // is reachable:
    const base = process.env.APP_BASE_URL || "http://localhost:3000";
    try {
      await fetch(`${base}/api/agent/tasks/${task.rows[0].id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      console.log(`[scheduler] resumed task ${task.rows[0].id}`);
    } catch (e) {
      console.log(`[scheduler] task ${task.rows[0].id} pending (app not reachable to auto-start)`);
    }
  }
}

async function main() {
  const once = process.argv.includes("--once");
  await tick();
  if (!once) {
    console.log("[scheduler] sleeping 60s (loop mode; prefer cron in production)");
    setInterval(tick, 60_000);
  } else {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[scheduler] fatal", e);
  process.exit(1);
});
