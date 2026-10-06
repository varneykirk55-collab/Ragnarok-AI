import { NextResponse } from "next/server";
import { getLogs } from "@/lib/logger";

export async function GET() {
  try {
    const logs = await getLogs(200);
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
