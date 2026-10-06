import { NextRequest, NextResponse } from "next/server";
import { setToolPolicy, getTool } from "@/lib/tools/registry";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { toolName, policy } = body;
    if (!getTool(toolName)) return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
    if (!["always_allow", "ask", "always_ask", "deny"].includes(policy))
      return NextResponse.json({ error: "Invalid policy" }, { status: 400 });
    await setToolPolicy(toolName, policy);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
