import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentTasks, automations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAgentTask } from "@/lib/agent/runner";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const allowed = ["name", "description", "scheduleKind", "scheduleValue", "goal", "projectId", "enabled"] as const;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    await db.update(automations).set(patch).where(eq(automations.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.delete(automations).where(eq(automations.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rows = await db.select().from(automations).where(eq(automations.id, id));
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const a = rows[0];
    const [task] = await db.insert(agentTasks).values({
      goal: a.goal,
      projectId: a.projectId,
      status: "pending",
      maxSteps: 25,
    }).returning();
    await db.update(automations).set({ lastRunAt: new Date(), lastStatus: "started" }).where(eq(automations.id, id));
    void runAgentTask(task.id!).catch(() => {});
    return NextResponse.json({ taskId: task.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
