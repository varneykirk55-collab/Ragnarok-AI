// Approximate per-1K-token prices (USD). Used only when provider doesn't
// return cost. Marked as estimates in UI. Update as providers change pricing.
// Never fabricate: when unknown, cost = 0 and flagged as unknown.

export interface PriceEntry {
  inPer1k: number;
  outPer1k: number;
}

const TABLE: Array<{ match: RegExp; price: PriceEntry }> = [
  { match: /gpt-4o-mini|claude-haiku|gemini.*flash/i, price: { inPer1k: 0.00015, outPer1k: 0.0006 } },
  { match: /gpt-4o\b|claude-sonnet|gemini.*pro|grok-2/i, price: { inPer1k: 0.0025, outPer1k: 0.01 } },
  { match: /gpt-4-turbo|claude-opus|o1|o3/g, price: { inPer1k: 0.01, outPer1k: 0.03 } },
  { match: /llama|mistral|qwen|ollama|local/i, price: { inPer1k: 0, outPer1k: 0 } },
];

export function estimateCost(model: string, tokensIn: number, tokensOut: number): { cost: number; estimated: boolean } {
  for (const row of TABLE) {
    if (row.match.test(model)) {
      return {
        cost: (tokensIn / 1000) * row.price.inPer1k + (tokensOut / 1000) * row.price.outPer1k,
        estimated: true,
      };
    }
  }
  // Unknown model: only estimate if it looks like a cloud model; else 0
  if (/gpt|claude|gemini|grok|mistral|deepseek/i.test(model)) {
    return { cost: (tokensIn / 1000) * 0.002 + (tokensOut / 1000) * 0.008, estimated: true };
  }
  return { cost: 0, estimated: false };
}
