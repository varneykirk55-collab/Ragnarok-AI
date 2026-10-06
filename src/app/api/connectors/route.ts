import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectors } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { encryptSecret } from "@/lib/crypto";

export async function GET() {
  try {
    const rows = await db.select().from(connectors).orderBy(desc(connectors.createdAt));
    return NextResponse.json({
      connectors: rows.map((r) => ({
        id: r.id, type: r.type, name: r.name, config: r.config,
        enabled: r.enabled, status: r.status, statusMessage: r.statusMessage,
        hasSecrets: Boolean(r.secretsEncrypted),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.type || !body.name) return NextResponse.json({ error: "type and name required" }, { status: 400 });
    const secrets = body.apiKey ? JSON.stringify({ apiKey: body.apiKey }) : JSON.stringify(body.secrets || {});
    const [row] = await db.insert(connectors).values({
      type: body.type,
      name: String(body.name).slice(0, 100),
      config: body.config || {},
      secretsEncrypted: secrets === "{}" ? "" : encryptSecret(secrets),
      enabled: body.enabled ?? true,
    }).returning();
    return NextResponse.json({ connector: { ...row, secretsEncrypted: undefined } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.config !== undefined) patch.config = body.config;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.apiKey) patch.secretsEncrypted = encryptSecret(JSON.stringify({ apiKey: body.apiKey }));
    if (body.clearSecrets) patch.secretsEncrypted = "";
    await db.update(connectors).set(patch).where(eq(connectors.id, body.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db.delete(connectors).where(eq(connectors.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
