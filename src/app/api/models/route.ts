import { NextResponse } from "next/server";
import { listProvidersSafe, listStoredModels } from "@/lib/providers/manager";

type StoredModel = Awaited<ReturnType<typeof listStoredModels>>[number];

export async function GET() {
  try {
    const providers = await listProvidersSafe();
    const stored: StoredModel[] = await listStoredModels().catch(() => []);
    const byProvider: Record<string, StoredModel[]> = {};
    for (const m of stored) {
      if (!byProvider[m.providerId]) byProvider[m.providerId] = [];
      byProvider[m.providerId].push(m);
    }
    return NextResponse.json({
      providers: providers.map((p) => ({
        ...p,
        models: byProvider[p.id] || [],
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
