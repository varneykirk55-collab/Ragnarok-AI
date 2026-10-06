import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { desc, ilike, or } from "drizzle-orm";
import { getSettings } from "@/lib/server-settings";

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q") || "";
    const projectId = req.nextUrl.searchParams.get("projectId");
    let rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(200);
    if (projectId) rows = rows.filter((r) => r.projectId === projectId);
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(s));
    }
    return NextResponse.json({ conversations: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const settings = await getSettings();
    const [row] = await db.insert(conversations).values({
      title: (body.title as string) || "New conversation",
      projectId: (body.projectId as string) || null,
      routingMode: (body.routingMode as string) || settings.routingMode || "auto",
      selectedProviderId: (body.selectedProviderId as string) || null,
      selectedModel: (body.selectedModel as string) || "",
      agentMode: Boolean(body.agentMode),
      privacyMode: body.privacyMode ?? settings.privacyMode ?? false,
      systemPrompt: (body.systemPrompt as string) || "",
    }).returning();
    return NextResponse.json({ conversation: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
