import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, conversations, memories } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rows = await db.select().from(projects).where(eq(projects.id, id));
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const convs = await db.select().from(conversations).where(eq(conversations.projectId, id));
    const mems = await db.select().from(memories).where(eq(memories.projectId, id));
    return NextResponse.json({ project: rows[0], conversations: convs, memories: mems });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const allowed = ["name", "description", "instructions", "routingMode", "preferredProviderId", "preferredModel", "toolPermissions", "allowCrossProjectMemory", "color"] as const;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    await db.update(projects).set(patch).where(eq(projects.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Unlink conversations instead of deleting them
    await db.update(conversations).set({ projectId: null }).where(eq(conversations.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
