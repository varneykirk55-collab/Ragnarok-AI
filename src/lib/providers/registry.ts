import type { ProviderAdapter, ProviderType } from "./types";
import { openaiAdapter, xaiAdapter, ollamaAdapter, openaiCompatibleAdapter } from "./openai-compatible";
import { anthropicAdapter } from "./anthropic";
import { googleAdapter } from "./google";

const registry = new Map<ProviderType, ProviderAdapter>([
  ["openai", openaiAdapter],
  ["xai", xaiAdapter],
  ["ollama", ollamaAdapter],
  ["openai_compatible", openaiCompatibleAdapter],
  ["anthropic", anthropicAdapter],
  ["google", googleAdapter],
]);

export function getAdapter(type: string): ProviderAdapter | undefined {
  return registry.get(type as ProviderType);
}

export function listAdapters(): ProviderAdapter[] {
  return [...registry.values()];
}

/** Register a new provider adapter at runtime (plugin path). */
export function registerAdapter(adapter: ProviderAdapter): void {
  registry.set(adapter.type, adapter);
}
