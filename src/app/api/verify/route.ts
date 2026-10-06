import { NextRequest, NextResponse } from "next/server";
import { routeRequest } from "@/lib/router/router";
import { chatWithFallback } from "@/lib/llm/chat";
import { webSearch } from "@/lib/search/providers";

export const maxDuration = 180;

// Verify mode: independently check an output with a (preferably different) model + optional research pass.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = String(body.content || "").trim();
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
    const kind = body.kind || "general"; // code|research|facts|calculations
    const privacyMode = Boolean(body.privacyMode);

    let evidence = "";
    if (kind === "research" || kind === "facts") {
      try {
        const r = await webSearch(content.slice(0, 300), { maxResults: 5, privacyMode });
        evidence = r.results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.snippet}`).join("\n\n").slice(0, 8000);
      } catch { /* research unavailable; verify from knowledge with caveats */ }
    }

    const decision = await routeRequest({ text: `Verify this ${kind}: ${content.slice(0, 500)}`, privacyMode });
    const { result } = await chatWithFallback({
      primary: decision.provider,
      model: decision.model,
      fallbackChain: decision.fallbackChain,
      messages: [
        {
          role: "system",
          content: `You are an independent verifier. Check the given ${kind} output critically: correctness, flaws, unsupported claims, bugs, or miscalculations.\nBe specific. List issues found (or confirm none), rate confidence, and suggest fixes. Never invent sources; only cite provided evidence.`,
        },
        { role: "user", content: `OUTPUT TO VERIFY:\n${content.slice(0, 12000)}\n\n${evidence ? `EVIDENCE:\n${evidence}` : "(No live evidence retrieved.)"}` },
      ],
      temperature: 0.2,
    });
    return NextResponse.json({ verification: result.content, model: `${decision.provider.name}/${decision.model}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
