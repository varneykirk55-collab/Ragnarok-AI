import type { ChatOptions, ChatResult, ProviderAdapter, ProviderModelInfo, ToolCallRequest } from "./types";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

export const googleAdapter: ProviderAdapter = {
  type: "google",
  label: "Google",
  defaultBaseUrl: DEFAULT_BASE,
  requiresApiKey: true,
  isLocalKind: false,
  capabilities: ["text", "reasoning", "toolCalling", "vision", "streaming"],
  async listModels(apiKey): Promise<ProviderModelInfo[]> {
    const res = await fetch(`${DEFAULT_BASE}/models?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Google model list failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const data = (json.models ?? []) as Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }>;
    return data
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => ({
        id: m.name.replace(/^models\//, ""),
        displayName: m.displayName || m.name.replace(/^models\//, ""),
        capabilities: { text: true, streaming: true, toolCalling: true, vision: true },
        contextWindow: m.inputTokenLimit,
        ownedBy: "google",
      }));
  },
  async testConnection(apiKey) {
    const start = Date.now();
    if (!apiKey) return { ok: false, message: "API key is required." };
    try {
      const res = await fetch(`${DEFAULT_BASE}/models?key=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const t = await res.text().catch(() => "");
        if (t.includes("API key") || res.status !== 400)
          return { ok: false, message: "Invalid API key (authentication rejected)." };
      }
      if (!res.ok) return { ok: false, message: `Google returned HTTP ${res.status}.` };
      return { ok: true, message: "Connection verified.", latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
  },
  async chat(apiKey, _baseUrl, cOpts: ChatOptions): Promise<ChatResult> {
    const system = cOpts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents: Array<Record<string, unknown>> = [];
    for (const m of cOpts.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: m.name || "tool", response: { result: m.content } } }],
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        contents.push({
          role: "model",
          parts: [
            ...(m.content ? [{ text: m.content }] : []),
            ...m.toolCalls.map((t) => ({ functionCall: { name: t.name, args: t.arguments } })),
          ],
        });
        continue;
      }
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: cOpts.temperature ?? 0.7, maxOutputTokens: cOpts.maxTokens ?? 4096 },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (cOpts.tools?.length)
      body.tools = [{ functionDeclarations: cOpts.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];

    const url = `${DEFAULT_BASE}/models/${encodeURIComponent(cOpts.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: cOpts.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`AUTH:${t.slice(0, 300)}`), { code: "AUTH" });
      if (res.status === 429) throw Object.assign(new Error(`RATE_LIMIT:${t.slice(0, 300)}`), { code: "RATE_LIMIT" });
      if (res.status === 404) throw Object.assign(new Error(`MODEL_NOT_FOUND:${t.slice(0, 300)}`), { code: "MODEL_NOT_FOUND" });
      if (res.status >= 500) throw Object.assign(new Error(`PROVIDER_5XX:${t.slice(0, 200)}`), { code: "PROVIDER_5XX" });
      throw new Error(t.slice(0, 400));
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCalls: ToolCallRequest[] = [];
    let finishReason = "STOP";
    let tokensIn = 0;
    let tokensOut = 0;
    for (;;) {
      if (cOpts.signal?.aborted) { try { reader.cancel(); } catch {} break; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        try {
          const json = JSON.parse(data);
          const cands = json.candidates ?? [];
          for (const c of cands) {
            for (const part of c.content?.parts ?? []) {
              if (typeof part.text === "string" && part.text) {
                content += part.text;
                cOpts.onToken?.(part.text);
              }
              if (part.functionCall) {
                toolCalls.push({
                  id: `call_${toolCalls.length}`,
                  name: part.functionCall.name,
                  arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
                });
              }
            }
            if (c.finishReason) finishReason = c.finishReason;
          }
          if (json.usageMetadata) {
            tokensIn = json.usageMetadata.promptTokenCount ?? tokensIn;
            tokensOut = json.usageMetadata.candidatesTokenCount ?? tokensOut;
          }
        } catch { /* partial */ }
      }
    }
    if (toolCalls.length) cOpts.onToolCalls?.(toolCalls);
    if (!tokensIn) tokensIn = estimateTokens(cOpts.messages.map((m) => m.content).join("\n"));
    if (!tokensOut) tokensOut = estimateTokens(content);
    return { content, toolCalls, tokensIn, tokensOut, model: cOpts.model, finishReason };
  },
};
