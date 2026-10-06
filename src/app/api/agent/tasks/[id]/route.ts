import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentTasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTaskWithSteps, requestStop, runAgentTask } from "@/lib/agent/runner";

export const maxDuration = 120;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await getTaskWithSteps(id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    if (action === "stop") {
      requestStop(id);
      await db.update(agentTasks).set({ status: "stopped", completedAt: new Date(), updatedAt: new Date() }).where(eq(agentTasks.id, id));
      return NextResponse.json({ ok: true });
    }
    if (action === "resume" || action === "retry") {
      await db.update(agentTasks).set({ status: "running", updatedAt: new Date(), error: "" }).where(eq(agentTasks.id, id));
      void runAgentTask(id).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (action === "pause") {
      await db.update(agentTasks).set({ status: "paused", updatedAt: new Date() }).where(eq(agentTasks.id, id));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    requestStop(id);
    await db.delete(agentTasks).where(eq(agentTasks.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
