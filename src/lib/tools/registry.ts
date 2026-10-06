import { db } from "@/db";
import { toolPermissions } from "@/db/schema";
import type { PermissionPolicy, ToolContext, ToolDefinition, ToolResult } from "./types";
import { BUILTIN_TOOLS, PLANNED_TOOL_NAMES } from "./builtin";
import { log } from "../logger";

const registry = new Map<string, ToolDefinition>();
for (const t of BUILTIN_TOOLS) registry.set(t.name, t);

export function registerTool(def: ToolDefinition): void {
  registry.set(def.name, def);
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function listTools(): ToolDefinition[] {
  return [...registry.values()];
}

export function isToolAvailable(name: string): boolean {
  return registry.has(name) && !PLANNED_TOOL_NAMES.has(name);
}

export function toLLMTools(names?: string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return listTools()
    .filter((t) => !PLANNED_TOOL_NAMES.has(t.name))
    .filter((t) => !names || names.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export async function getPermissionMap(): Promise<Record<string, PermissionPolicy>> {
  const out: Record<string, PermissionPolicy> = {};
  for (const t of listTools()) {
    out[t.name] = defaultPolicyFor(t);
  }
  try {
    const rows = await db.select().from(toolPermissions);
    for (const r of rows) out[r.toolName] = r.policy as PermissionPolicy;
  } catch { /* table may not exist yet at first boot */ }
  return out;
}

export function defaultPolicyFor(t: ToolDefinition): PermissionPolicy {
  if (PLANNED_TOOL_NAMES.has(t.name)) return "deny";
  if (t.riskLevel === "low") return "always_allow";
  if (t.riskLevel === "high") return "always_ask";
  return t.requiresApprovalDefault ? "ask" : "always_allow";
}

export async function getToolPolicy(toolName: string): Promise<PermissionPolicy> {
  const tool = getTool(toolName);
  const fallback = tool ? defaultPolicyFor(tool) : "always_ask";
  try {
    const rows = await db.select().from(toolPermissions);
    const found = rows.find((r) => r.toolName === toolName);
    return (found?.policy as PermissionPolicy) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setToolPolicy(toolName: string, policy: PermissionPolicy): Promise<void> {
  await db
    .insert(toolPermissions)
    .values({ toolName, policy })
    .onConflictDoUpdate({ target: toolPermissions.toolName, set: { policy, updatedAt: new Date() } });
  await log("info", "tool", `Permission ${toolName} → ${policy}`);
}

export type PermissionCheck =
  | { verdict: "allow" }
  | { verdict: "deny"; reason: string }
  | { verdict: "ask"; reason: string };

export async function checkPermission(toolName: string): Promise<PermissionCheck> {
  const tool = getTool(toolName);
  if (!tool) return { verdict: "deny", reason: `Unknown tool: ${toolName}` };
  if (PLANNED_TOOL_NAMES.has(toolName)) return { verdict: "deny", reason: `${toolName} is planned but not implemented in V1.` };
  const policy = await getToolPolicy(toolName);
  if (policy === "always_allow") return { verdict: "allow" };
  if (policy === "deny") return { verdict: "deny", reason: `Tool ${toolName} is disabled by policy.` };
  return { verdict: "ask", reason: `Tool ${toolName} (${tool.riskLevel} risk) requires approval.` };
}

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
  opts?: { skipPermissionCheck?: boolean }
): Promise<ToolResult> {
  const tool = getTool(toolName);
  if (!tool) return { ok: false, output: null, summary: "Unknown tool", error: `Unknown tool: ${toolName}` };
  if (PLANNED_TOOL_NAMES.has(toolName))
    return { ok: false, output: null, summary: "Not implemented", error: `${toolName} is planned but not implemented in V1.` };
  if (!opts?.skipPermissionCheck) {
    const check = await checkPermission(toolName);
    if (check.verdict === "deny") {
      await log("warn", "tool", `Denied ${toolName}: ${check.reason}`);
      return { ok: false, output: null, summary: "Denied by policy", error: check.reason };
    }
    if (check.verdict === "ask") {
      return { ok: false, output: null, summary: "Approval required", error: `APPROVAL_REQUIRED:${check.reason}` };
    }
  }
  try {
    const result = await tool.execute(input ?? {}, ctx);
    await log(result.ok ? "info" : "warn", "tool", `${toolName}: ${result.summary}`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log("error", "tool", `${toolName} failed: ${msg}`);
    return { ok: false, output: null, summary: `Tool error: ${msg.slice(0, 200)}`, error: msg.slice(0, 1000) };
  }
}
