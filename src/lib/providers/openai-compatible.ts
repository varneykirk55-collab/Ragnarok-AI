import type {
  ChatOptions,
  ChatResult,
  ProviderAdapter,
  ProviderModelInfo,
  ProviderType,
  ToolCallRequest,
} from "./types";

function baseUrlOf(baseUrl: string, fallback: string): string {
  const b = (baseUrl || fallback).trim().replace(/\/+$/, "");
  return b;
}

function toOpenAITools(tools?: ChatOptions["tools"]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

async function readSSE(
  res: Response,
  onToken?: (t: string) => void,
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCallRequest[]; finishReason: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let content = "";
  let finishReason = "stop";
  const toolCallAcc = new Map<number, { id: string; name: string; args: string }>();
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let buffer = "";
  for (;;) {
    if (signal?.aborted) {
      try { reader.cancel(); } catch {}
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (json.usage) usage = json.usage;
        if (delta?.content) {
          content += delta.content;
          onToken?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const prev = toolCallAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) prev.id = tc.id;
            if (tc.function?.name) prev.name = tc.function.name;
            if (tc.function?.arguments) prev.args += tc.function.arguments;
            toolCallAcc.set(idx, prev);
          }
        }
        if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
      } catch {
        // ignore partial chunks
      }
    }
  }
  const toolCalls: ToolCallRequest[] = [...toolCallAcc.values()]
    .filter((t) => t.name)
    .map((t, i) => {
      let args: Record<string, unknown> = {};
      try { args = t.args ? JSON.parse(t.args) : {}; } catch { args = { _raw: t.args }; }
      return { id: t.id || `call_${i}`, name: t.name, arguments: args };
    });
  return { content, toolCalls, finishReason, usage };
}

