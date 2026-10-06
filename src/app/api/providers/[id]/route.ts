import { NextRequest, NextResponse } from "next/server";
import { updateProvider, deleteProvider, testProvider, fetchAndStoreModels, listStoredModels } from "@/lib/providers/manager";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rows = await db.select().from(providers).where(eq(providers.id, id));
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    const stored = await listStoredModels(id).catch(() => []);
    return NextResponse.json({
      provider: {
        id: r.id, name: r.name, type: r.type, baseUrl: r.baseUrl, enabled: r.enabled,
        isLocal: r.isLocal, status: r.status, statusMessage: r.statusMessage,
        lastCheckedAt: r.lastCheckedAt, defaultModel: r.defaultModel,
        fallbackModels: r.fallbackModels, assignedCapabilities: r.assignedCapabilities,
        hasApiKey: Boolean(r.apiKeyEncrypted),
      },
      models: stored,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await updateProvider(id, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteProvider(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    if (action === "test") {
      const result = await testProvider(id, body.model);
      return NextResponse.json(result);
    }
    if (action === "fetch-models") {
      const list = await fetchAndStoreModels(id);
      return NextResponse.json({ models: list, count: list.length });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
