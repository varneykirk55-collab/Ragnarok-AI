import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { approvals } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { resumeAfterApproval } from "@/lib/agent/runner";
import { executeTool } from "@/lib/tools/registry";

export async function GET() {
  try {
    const rows = await db.select().from(approvals).orderBy(desc(approvals.createdAt)).limit(100);
    return NextResponse.json({ approvals: rows, pending: rows.filter((r) => r.status === "pending") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { approvalId, approved } = body;
    if (!approvalId) return NextResponse.json({ error: "approvalId required" }, { status: 400 });
    const rows = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ap = rows[0];
    if (ap.taskId) {
      await resumeAfterApproval(ap.taskId, approvalId, Boolean(approved));
      return NextResponse.json({ ok: true, resumed: true });
    }
    // Direct (non-agent) approval: execute or reject
    await db.update(approvals).set({ status: approved ? "approved" : "rejected", resolvedAt: new Date() }).where(eq(approvals.id, approvalId));
    if (approved) {
      const payload = (ap.payload ?? {}) as { toolInput?: Record<string, unknown> };
      const res = await executeTool(ap.toolName, (payload.toolInput ?? {}) as Record<string, unknown>, {
        conversationId: ap.conversationId || undefined,
        privacyMode: false,
        workspaceRoot: "",
      }, { skipPermissionCheck: true });
      return NextResponse.json({ ok: true, result: res });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
