// Standardized provider abstraction. The rest of the app talks to this,
// never to provider-specific SDKs directly.

export type ProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "ollama"
  | "openai_compatible";

export type ProviderStatus = "connected" | "disconnected" | "local" | "error" | "disabled";

export interface ModelCapabilities {
  text: boolean;
  reasoning: boolean;
  toolCalling: boolean;
  vision: boolean;
  imageGeneration: boolean;
  audio: boolean;
  video: boolean;
  embeddings: boolean;
  streaming: boolean;
  contextWindow: number;
}

export interface ProviderModelInfo {
  id: string;
  displayName: string;
  capabilities: Partial<ModelCapabilities>;
  contextWindow?: number;
  ownedBy?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  stream?: boolean;
  tools?: ToolSchema[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  onToolCalls?: (calls: ToolCallRequest[]) => void;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCallRequest[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  finishReason: string;
  raw?: unknown;
}

export interface ProviderAdapter {
  type: ProviderType;
  label: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  isLocalKind: boolean;
  capabilities: string[]; // adapter-level capability tags
  listModels(apiKey: string, baseUrl: string): Promise<ProviderModelInfo[]>;
  testConnection(apiKey: string, baseUrl: string, model?: string): Promise<{ ok: boolean; message: string; latencyMs?: number }>;
  chat(apiKey: string, baseUrl: string, opts: ChatOptions): Promise<ChatResult>;
  generateImage?(apiKey: string, baseUrl: string, opts: { model: string; prompt: string; size?: string; signal?: AbortSignal }): Promise<{ url?: string; b64?: string; revisedPrompt?: string }>;
}

export interface ResolvedProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string; // decrypted, server-side only
  enabled: boolean;
  isLocal: boolean;
  defaultModel: string;
  fallbackModels: string[];
  extraConfig: Record<string, unknown>;
}

export const CAPABILITY_CATEGORIES = [
  "conversation",
  "reasoning",
  "coding",
  "research",
  "factcheck",
  "data_analysis",
  "image_generation",
  "image_understanding",
  "video",
  "audio",
  "file_processing",
  "document_creation",
  "browser",
  "api_action",
  "automation",
  "agent_task",
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];
