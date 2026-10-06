import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export type AppSettings = {
  routingMode: "auto" | "ask" | "manual";
  privacyMode: boolean;
  defaultCapabilityModels: Record<string, { providerId: string; model: string }>;
  budgetDailyUsd: number | null;
  budgetMonthlyUsd: number | null;
  requireApprovalOverUsd: number | null;
  memoryEnabled: boolean;
  memoryAutoCapture: boolean;
  contextRecentMessages: number;
  contextMaxChars: number;
  agentMaxSteps: number;
  agentMaxRetries: number;
  appearanceTheme: "dark" | "light" | "system";
  workspaceRoot: string;
  onboardingDone: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  routingMode: "auto",
  privacyMode: false,
  defaultCapabilityModels: {},
  budgetDailyUsd: null,
  budgetMonthlyUsd: null,
  requireApprovalOverUsd: null,
  memoryEnabled: true,
  memoryAutoCapture: true,
  contextRecentMessages: 24,
  contextMaxChars: 24000,
  agentMaxSteps: 25,
  agentMaxRetries: 2,
  appearanceTheme: "dark",
  workspaceRoot: "./data/workspaces",
  onboardingDone: false,
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const rows = await db.select().from(settings);
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      merged[r.key] = r.value;
    }
    return {
      ...(DEFAULT_SETTINGS as Record<string, unknown>),
      ...merged,
    } as AppSettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, key));
    if (!rows.length) return fallback;
    return (rows[0].value as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  for (const [k, v] of Object.entries(patch)) {
    await setSetting(k, v);
  }
  return getSettings();
}
