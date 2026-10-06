import { NextRequest, NextResponse } from "next/server";
import { executeTool, checkPermission, getTool } from "@/lib/tools/registry";
import { db } from "@/db";
import { approvals } from "@/db/schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { toolName, input, conversationId, projectId, privacyMode } = body;
    const tool = getTool(toolName);
    if (!tool) return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
    const check = await checkPermission(toolName);
    if (check.verdict === "deny") return NextResponse.json({ error: check.reason }, { status: 403 });
    if (check.verdict === "ask" && !body.confirmed) {
      // Create an approval for direct execution
      const [ap] = await db.insert(approvals).values({
        conversationId: conversationId || null,
        toolName,
        action: `${toolName}(${JSON.stringify(input || {}).slice(0, 300)})`,
        payload: { toolInput: input || {} },
        riskLevel: tool.riskLevel,
        status: "pending",
      }).returning();
      return NextResponse.json({ needsApproval: true, approvalId: ap.id, reason: check.reason });
    }
    const res = await executeTool(toolName, input || {}, {
      conversationId, projectId, privacyMode: Boolean(privacyMode), workspaceRoot: "",
    }, { skipPermissionCheck: true });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
