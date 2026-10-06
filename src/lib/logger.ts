import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { redactSecrets } from "./crypto";
import { desc } from "drizzle-orm";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory =
  | "app"
  | "provider"
  | "router"
  | "tool"
  | "agent"
  | "chat"
  | "system"
  | "search"
  | "memory";

export async function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const safe = metadata ? (redactSecrets(metadata) as Record<string, unknown>) : {};
  // Always console-log server-side (no secrets)
  const prefix = `[${level.toUpperCase()}][${category}]`;
  if (level === "error") console.error(prefix, message, safe);
  else if (level === "warn") console.warn(prefix, message, safe);
  else console.log(prefix, message);
  try {
    await db.insert(auditLogs).values({ level, category, message: message.slice(0, 2000), metadata: safe });
  } catch {
    // logging must never crash the app
  }
}

export async function getLogs(limit = 200) {
  try {
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  } catch {
    return [];
  }
}
