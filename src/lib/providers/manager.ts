import { db } from "@/db";
import { providers, models } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../crypto";
import { getAdapter } from "./registry";
import type { ProviderType, ResolvedProvider } from "./types";
import { log } from "../logger";

export async function listProvidersSafe() {
  const rows = await db.select().from(providers).orderBy(asc(providers.sortOrder));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    isLocal: r.isLocal,
    status: r.status,
    statusMessage: r.statusMessage,
    lastCheckedAt: r.lastCheckedAt,
    capabilities: r.capabilities ?? [],
    defaultModel: r.defaultModel ?? "",
    fallbackModels: r.fallbackModels ?? [],
    assignedCapabilities: r.assignedCapabilities ?? [],
    extraConfig: r.extraConfig ?? {},
    hasApiKey: Boolean(r.apiKeyEncrypted),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getResolvedProvider(id: string): Promise<ResolvedProvider | null> {
  const rows = await db.select().from(providers).where(eq(providers.id, id));
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id!,
    name: r.name,
    type: r.type as ProviderType,
    baseUrl: r.baseUrl || getAdapter(r.type)?.defaultBaseUrl || "",
    apiKey: decryptSecret(r.apiKeyEncrypted || ""),
    enabled: r.enabled,
    isLocal: r.isLocal,
    defaultModel: r.defaultModel || "",
    fallbackModels: r.fallbackModels ?? [],
    extraConfig: (r.extraConfig ?? {}) as Record<string, unknown>,
  };
}

export async function listResolvedProviders(opts?: { enabledOnly?: boolean; localOnly?: boolean }): Promise<ResolvedProvider[]> {
  const rows = await db.select().from(providers).orderBy(asc(providers.sortOrder));
  let out = rows.map((r) => ({
    id: r.id!,
    name: r.name,
    type: r.type as ProviderType,
    baseUrl: r.baseUrl || getAdapter(r.type)?.defaultBaseUrl || "",
    apiKey: decryptSecret(r.apiKeyEncrypted || ""),
    enabled: r.enabled,
    isLocal: r.isLocal,
    defaultModel: r.defaultModel || "",
    fallbackModels: r.fallbackModels ?? [],
    extraConfig: (r.extraConfig ?? {}) as Record<string, unknown>,
  }));
  if (opts?.enabledOnly) out = out.filter((p) => p.enabled);
  if (opts?.localOnly) out = out.filter((p) => p.isLocal);
  return out;
}

export async function createProvider(input: {
  name: string;
  type: string;
  baseUrl?: string;
  apiKey?: string;
  isLocal?: boolean;
  defaultModel?: string;
  assignedCapabilities?: string[];
}) {
  const adapter = getAdapter(input.type);
  const baseUrl = input.baseUrl?.trim() || adapter?.defaultBaseUrl || "";
  const [row] = await db
    .insert(providers)
    .values({
      name: input.name.trim(),
      type: input.type,
      baseUrl,
      apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : "",
      isLocal: input.isLocal ?? adapter?.isLocalKind ?? false,
      defaultModel: input.defaultModel || "",
      assignedCapabilities: input.assignedCapabilities ?? [],
      status: "disconnected",
    })
    .returning();
  await log("info", "provider", `Provider added: ${input.name} (${input.type})`);
  return row;
}

export async function updateProvider(
  id: string,
  patch: Partial<{ name: string; baseUrl: string; apiKey: string; enabled: boolean; isLocal: boolean; defaultModel: string; fallbackModels: string[]; assignedCapabilities: string[]; clearKey: boolean }>
) {
  const rows = await db.select().from(providers).where(eq(providers.id, id));
  if (!rows.length) throw new Error("Provider not found");
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.baseUrl !== undefined) update.baseUrl = patch.baseUrl;
  if (patch.apiKey !== undefined && patch.apiKey !== "") update.apiKeyEncrypted = encryptSecret(patch.apiKey);
  if (patch.clearKey) update.apiKeyEncrypted = "";
  if (patch.enabled !== undefined) {
    update.enabled = patch.enabled;
    update.status = patch.enabled ? "disconnected" : "disabled";
  }
  if (patch.isLocal !== undefined) update.isLocal = patch.isLocal;
  if (patch.defaultModel !== undefined) update.defaultModel = patch.defaultModel;
  if (patch.fallbackModels !== undefined) update.fallbackModels = patch.fallbackModels;
  if (patch.assignedCapabilities !== undefined) update.assignedCapabilities = patch.assignedCapabilities;
  await db.update(providers).set(update).where(eq(providers.id, id));
}

export async function deleteProvider(id: string) {
  await db.delete(models).where(eq(models.providerId, id));
  await db.delete(providers).where(eq(providers.id, id));
  await log("info", "provider", `Provider removed: ${id}`);
}

export async function testProvider(id: string, modelOverride?: string) {
  const p = await getResolvedProvider(id);
  if (!p) throw new Error("Provider not found");
  const adapter = getAdapter(p.type);
  if (!adapter) throw new Error(`No adapter for type ${p.type}`);
  const result = await adapter.testConnection(p.apiKey, p.baseUrl, modelOverride || p.defaultModel || undefined);
  await db
    .update(providers)
    .set({
      status: !p.enabled ? "disabled" : result.ok ? (p.isLocal ? "local" : "connected") : "error",
      statusMessage: result.message,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(providers.id, id));
  await log(result.ok ? "info" : "warn", "provider", `Provider test ${p.name}: ${result.message}`);
  return result;
}

export async function fetchAndStoreModels(providerId: string) {
  const p = await getResolvedProvider(providerId);
  if (!p) throw new Error("Provider not found");
  const adapter = getAdapter(p.type);
  if (!adapter) throw new Error(`No adapter for type ${p.type}`);
  const list = await adapter.listModels(p.apiKey, p.baseUrl);
  // Replace stored models
  await db.delete(models).where(eq(models.providerId, providerId));
  for (const m of list.slice(0, 300)) {
    await db.insert(models).values({
      providerId,
      modelId: m.id,
      displayName: m.displayName,
      capabilities: m.capabilities as Record<string, unknown>,
      contextWindow: m.contextWindow ?? 0,
      isDefault: p.defaultModel === m.id,
      metadata: { ownedBy: m.ownedBy ?? "" },
    });
  }
  await log("info", "provider", `Fetched ${list.length} models for ${p.name}`);
  return list;
}

export async function listStoredModels(providerId?: string) {
  if (providerId) return db.select().from(models).where(eq(models.providerId, providerId));
  return db.select().from(models);
}
