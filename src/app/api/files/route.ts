import { NextRequest, NextResponse } from "next/server";
import { safeResolve, listWorkspaceFiles } from "@/lib/files/workspace";
import fs from "node:fs/promises";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
    const files = await listWorkspaceFiles(projectId);
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const projectId = (form.get("projectId") as string) || undefined;
    const file = form.get("file") as File | null;
    const relPath = (form.get("path") as string) || "";
    if (file) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) return NextResponse.json({ error: "File exceeds 10MB limit." }, { status: 400 });
      const target = relPath || `uploads/${file.name}`;
      const abs = await safeResolve(projectId, target);
      const pathMod = await import("node:path");
      await fs.mkdir(pathMod.dirname(abs), { recursive: true });
      await fs.writeFile(abs, buf);
      return NextResponse.json({ ok: true, path: target, bytes: buf.length });
    }
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const projectId = searchParams.get("projectId") || undefined;
    const relPath = searchParams.get("path") || "";
    if (!relPath) return NextResponse.json({ error: "path required" }, { status: 400 });
    const abs = await safeResolve(projectId, relPath);
    await fs.rm(abs, { force: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
