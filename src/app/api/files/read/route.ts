import { NextRequest, NextResponse } from "next/server";
import { safeResolve, isTextReadable } from "@/lib/files/workspace";
import fs from "node:fs/promises";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
    const relPath = req.nextUrl.searchParams.get("path") || "";
    if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });
    const abs = await safeResolve(projectId, relPath);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (stat.size > 500000) return NextResponse.json({ error: "File too large to preview." }, { status: 400 });
    if (!isTextReadable(relPath)) return NextResponse.json({ error: "Binary file — preview unavailable in V1." }, { status: 400 });
    const content = await fs.readFile(abs, "utf8");
    return NextResponse.json({ path: relPath, size: stat.size, content: content.slice(0, 60000) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