function makeAdapter(
  type: ProviderType,
  label: string,
  defaultBaseUrl: string,
  opts: { requiresApiKey: boolean; isLocalKind: boolean; modelsPath: string }
): ProviderAdapter {
  return {
    type,
    label,
    defaultBaseUrl,
    requiresApiKey: opts.requiresApiKey,
    isLocalKind: opts.isLocalKind,
    capabilities: ["text", "reasoning", "toolCalling", "vision", "streaming"],
    async listModels(apiKey, baseUrl): Promise<ProviderModelInfo[]> {
      const base = baseUrlOf(baseUrl, defaultBaseUrl);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      // Ollama uses /api/tags
      if (type === "ollama") {
        const res = await fetch(`${base}/api/tags`, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
        const json = await res.json();
        const models = (json.models ?? []) as Array<{ name: string; details?: { parameter_size?: string } }>;
        return models.map((m) => ({
          id: m.name,
          displayName: m.name,
          capabilities: { text: true, reasoning: true, streaming: true, toolCalling: false },
          ownedBy: "ollama",
        }));
      }
      const res = await fetch(`${base}${opts.modelsPath}`, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Model list failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      const data = (json.data ?? []) as Array<{ id: string; owned_by?: string; context_window?: number }>;
      return data.map((m) => ({
        id: m.id,
        displayName: m.id,
        capabilities: { text: true, streaming: true },
        contextWindow: m.context_window,
        ownedBy: m.owned_by,
      })).sort((a, b) => a.id.localeCompare(b.id));
    },
    async testConnection(apiKey, baseUrl, model) {
      const start = Date.now();
      try {
        const base = baseUrlOf(baseUrl, defaultBaseUrl);
        if (type === "ollama") {
          const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(12000) });
          if (!res.ok) return { ok: false, message: `Ollama unreachable (HTTP ${res.status}). Is Ollama running?` };
          const json = await res.json();
          const n = (json.models ?? []).length;
          return { ok: true, message: `Connected to Ollama. ${n} local model(s) available.`, latencyMs: Date.now() - start };
        }
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(`${base}${opts.modelsPath}`, { headers, signal: AbortSignal.timeout(15000) });
        if (res.status === 401 || res.status === 403)
          return { ok: false, message: "Invalid API key (authentication rejected)." };
        if (!res.ok) return { ok: false, message: `Endpoint returned HTTP ${res.status}. Check base URL.` };
        // Optional tiny chat probe when a model is provided
        if (model) {
          const probe = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 5 }),
            signal: AbortSignal.timeout(30000),
          });
          if (!probe.ok) {
            const t = await probe.text().catch(() => "");
            return { ok: false, message: `Connected, but model "${model}" probe failed: ${t.slice(0, 200)}` };
          }
        }
        return { ok: true, message: "Connection verified.", latencyMs: Date.now() - start };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("timeout") || msg.includes("Timeout")) return { ok: false, message: "Connection timed out. Check host/port and network." };
        if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED"))
          return { ok: false, message: "Cannot reach endpoint (connection refused). Check base URL and that the server is running." };
        return { ok: false, message: msg.slice(0, 300) };
      }
    },
    async chat(apiKey, baseUrl, cOpts: ChatOptions): Promise<ChatResult> {
      const base = baseUrlOf(baseUrl, defaultBaseUrl);
      // Ollama: use OpenAI-compat endpoint /v1/chat/completions (available in modern Ollama)
      // Fall back to /api/chat if needed.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const body: Record<string, unknown> = {
        model: cOpts.model,
        messages: cOpts.messages.map((m) => {
          if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
          if (m.role === "assistant" && m.toolCalls?.length)
            return {
              role: "assistant",
              content: m.content || "",
              tool_calls: m.toolCalls.map((t, i) => ({
                id: t.id || `call_${i}`,
                type: "function",
                function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) },
              })),
            };
          return { role: m.role, content: m.content };
        }),
        temperature: cOpts.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (cOpts.maxTokens) body.max_tokens = cOpts.maxTokens;
      const tools = toOpenAITools(cOpts.tools);
      if (tools) body.tools = tools;

      const tryUrls = type === "ollama" ? [`${base}/v1/chat/completions`, `${base}/chat/completions`] : [`${base}/chat/completions`];
      let lastErr = "";
      for (const url of tryUrls) {
        try {
          const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: cOpts.signal });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            // Retry semantics for fallback router: surface typed errors
            if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`AUTH:${t.slice(0, 300)}`), { code: "AUTH" });
            if (res.status === 429) throw Object.assign(new Error(`RATE_LIMIT:${t.slice(0, 300)}`), { code: "RATE_LIMIT" });
            if (res.status === 404 && t.includes("model")) throw Object.assign(new Error(`MODEL_NOT_FOUND:${t.slice(0, 300)}`), { code: "MODEL_NOT_FOUND" });
            if (res.status >= 500) throw Object.assign(new Error(`PROVIDER_5XX:${res.status} ${t.slice(0, 200)}`), { code: "PROVIDER_5XX" });
            lastErr = t.slice(0, 300);
            continue;
          }
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("text/event-stream")) {
            const out = await readSSE(res, cOpts.onToken, cOpts.signal);
            const promptText = cOpts.messages.map((m) => m.content).join("\n");
            const tokensIn = out.usage?.prompt_tokens ?? estimateTokens(promptText);
            const tokensOut = out.usage?.completion_tokens ?? estimateTokens(out.content);
            if (out.toolCalls.length) cOpts.onToolCalls?.(out.toolCalls);
            return { content: out.content, toolCalls: out.toolCalls, tokensIn, tokensOut, model: cOpts.model, finishReason: out.finishReason };
          }
          const json = await res.json();
          const choice = json.choices?.[0];
          const msg = choice?.message ?? {};
          const toolCalls: ToolCallRequest[] = (msg.tool_calls ?? []).map((tc: { id: string; function: { name: string; arguments: string } }, i: number) => {
            let args: Record<string, unknown> = {};
            try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = { _raw: tc.function?.arguments }; }
            return { id: tc.id || `call_${i}`, name: tc.function?.name ?? "", arguments: args };
          });
          const content: string = msg.content ?? "";
          if (content && cOpts.onToken) cOpts.onToken(content);
          if (toolCalls.length) cOpts.onToolCalls?.(toolCalls);
          return {
            content,
            toolCalls,
            tokensIn: json.usage?.prompt_tokens ?? estimateTokens(cOpts.messages.map((m) => m.content).join("\n")),
            tokensOut: json.usage?.completion_tokens ?? estimateTokens(content),
            model: cOpts.model,
            finishReason: choice?.finish_reason ?? "stop",
          };
        } catch (e) {
          if (e instanceof Error && (e as { code?: string }).code) throw e;
          if (cOpts.signal?.aborted) throw Object.assign(new Error("ABORTED"), { code: "ABORTED" });
          lastErr = e instanceof Error ? e.message : String(e);
          // try next URL for ollama
          if (type !== "ollama") throw e;
        }
      }
      throw new Error(lastErr || "Chat request failed");
    },
    async generateImage(apiKey, baseUrl, opts) {
      const base = baseUrlOf(baseUrl, defaultBaseUrl);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${base}/images/generations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: opts.model, prompt: opts.prompt, size: opts.size || "1024x1024", response_format: "b64_json" }),
        signal: opts.signal ?? AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Image generation failed (${res.status}): ${t.slice(0, 300)}`);
      }
      const json = await res.json();
      const item = json.data?.[0] ?? {};
      return { url: item.url, b64: item.b64_json, revisedPrompt: item.revised_prompt };
    },
  };
}

export const openaiAdapter = makeAdapter("openai", "OpenAI", "https://api.openai.com/v1", {
  requiresApiKey: true,
  isLocalKind: false,
  modelsPath: "/models",
});

export const xaiAdapter = makeAdapter("xai", "xAI", "https://api.x.ai/v1", {
  requiresApiKey: true,
  isLocalKind: false,
  modelsPath: "/models",
});

export const ollamaAdapter = makeAdapter("ollama", "Ollama", "http://localhost:11434", {
  requiresApiKey: false,
  isLocalKind: true,
  modelsPath: "/api/tags",
});

export const openaiCompatibleAdapter = makeAdapter(
  "openai_compatible",
  "OpenAI-Compatible",
  "http://localhost:1234/v1",
  { requiresApiKey: false, isLocalKind: true, modelsPath: "/models" }
);
