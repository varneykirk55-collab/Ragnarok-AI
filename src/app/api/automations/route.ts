import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentTasks, automations } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { runAgentTask } from "@/lib/agent/runner";

export async function GET() {
  try {
    const rows = await db.select().from(automations).orderBy(desc(automations.createdAt)).limit(100);
    return NextResponse.json({
      automations: rows,
      note: "V1: automations store schedules locally and support Run Now. Background cron execution runs when the scheduler is enabled (see docs).",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim() || !body.goal?.trim())
      return NextResponse.json({ error: "Name and goal required" }, { status: 400 });
    const [row] = await db.insert(automations).values({
      name: String(body.name).slice(0, 120),
      description: String(body.description || "").slice(0, 1000),
      scheduleKind: body.scheduleKind || "interval",
      scheduleValue: String(body.scheduleValue || "1440"),
      goal: String(body.goal).slice(0, 5000),
      projectId: body.projectId || null,
      enabled: body.enabled ?? true,
    }).returning();
    return NextResponse.json({ automation: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
