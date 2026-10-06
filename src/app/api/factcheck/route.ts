import { NextRequest, NextResponse } from "next/server";
import { webSearch, fetchWebpage } from "@/lib/search/providers";
import { routeRequest } from "@/lib/router/router";
import { chatWithFallback } from "@/lib/llm/chat";
import { getSettings } from "@/lib/server-settings";

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const claim = String(body.claim || "").trim();
    if (!claim) return NextResponse.json({ error: "Claim required" }, { status: 400 });
    const settings = await getSettings();
    const privacyMode = body.privacyMode ?? settings.privacyMode;

    // 1. Search for evidence (2-3 queries)
    const queries = [claim.slice(0, 300), `${claim.slice(0, 200)} fact check`, `${claim.slice(0, 200)} evidence`];
    const allResults: Array<{ title: string; url: string; snippet: string; source: string }> = [];
    for (const q of queries.slice(0, 3)) {
      try {
        const r = await webSearch(q, { maxResults: 5, privacyMode });
        for (const hit of r.results) {
          if (!allResults.some((x) => x.url === hit.url)) allResults.push(hit);
        }
      } catch { /* continue */ }
    }
    // 2. Fetch top pages for depth
    const pages: Array<{ title: string; text: string; url: string }> = [];
    for (const hit of allResults.slice(0, 4)) {
      try {
        const p = await fetchWebpage(hit.url, { maxChars: 6000 });
        pages.push(p);
      } catch { /* skip */ }
    }
    if (!allResults.length) {
      return NextResponse.json({
        verdict: "insufficient_evidence",
        summary: "Could not retrieve any web sources to evaluate this claim. Check your network connection or configure a search connector.",
        sources: [],
      });
    }
    // 3. LLM adjudication with real evidence only
    const decision = await routeRequest({ text: `Fact check: ${claim}`, privacyMode });
    const evidence = [
      ...allResults.map((r, i) => `[${i + 1}] ${r.title} (${r.source})\n${r.url}\n${r.snippet}`),
      ...pages.map((p) => `PAGE ${p.url}:\n${p.text.slice(0, 4000)}`),
    ].join("\n\n").slice(0, 20000);

    const { result } = await chatWithFallback({
      primary: decision.provider,
      model: decision.model,
      fallbackChain: decision.fallbackChain,
      messages: [
        {
          role: "system",
          content: `You are a careful fact-checker. Given a CLAIM and EVIDENCE from live web sources, return a verdict.\nVerdicts: supported | mostly_supported | mixed | unsupported | misleading | insufficient_evidence.\nRules: Base the verdict ONLY on the provided evidence. Cite sources as [n] with their URLs. If evidence is thin or conflicting, say so — never force a confident verdict. Quote key evidence briefly. Format:\nVERDICT: <verdict>\nCONFIDENCE: low|medium|high\nSUMMARY: <2-4 sentences>\nEVIDENCE:\n- [n] <what this source shows> (<url>)\nCAVEATS: <what's unknown or uncertain>`,
        },
        { role: "user", content: `CLAIM:\n${claim}\n\nEVIDENCE:\n${evidence}` },
      ],
      temperature: 0.2,
    });
    return NextResponse.json({
      verdict: /VERDICT:\s*([a-z_]+)/i.exec(result.content)?.[1] || "insufficient_evidence",
      analysis: result.content,
      sources: allResults.map((r, i) => ({ n: i + 1, ...r })),
      model: `${decision.provider.name}/${decision.model}`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
