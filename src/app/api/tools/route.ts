import { NextResponse } from "next/server";
import { listTools, getPermissionMap, isToolAvailable } from "@/lib/tools/registry";

export async function GET() {
  try {
    const perms = await getPermissionMap();
    const tools = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      riskLevel: t.riskLevel,
      policy: perms[t.name],
      available: isToolAvailable(t.name),
      parameters: t.parameters,
    }));
    return NextResponse.json({ tools });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
