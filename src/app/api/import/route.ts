import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, memories, projects, toolPermissions, settings, automations } from "@/db/schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.app !== "nexus-personal-ai") return NextResponse.json({ error: "Not a Nexus backup file." }, { status: 400 });
    const counts: Record<string, number> = {};
    // Restore in FK-safe order; skip duplicates by id where possible
    if (Array.isArray(body.projects)) {
      for (const p of body.projects.slice(0, 500)) {
        try { await db.insert(projects).values({ id: p.id, name: p.name, description: p.description || "", instructions: p.instructions || "", routingMode: p.routingMode || "auto", color: p.color || "#6366f1" }).onConflictDoNothing(); counts.projects = (counts.projects || 0) + 1; } catch {}
      }
    }
    if (Array.isArray(body.conversations)) {
      for (const c of body.conversations.slice(0, 2000)) {
        try { await db.insert(conversations).values({ id: c.id, title: c.title || "Restored", projectId: c.projectId || null, routingMode: c.routingMode || "auto", agentMode: c.agentMode || false }).onConflictDoNothing(); counts.conversations = (counts.conversations || 0) + 1; } catch {}
      }
    }
    if (Array.isArray(body.messages)) {
      for (const m of body.messages.slice(0, 20000)) {
        try { await db.insert(messages).values({ id: m.id, conversationId: m.conversationId, role: m.role, content: m.content || "" }).onConflictDoNothing(); counts.messages = (counts.messages || 0) + 1; } catch {}
      }
    }
    if (Array.isArray(body.memories)) {
      for (const m of body.memories.slice(0, 2000)) {
        try { await db.insert(memories).values({ id: m.id, category: m.category || "general", title: m.title || "", content: m.content || "", projectId: m.projectId || null }).onConflictDoNothing(); counts.memories = (counts.memories || 0) + 1; } catch {}
      }
    }
    if (Array.isArray(body.toolPermissions)) {
      for (const t of body.toolPermissions) {
        try { await db.insert(toolPermissions).values({ toolName: t.toolName, policy: t.policy }).onConflictDoUpdate({ target: toolPermissions.toolName, set: { policy: t.policy } }); } catch {}
      }
    }
    if (Array.isArray(body.settings)) {
      for (const s of body.settings) {
        try { await db.insert(settings).values({ key: s.key, value: s.value }).onConflictDoUpdate({ target: settings.key, set: { value: s.value } }); } catch {}
      }
    }
    if (Array.isArray(body.automations)) {
      for (const a of body.automations.slice(0, 200)) {
        try { await db.insert(automations).values({ name: a.name, goal: a.goal, scheduleKind: a.scheduleKind || "interval", scheduleValue: a.scheduleValue || "", projectId: a.projectId || null }).onConflictDoNothing(); } catch {}
      }
    }
    return NextResponse.json({ ok: true, restored: counts, notice: "Provider credentials are never in backups — re-enter API keys in Providers settings." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
