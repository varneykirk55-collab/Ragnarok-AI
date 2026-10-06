import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentTasks } from "@/db/schema";
import { desc } from "drizzle-orm";
import { runAgentTask } from "@/lib/agent/runner";
import { getSettings } from "@/lib/server-settings";

export const maxDuration = 300;

export async function GET() {
  try {
    const rows = await db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt)).limit(100);
    return NextResponse.json({ tasks: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const goal = String(body.goal || "").trim();
    if (!goal) return NextResponse.json({ error: "Goal required" }, { status: 400 });
    const settings = await getSettings();
    const [row] = await db.insert(agentTasks).values({
      goal: goal.slice(0, 5000),
      conversationId: body.conversationId || null,
      projectId: body.projectId || null,
      status: "pending",
      maxSteps: body.maxSteps || settings.agentMaxSteps || 25,
      privacyMode: Boolean(body.privacyMode || settings.privacyMode),
      routingMode: body.routingMode || settings.routingMode || "auto",
    }).returning();
    // Start in background (fire and forget; UI polls)
    void runAgentTask(row.id!).catch(() => {});
    return NextResponse.json({ task: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
