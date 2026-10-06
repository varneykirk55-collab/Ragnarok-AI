import { NextRequest, NextResponse } from "next/server";
import { listResolvedProviders } from "@/lib/providers/manager";
import { getAdapter } from "@/lib/providers/registry";

export const maxDuration = 180;

// V1: OpenAI-compatible image generation + free Pollinations fallback (clearly labeled).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    const size = body.size || "1024x1024";

    // 1. Try configured OpenAI-compatible providers with explicit image model
    const providers = await listResolvedProviders({ enabledOnly: true });
    const errors: string[] = [];
    if (body.providerId) {
      const p = providers.find((x) => x.id === body.providerId);
      if (p) {
        const adapter = getAdapter(p.type);
        if (adapter?.generateImage) {
          try {
            const out = await adapter.generateImage(p.apiKey, p.baseUrl, {
              model: body.model || p.defaultModel || "dall-e-3",
              prompt,
              size,
            });
            return NextResponse.json({ ...out, provider: p.name, model: body.model || p.defaultModel });
          } catch (e) {
            errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          errors.push(`${p.name} does not support image generation.`);
        }
      }
    } else {
      for (const p of providers.filter((x) => ["openai", "openai_compatible"].includes(x.type))) {
        const adapter = getAdapter(p.type);
        if (!adapter?.generateImage) continue;
        const model = /dall-e|gpt-image|flux|sd3|image/i.test(p.defaultModel) ? p.defaultModel : "dall-e-3";
        try {
          const out = await adapter.generateImage(p.apiKey, p.baseUrl, { model, prompt, size });
          return NextResponse.json({ ...out, provider: p.name, model });
        } catch (e) {
          errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // 2. Free fallback: Pollinations.ai (no key, rate-limited, clearly labeled)
    if (!body.noFallback) {
      try {
        const encoded = encodeURIComponent(prompt.slice(0, 1000));
        const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`;
        // Verify it responds
        const head = await fetch(url, { method: "GET", signal: AbortSignal.timeout(60000) });
        if (!head.ok) throw new Error(`Pollinations returned HTTP ${head.status}`);
        const buf = Buffer.from(await head.arrayBuffer());
        if (buf.length < 5000) throw new Error("Pollinations returned an unexpectedly small image.");
        return NextResponse.json({
          url,
          b64: buf.toString("base64"),
          provider: "pollinations (free fallback)",
          model: "flux",
          notice: "Generated with the free Pollinations fallback. Configure an OpenAI-compatible image provider for private/paid generation.",
        });
      } catch (e) {
        errors.push(`free fallback: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return NextResponse.json({ error: `Image generation unavailable. ${errors.join(" ")}` }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
