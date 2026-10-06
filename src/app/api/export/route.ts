import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, memories, projects, agentTasks, taskSteps, providers, toolPermissions, settings, automations, usageEvents } from "@/db/schema";

export async function GET() {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      app: "ragnarok-personal-ai",
      version: 1,
      conversations: await db.select().from(conversations).catch(() => []),
      messages: await db.select().from(messages).catch(() => []),
      memories: await db.select().from(memories).catch(() => []),
      projects: await db.select().from(projects).catch(() => []),
      agentTasks: await db.select().from(agentTasks).catch(() => []),
      taskSteps: await db.select().from(taskSteps).catch(() => []),
      // Providers WITHOUT secrets
      providers: (await db.select().from(providers).catch(() => [])).map((p) => ({ ...p, apiKeyEncrypted: "" })),
      toolPermissions: await db.select().from(toolPermissions).catch(() => []),
      settings: await db.select().from(settings).catch(() => []),
      automations: await db.select().from(automations).catch(() => []),
      usageEvents: await db.select().from(usageEvents).catch(() => []),
      notice: "API keys are never exported. Re-enter provider credentials after restore.",
    };
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="ragnarok-backup-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
