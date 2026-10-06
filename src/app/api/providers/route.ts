import { NextRequest, NextResponse } from "next/server";
import { listProvidersSafe, createProvider } from "@/lib/providers/manager";
import { getAdapter } from "@/lib/providers/registry";
import { z } from "zod";

export async function GET() {
  try {
    const providers = await listProvidersSafe();
    const adapterTypes = ["openai", "anthropic", "google", "xai", "ollama", "openai_compatible"].map((t) => {
      const a = getAdapter(t);
      return { type: t, label: a?.label, defaultBaseUrl: a?.defaultBaseUrl, requiresApiKey: a?.requiresApiKey, isLocalKind: a?.isLocalKind };
    });
    return NextResponse.json({ providers, adapterTypes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["openai", "anthropic", "google", "xai", "ollama", "openai_compatible"]),
  baseUrl: z.string().max(500).optional().default(""),
  apiKey: z.string().max(2000).optional().default(""),
  isLocal: z.boolean().optional(),
  defaultModel: z.string().max(200).optional().default(""),
  assignedCapabilities: z.array(z.string()).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
    const row = await createProvider(parsed.data);
    return NextResponse.json({ id: row.id, message: "Provider added. Test the connection next." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
