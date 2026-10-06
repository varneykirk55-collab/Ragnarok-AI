import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { desc } from "drizzle-orm";
import { createMemory, retrieveMemories } from "@/lib/memory/store";

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams.get("q") || "";
    const category = req.nextUrl.searchParams.get("category") || "";
    const projectId = req.nextUrl.searchParams.get("projectId") || "";
    const query = req.nextUrl.searchParams.get("retrieve") || "";
    if (query) {
      const mems = await retrieveMemories(query, { projectId: projectId || undefined, limit: 12 });
      return NextResponse.json({ memories: mems });
    }
    let rows = await db.select().from(memories).orderBy(desc(memories.pinned), desc(memories.updatedAt)).limit(500);
    if (category) rows = rows.filter((r) => r.category === category);
    if (projectId) rows = rows.filter((r) => !r.projectId || r.projectId === projectId);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => (r.title + " " + r.content).toLowerCase().includes(s));
    }
    return NextResponse.json({ memories: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.content?.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 });
    const row = await createMemory({
      content: String(body.content).slice(0, 5000),
      category: body.category || "general",
      title: body.title || undefined,
      projectId: body.projectId || undefined,
      importance: body.importance ?? 5,
    });
    return NextResponse.json({ memory: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
