import { NextRequest, NextResponse } from "next/server";
import { webSearch, fetchWebpage } from "@/lib/search/providers";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = String(body.query || "").trim();
    if (!query) return NextResponse.json({ error: "Query required" }, { status: 400 });
    if (body.fetchUrl) {
      const page = await fetchWebpage(String(body.fetchUrl), { maxChars: body.maxChars || 12000 });
      return NextResponse.json({ page });
    }
    const res = await webSearch(query, { maxResults: Math.min(20, body.maxResults || 8), privacyMode: Boolean(body.privacyMode) });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
