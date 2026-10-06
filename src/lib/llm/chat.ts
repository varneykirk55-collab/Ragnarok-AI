import { getAdapter } from "../providers/registry";
import { getResolvedProvider } from "../providers/manager";
import type { ChatMessage, ChatResult, ResolvedProvider, ToolSchema } from "../providers/types";
import { log } from "../logger";

export interface AttemptInfo {
  providerId: string;
  providerName: string;
  model: string;
  ok: boolean;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export async function chatWithFallback(input: {
  primary: ResolvedProvider;
  model: string;
  fallbackChain: Array<{ providerId: string; model: string }>;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  onAttempt?: (attempt: AttemptInfo) => void;
  respectPrivacy?: boolean; // if true, never fall back to cloud from local (handled by chain construction)
}): Promise<{ result: ChatResult; provider: ResolvedProvider; model: string; attempts: AttemptInfo[] }> {
  const attempts: AttemptInfo[] = [];
  const chain: Array<{ provider: ResolvedProvider; model: string }> = [
    { provider: input.primary, model: input.model },
  ];
  for (const f of input.fallbackChain) {
    try {
      const p = await getResolvedProvider(f.providerId);
      if (p && p.enabled) chain.push({ provider: p, model: f.model });
    } catch { /* skip */ }
  }
  // Deduplicate
  const seen = new Set<string>();
  const deduped = chain.filter((c) => {
    const k = `${c.provider.id}:${c.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let lastError = "All providers failed.";
  for (let i = 0; i < deduped.length; i++) {
    const { provider, model } = deduped[i];
    const adapter = getAdapter(provider.type);
    if (!adapter) {
      const err = `No adapter for provider type ${provider.type}`;
      attempts.push({ providerId: provider.id, providerName: provider.name, model, ok: false, error: err });
      input.onAttempt?.(attempts[attempts.length - 1]);
      lastError = err;
      continue;
    }
    try {
      const result = await adapter.chat(provider.apiKey, provider.baseUrl, {
        model,
        messages: input.messages,
        tools: input.tools,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        signal: input.signal,
        onToken: i === 0 || attempts.some((a) => a.ok) ? input.onToken : undefined, // stream only meaningful attempt; fallback streams too
      });
      // For fallback attempts, stream as well (client already listening)
      attempts.push({
        providerId: provider.id,
        providerName: provider.name,
        model,
        ok: true,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
      input.onAttempt?.(attempts[attempts.length - 1]);
      if (i > 0) {
        await log("warn", "provider", `Fallback used: ${provider.name}/${model} after ${i} failure(s)`);
      }
      return { result, provider, model, attempts };
    } catch (e) {
      if ((e as { code?: string }).code === "ABORTED" || input.signal?.aborted) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string }).code;
      attempts.push({ providerId: provider.id, providerName: provider.name, model, ok: false, error: msg });
      input.onAttempt?.(attempts[attempts.length - 1]);
      await log("warn", "provider", `Attempt failed ${provider.name}/${model}: ${msg.slice(0, 200)}`, { code });
      lastError = humanizeProviderError(msg, code, provider.name, model);
      // Don't retry auth errors on same provider's other models? Still try other providers.
      continue;
    }
  }
  throw new Error(lastError);
}

function humanizeProviderError(msg: string, code: string | undefined, providerName: string, model: string): string {
  if (code === "AUTH" || msg.startsWith("AUTH:"))
    return `Authentication failed for ${providerName}. Check the API key in Providers settings. (${msg.replace(/^AUTH:/, "").slice(0, 200)})`;
  if (code === "RATE_LIMIT" || msg.startsWith("RATE_LIMIT:"))
    return `${providerName} rate-limited the request. Wait a moment or switch models. All fallbacks were also tried.`;
  if (code === "MODEL_NOT_FOUND" || msg.startsWith("MODEL_NOT_FOUND:"))
    return `Model "${model}" was not found on ${providerName}. It may be retired or misspelled — open Providers settings, refresh models, and pick a valid default.`;
  if (code === "PROVIDER_5XX" || msg.startsWith("PROVIDER_5XX:"))
    return `${providerName} is experiencing an outage (server error). Fallbacks were tried and also failed.`;
  if (/timeout|timed out/i.test(msg))
    return `Request to ${providerName} timed out. The provider may be slow or unreachable; local models (Ollama) may need more time on first load.`;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg))
    return `Cannot reach ${providerName}. Check the endpoint URL and that the server is running (for Ollama: \`ollama serve\`).`;
  return `${providerName} error: ${msg.slice(0, 300)}`;
}
