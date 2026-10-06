import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt)).limit(200);
    return NextResponse.json({ projects: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const [row] = await db.insert(projects).values({
      name: String(body.name).slice(0, 100),
      description: String(body.description || "").slice(0, 2000),
      instructions: String(body.instructions || "").slice(0, 8000),
      routingMode: body.routingMode || "auto",
      preferredProviderId: body.preferredProviderId || null,
      preferredModel: body.preferredModel || "",
      color: body.color || "#6366f1",
      allowCrossProjectMemory: Boolean(body.allowCrossProjectMemory),
    }).returning();
    return NextResponse.json({ project: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
