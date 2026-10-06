"use client";

export async function api<T>(path: string, opts?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    body: opts?.json !== undefined ? JSON.stringify(opts.json) : opts?.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export interface ChatStreamEvents {
  onMeta?: (meta: Record<string, unknown>) => void;
  onToken?: (text: string) => void;
  onTool?: (info: Record<string, unknown>) => void;
  onCitations?: (c: Array<Record<string, unknown>>) => void;
  onAskRoute?: (info: Record<string, unknown>) => void;
  onError?: (message: string) => void;
  onNotice?: (info: Record<string, unknown>) => void;
  onDone?: (info: Record<string, unknown>) => void;
}

/** POST to /api/chat and consume the SSE stream. Returns an abort function. */
export function streamChat(
  payload: Record<string, unknown>,
  events: ChatStreamEvents
): { abort: () => void; done: Promise<void> } {
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      try {
        const j = JSON.parse(t);
        events.onError?.(j.error || `Chat failed (${res.status})`);
      } catch {
        events.onError?.(t || `Chat failed (${res.status})`);
      }
      events.onDone?.({ error: true });
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      events.onError?.("No response stream");
      events.onDone?.({ error: true });
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    for (;;) {
      const { done: rDone, value } = await reader.read();
      if (rDone) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        let event = "";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        const evt = event || currentEvent;
        if (!dataStr) continue;
        try {
          const data = JSON.parse(dataStr);
          if (evt === "meta") events.onMeta?.(data);
          else if (evt === "token") events.onToken?.(data.text || "");
          else if (evt === "tool") events.onTool?.(data);
          else if (evt === "citations") events.onCitations?.(data.citations || []);
          else if (evt === "ask_route") events.onAskRoute?.(data);
          else if (evt === "error") events.onError?.(data.message || "Error");
          else if (evt === "notice") events.onNotice?.(data);
          else if (evt === "done") events.onDone?.(data);
        } catch { /* ignore */ }
      }
    }
    events.onDone?.({});
  })();
  return { abort: () => controller.abort(), done };
}

export function timeAgo(iso: string | Date): string {
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
