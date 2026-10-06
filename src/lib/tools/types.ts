export type RiskLevel = "low" | "medium" | "high";
export type PermissionPolicy = "always_allow" | "ask" | "always_ask" | "deny";

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  riskLevel: RiskLevel;
  requiresApprovalDefault: boolean;
  parameters: Record<string, unknown>; // JSON schema
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  conversationId?: string;
  projectId?: string;
  taskId?: string;
  privacyMode: boolean;
  workspaceRoot: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  summary: string;
  citations?: Array<{ title: string; url: string; source?: string }>;
  error?: string;
}

export const RISK_DESCRIPTIONS: Record<RiskLevel, string> = {
  low: "Read-only or fully reversible. Safe to auto-run.",
  medium: "Modifies files, runs code, or touches external systems. User-configurable.",
  high: "Sends data externally, deletes, spends money, or changes security. Always ask.",
};
