import type { ChatOptions, ChatResult, ProviderAdapter, ProviderModelInfo, ToolCallRequest } from "./types";

const DEFAULT_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

export const anthropicAdapter: ProviderAdapter = {
  type: "anthropic",
  label: "Anthropic",
  defaultBaseUrl: DEFAULT_BASE,
  requiresApiKey: true,
  isLocalKind: false,
  capabilities: ["text", "reasoning", "toolCalling", "vision", "streaming"],
  async listModels(apiKey): Promise<ProviderModelInfo[]> {
    // Anthropic models API requires specific headers; try it, fall back to curated list.
    try {
      const res = await fetch(`${DEFAULT_BASE}/models?limit=50`, {
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const json = await res.json();
        const data = (json.data ?? []) as Array<{ id: string; display_name?: string }>;
        if (data.length)
          return data.map((m) => ({
            id: m.id,
            displayName: m.display_name || m.id,
            capabilities: { text: true, reasoning: true, toolCalling: true, vision: true, streaming: true },
            ownedBy: "anthropic",
          }));
      }
    } catch {
      // fall through
    }
    // Curated fallback (clearly dynamic-capable when API allows)
    return [
      "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-haiku-4-5",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022",
    ].map((id) => ({
      id,
      displayName: id,
      capabilities: { text: true, reasoning: true, toolCalling: true, vision: true, streaming: true },
      ownedBy: "anthropic",
    }));
  },
  async testConnection(apiKey) {
    const start = Date.now();
    if (!apiKey) return { ok: false, message: "API key is required." };
    try {
      const res = await fetch(`${DEFAULT_BASE}/models?limit=1`, {
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, message: "Invalid API key (authentication rejected)." };
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, message: `Anthropic returned HTTP ${res.status}: ${t.slice(0, 200)}` };
      }
      return { ok: true, message: "Connection verified.", latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : String(e) };
    }
  },
  async chat(apiKey, _baseUrl, cOpts: ChatOptions): Promise<ChatResult> {
    const system = cOpts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const msgs: Array<Record<string, unknown>> = [];
    for (const m of cOpts.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        msgs.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const t of m.toolCalls) blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.arguments });
        msgs.push({ role: "assistant", content: blocks });
        continue;
      }
      msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }
    const body: Record<string, unknown> = {
      model: cOpts.model,
      messages: msgs,
      max_tokens: cOpts.maxTokens ?? 4096,
      temperature: cOpts.temperature ?? 0.7,
      stream: true,
    };
    if (system) body.system = system;
    if (cOpts.tools?.length)
      body.tools = cOpts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

    const res = await fetch(`${DEFAULT_BASE}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
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
    // Parse SSE stream
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";
    const toolAcc = new Map<number, { id: string; name: string; input: string }>();
    let tokensIn = 0;
    let tokensOut = 0;
    let stopReason = "end_turn";
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
          if (json.type === "message_start" && json.message?.usage) {
            tokensIn = json.message.usage.input_tokens ?? 0;
          } else if (json.type === "content_block_start") {
            const idx = json.index as number;
            const block = json.content_block;
            if (block?.type === "tool_use")
              toolAcc.set(idx, { id: block.id, name: block.name, input: "" });
          } else if (json.type === "content_block_delta") {
            const idx = json.index as number;
            const d = json.delta;
            if (d?.type === "text_delta" && d.text) {
              content += d.text;
              cOpts.onToken?.(d.text);
            } else if (d?.type === "input_json_delta" && d.partial_json) {
              const prev = toolAcc.get(idx);
              if (prev) prev.input += d.partial_json;
            }
          } else if (json.type === "message_delta") {
            tokensOut = json.usage?.output_tokens ?? tokensOut;
            if (json.delta?.stop_reason) stopReason = json.delta.stop_reason;
          }
        } catch { /* partial */ }
      }
    }
    const toolCalls: ToolCallRequest[] = [...toolAcc.values()].map((t) => {
      let args: Record<string, unknown> = {};
      try { args = t.input ? JSON.parse(t.input) : {}; } catch { args = { _raw: t.input }; }
      return { id: t.id, name: t.name, arguments: args };
    });
    if (toolCalls.length) cOpts.onToolCalls?.(toolCalls);
    if (!tokensIn) tokensIn = estimateTokens(cOpts.messages.map((m) => m.content).join("\n"));
    if (!tokensOut) tokensOut = estimateTokens(content);
    return { content, toolCalls, tokensIn, tokensOut, model: cOpts.model, finishReason: stopReason };
  },
};
