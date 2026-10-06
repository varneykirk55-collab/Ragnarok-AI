import { db } from "@/db";
import { usageEvents } from "@/db/schema";
import { and, gte, sql } from "drizzle-orm";
import { estimateCost } from "./pricing";

export async function trackUsage(input: {
  providerId?: string;
  providerName: string;
  model: string;
  capability?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd?: number;
  conversationId?: string;
  taskId?: string;
}): Promise<number> {
  let cost = input.costUsd;
  if (cost === undefined) {
    cost = estimateCost(input.model, input.tokensIn, input.tokensOut).cost;
  }
  try {
    await db.insert(usageEvents).values({
      providerId: input.providerId,
      providerName: input.providerName,
      model: input.model,
      capability: input.capability || "",
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: cost,
      conversationId: input.conversationId,
      taskId: input.taskId,
    });
  } catch {
    // usage tracking must not break chat
  }
  return cost;
}

export async function getUsageStats() {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  try {
    const [day] = await db
      .select({
        tokensIn: sql<number>`coalesce(sum(${usageEvents.tokensIn}),0)`,
        tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}),0)`,
        cost: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)`,
        calls: sql<number>`count(*)`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, dayAgo));
    const [month] = await db
      .select({
        tokensIn: sql<number>`coalesce(sum(${usageEvents.tokensIn}),0)`,
        tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}),0)`,
        cost: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)`,
        calls: sql<number>`count(*)`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, monthAgo));
    const byProvider = await db
      .select({
        provider: usageEvents.providerName,
        model: usageEvents.model,
        tokensIn: sql<number>`coalesce(sum(${usageEvents.tokensIn}),0)`,
        tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}),0)`,
        cost: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)`,
        calls: sql<number>`count(*)`,
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, monthAgo))
      .groupBy(usageEvents.providerName, usageEvents.model)
      .limit(50);
    const recent = await db.select().from(usageEvents).orderBy(sql`${usageEvents.createdAt} desc`).limit(50);
    return { day, month, byProvider, recent };
  } catch {
    return { day: null, month: null, byProvider: [], recent: [] };
  }
}

export async function checkBudget(dailyLimit: number | null, monthlyLimit: number | null) {
  const stats = await getUsageStats();
  const dayCost = Number((stats.day as unknown as { cost: number })?.cost ?? 0);
  const monthCost = Number((stats.month as unknown as { cost: number })?.cost ?? 0);
  return {
    dayCost,
    monthCost,
    dailyExceeded: dailyLimit != null && dayCost >= dailyLimit,
    monthlyExceeded: monthlyLimit != null && monthCost >= monthlyLimit,
  };
}
