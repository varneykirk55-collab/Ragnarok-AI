import { db } from "@/db";
import { memories } from "@/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getSetting } from "../server-settings";

export const MEMORY_CATEGORIES = [
  "preferences",
  "projects",
  "businesses",
  "people",
  "workflows",
  "decisions",
  "goals",
  "instructions",
  "facts",
  "general",
] as const;

export async function createMemory(input: {
  category?: string;
  title?: string;
  content: string;
  projectId?: string;
  importance?: number;
  source?: string;
}) {
  const [row] = await db
    .insert(memories)
    .values({
      category: input.category || "general",
      title: input.title || input.content.slice(0, 80),
      content: input.content,
      projectId: input.projectId || null,
      importance: input.importance ?? 5,
      source: input.source || "user",
    })
    .returning();
  return row;
}

export async function listMemories(opts?: { projectId?: string; category?: string; search?: string; enabledOnly?: boolean; limit?: number }) {
  try {
    let q = db.select().from(memories).orderBy(desc(memories.pinned), desc(memories.updatedAt)).limit(opts?.limit ?? 200);
    const rows = await q;
    let out = rows;
    if (opts?.projectId) out = out.filter((m) => !m.projectId || m.projectId === opts.projectId);
    if (opts?.category) out = out.filter((m) => m.category === opts.category);
    if (opts?.enabledOnly) out = out.filter((m) => m.enabled);
    if (opts?.search) {
      const s = opts.search.toLowerCase();
      out = out.filter((m) => (m.title + " " + m.content).toLowerCase().includes(s));
    }
    return out;
  } catch {
    return [];
  }
}

/** Keyword-relevance retrieval (V1: TF overlap + recency + importance + pin boost). */
export function scoreRelevance(query: string, content: string): number {
  const stop = new Set("the,a,an,and,or,but,is,are,was,were,in,on,at,to,for,of,with,by,from,as,it,its,this,that,these,those,i,you,he,she,we,they,my,your,his,her,our,their,me,him,us,them,do,does,did,have,has,had,will,would,can,could,should,what,when,where,which,who,how,why,if,then,than,so,such,not,no,yes,please".split(","));
  const toks = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !stop.has(t));
  const q = new Set(toks(query));
  const c = toks(content);
  if (!q.size || !c.length) return 0;
  let hits = 0;
  for (const t of c) if (q.has(t)) hits++;
  const coverage = hits / Math.max(1, c.length);
  const qCoverage = [...q].filter((t) => content.toLowerCase().includes(t)).length / q.size;
  return hits * 2 + qCoverage * 5 + coverage * 2;
}

export async function retrieveMemories(query: string, opts?: { projectId?: string; allowCrossProject?: boolean; limit?: number }) {
  const enabled = await getSetting("memoryEnabled", true).catch(() => true);
  if (!enabled) return [];
  const all = await listMemories({ enabledOnly: true, limit: 500 });
  const limit = opts?.limit ?? 8;
  const scored = all
    .filter((m) => {
      if (!m.projectId) return true; // global memory always eligible
      if (m.projectId === opts?.projectId) return true;
      return Boolean(opts?.allowCrossProject);
    })
    .map((m) => {
      let s = scoreRelevance(query, `${m.title} ${m.content}`);
      if (m.pinned) s += 6;
      s += (m.importance - 5) * 0.5;
      // recency boost (updated in last 7 days)
      const ageDays = (Date.now() - new Date(m.updatedAt).getTime()) / 86400000;
      if (ageDays < 7) s += 1;
      return { m, s };
    })
    .filter((x) => x.s > 1.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return scored.map((x) => x.m);
}

/** Parse "remember this / forget this" style commands from user text. */
export function parseMemoryCommand(text: string): { action: "remember" | "forget"; payload: string } | null {
  const t = text.trim();
  const remember = /^(remember|memorize|save (to memory|this)|note this|keep in mind)[:\s]+([\s\S]+)/i.exec(t);
  if (remember) return { action: "remember", payload: remember[2].trim() };
  // "remember that I prefer X"
  const remember2 = /^remember that ([\s\S]+)/i.exec(t);
  if (remember2) return { action: "remember", payload: remember2[1].trim() };
  const forget = /^(forget|delete (that )?memory|remove (that )?memory)[:\s]+([\s\S]+)/i.exec(t);
  if (forget) return { action: "forget", payload: forget[forget.length - 1].trim() };
  return null;
}

export async function forgetMatching(payload: string, projectId?: string): Promise<number> {
  const all = await listMemories({ limit: 500 });
  const scored = all
    .map((m) => ({ m, s: scoreRelevance(payload, `${m.title} ${m.content}`) }))
    .filter((x) => x.s > 2)
    .sort((a, b) => b.s - a.s);
  let count = 0;
  for (const x of scored.slice(0, 3)) {
    if (projectId && x.m.projectId && x.m.projectId !== projectId) continue;
    await db.delete(memories).where(eq(memories.id, x.m.id));
    count++;
  }
  return count;
}
