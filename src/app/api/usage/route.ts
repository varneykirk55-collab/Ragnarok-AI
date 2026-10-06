import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usage/tracker";

export async function GET() {
  try {
    const stats = await getUsageStats();
    return NextResponse.json({ ...stats, note: "Costs are estimates from public pricing tables unless the provider reports exact usage. Local models cost $0." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
