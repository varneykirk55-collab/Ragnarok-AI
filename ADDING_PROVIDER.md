# Adding a Provider

Providers are isolated behind the `ProviderAdapter` interface
(`src/lib/providers/types.ts`). Adding one touches ~2 files and nothing else.

## 1. Implement the adapter

Create `src/lib/providers/myprovider.ts`:

```ts
import type { ProviderAdapter } from "./types";

export const myProviderAdapter: ProviderAdapter = {
  type: "myprovider",          // add to ProviderType union in types.ts
  label: "My Provider",
  defaultBaseUrl: "https://api.example.com/v1",
  requiresApiKey: true,
  isLocalKind: false,
  capabilities: ["text", "streaming", "toolCalling"],
  async listModels(apiKey, baseUrl) { /* GET models → ProviderModelInfo[] */ },
  async testConnection(apiKey, baseUrl, model) { /* return { ok, message, latencyMs? } */ },
  async chat(apiKey, baseUrl, opts) {
    // opts: { model, messages, tools?, temperature?, signal?, onToken?, onToolCalls? }
    // return { content, toolCalls, tokensIn, tokensOut, model, finishReason }
    // Throw typed errors where possible:
    //   Object.assign(new Error("AUTH:..."), { code: "AUTH" })
    //   codes: AUTH | RATE_LIMIT | MODEL_NOT_FOUND | PROVIDER_5XX | ABORTED
  },
};
```

Tips:

- Honor `opts.signal` (abort) and call `opts.onToken()` per chunk for streaming.
- Map your tool-calling format to/from `ToolCallRequest[]` (`{ id, name, arguments }`).
- Estimate tokens as `len/4` when the API doesn't return usage.
- If the API has no model-list endpoint, return a small curated list (like Anthropic does).

## 2. Register it

In `src/lib/providers/registry.ts`:

```ts
import { myProviderAdapter } from "./myprovider";
registry.set("myprovider", myProviderAdapter);
```

And add `"myprovider"` to the `ProviderType` union in `types.ts`.

## 3. UI (automatic)

- The Providers API (`/api/providers`) picks up any registered adapter.
- Add a `TYPE_INFO` entry in `src/components/ProviderPanels.tsx` for label/hints.
- Add the type to the `CreateSchema` enum in `src/app/api/providers/route.ts`.

## 4. Verify

1. Add the provider in the UI → Test → Fetch models → set default.
2. Send a chat in Manual mode pinned to it.
3. Break the key/URL and confirm the error message is human-readable and fallback works.

No changes to routing, chat, agent, or tools code are needed — they consume the
abstraction, never provider SDKs.
