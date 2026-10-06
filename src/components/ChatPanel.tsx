"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot, Check, Copy, Pencil, RefreshCw, RotateCcw, Send, Square, Trash2,
  ChevronDown, Paperclip, Image as ImageIcon, ShieldCheck, Zap, ListChecks,
  ExternalLink, Wrench, FlaskConical, AlertTriangle, X, FileText,
} from "lucide-react";
import { api, streamChat, timeAgo } from "@/lib/client-api";
import { Markdown } from "./Markdown";
import { VoiceControls } from "./VoiceControls";
import type { ReasoningDepth } from "@/lib/voice/config";

interface Message {
  id: string;
  role: string;
  content: string;
  model?: string;
  providerId?: string;
  capability?: string;
  citations?: Array<{ title: string; url: string; source?: string }>;
  toolCalls?: Array<{ name: string }>;
  status?: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  projectId?: string | null;
  routingMode: string;
  selectedProviderId?: string | null;
  selectedModel?: string;
  agentMode: boolean;
  privacyMode: boolean;
  systemPrompt?: string;
  pinned: boolean;
  updatedAt: string;
}

interface ProviderOpt {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  isLocal: boolean;
  defaultModel: string;
  models: Array<{ modelId: string }>;
}

export function ChatPanel({
  conversationId,
  onConversationChange,
  onNewConversation,
  refreshKey,
  globalPrivacy,
}: {
  conversationId: string | null;
  onConversationChange: (c: Conversation | null) => void;
  onNewConversation: () => void;
  refreshKey: number;
  globalPrivacy: boolean;
}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamMeta, setStreamMeta] = useState<Record<string, unknown> | null>(null);
  const [toolEvents, setToolEvents] = useState<Array<Record<string, unknown>>>([]);
  const [askRoute, setAskRoute] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<ProviderOpt[]>([]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; kind: string; textContent?: string }>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verification, setVerification] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webNotice, setWebNotice] = useState<string | null>(null);
  const [reasoningDepth, setReasoningDepth] = useState<ReasoningDepth>("auto");
  const abortRef = useRef<(() => void) | null>(null);
  const tempMessageSequenceRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadConversation = useCallback(async () => {
    if (!conversationId) {
      setConv(null);
      setMessages([]);
      return;
    }
    try {
      const data = await api<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${conversationId}`);
      setConv(data.conversation);
      setMessages(data.messages);
      onConversationChange(data.conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [conversationId, onConversationChange]);

  const loadProviders = useCallback(async () => {
    try {
      const data = await api<{ providers: ProviderOpt[] }>("/api/models");
      setProviders(data.providers.filter((p) => p.enabled));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversation(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversation, refreshKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProviders(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProviders, refreshKey]);
  useEffect(() => {
    api<{ settings: { reasoningDepth?: ReasoningDepth } }>("/api/settings")
      .then((data) => setReasoningDepth(data.settings.reasoningDepth || "auto"))
      .catch(() => {});
  }, [refreshKey]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamText]);

  const patchConv = async (patch: Record<string, unknown>) => {
    if (!conv) return;
    await api(`/api/conversations/${conv.id}`, { method: "PATCH", json: patch });
    setConv({ ...conv, ...patch } as Conversation);
  };

  const send = async (overrideText?: string, confirmRoute?: { providerId: string; model: string }): Promise<string> => {
    const text = (overrideText ?? input).trim();
    if ((!text && !attachments.length) || streaming || !conv) return "";
    setInput("");
    setError(null);
    setWebNotice(null);
    setAskRoute(null);
    setStreamText("");
    setStreamMeta(null);
    setToolEvents([]);
    setStreaming(true);
    // optimistic user message
    const tempId = `temp-${++tempMessageSequenceRef.current}`;
    setMessages((m) => [...m, { id: tempId, role: "user", content: text, createdAt: new Date().toISOString() }]);
    let acc = "";
    let streamFailed = false;
    let awaitingRoute = false;
    const { abort, done } = streamChat(
      { conversationId: conv.id, content: text, attachments, confirmRoute, reasoningDepth },
      {
        onMeta: (meta) => setStreamMeta(meta),
        onToken: (t) => { acc += t; setStreamText(acc); },
        onTool: (info) => setToolEvents((e) => [...e, info]),
        onAskRoute: (info) => { awaitingRoute = true; setAskRoute(info); },
        onNotice: (info) => setWebNotice(String(info.message || "Live retrieval could not be completed.")),
        onError: (msg) => { streamFailed = true; setError(msg); },
        onDone: (info) => { if (info.error || info.awaitingRouteConfirm) awaitingRoute = true; },
      }
    );
    abortRef.current = abort;
    try {
      await done;
    } catch {
      streamFailed = true;
      setError("Generation stopped.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setAttachments([]);
      await loadConversation();
      setStreamText("");
    }
    return streamFailed || awaitingRoute ? "" : acc;
  };

  const stop = () => {
    abortRef.current?.();
    setStreaming(false);
  };

  const retry = async (msg: Message) => {
    // find previous user message and resend
    const idx = messages.findIndex((m) => m.id === msg.id);
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (prevUser) {
      // delete messages after prevUser
      for (const m of messages.slice(idx)) {
        await api(`/api/messages/${m.id}`, { method: "DELETE" }).catch(() => {});
      }
      await loadConversation();
      send(prevUser.content);
    }
  };

  const editAndResend = async (msg: Message) => {
    if (!editText.trim()) return;
    const idx = messages.findIndex((m) => m.id === msg.id);
    await api(`/api/messages/${msg.id}`, { method: "PATCH", json: { content: editText } });
    for (const m of messages.slice(idx + 1)) {
      await api(`/api/messages/${m.id}`, { method: "DELETE" }).catch(() => {});
    }
    setEditingId(null);
    setEditText("");
    await loadConversation();
    send(editText);
  };

  const regenerate = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || lastUser.id.startsWith("temp-")) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) await api(`/api/messages/${lastAssistant.id}`, { method: "DELETE" }).catch(() => {});
    await loadConversation();
    send(lastUser.content);
  };

  const verifyMessage = async (msg: Message) => {
    setVerifyingId(msg.id);
    try {
      const data = await api<{ verification: string; model: string }>("/api/verify", {
        method: "POST",
        json: { content: msg.content, kind: "general", privacyMode: conv?.privacyMode },
      });
      setVerification({ id: msg.id, text: `*Verified with ${data.model}*\n\n${data.verification}` });
    } catch (e) {
      setVerification({ id: msg.id, text: `Verification failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const out: Array<{ name: string; kind: string; textContent?: string }> = [];
    for (const f of Array.from(files).slice(0, 5)) {
      if (f.type.startsWith("image/")) {
        out.push({ name: f.name, kind: "image" });
      } else if (f.size < 200000) {
        const text = await f.text().catch(() => "");
        out.push({ name: f.name, kind: f.type || "text", textContent: text.slice(0, 10000) });
      } else {
        out.push({ name: f.name, kind: f.type || "file" });
      }
    }
    setAttachments((a) => [...a, ...out]);
  };

  const startAgentTask = async (goalOverride?: string, fromVoice = false): Promise<string> => {
    const goal = (goalOverride ?? input).trim();
    if (!conv || !goal) return "";
    try {
      const data = await api<{ task: { id: string } }>("/api/agent/tasks", {
        method: "POST",
        json: { goal, conversationId: conv.id, projectId: conv.projectId, privacyMode: conv.privacyMode || globalPrivacy },
      });
      setInput("");
      if (!fromVoice) window.dispatchEvent(new CustomEvent("ragnarok:goto-tasks", { detail: { taskId: data.task.id } }));
      return "The agent task has started. You can follow its plan, tool actions, and approvals in Agent Tasks.";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "";
    }
  };

  if (!conversationId || !conv) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30">
          <Bot size={32} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold">Your personal AI command center</h2>
        <p className="max-w-md text-sm text-slate-400">
          Chat with any connected model, research the live web, run multi-step agent tasks, and keep everything in local memory.
        </p>
        <button
          onClick={onNewConversation}
          className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400"
        >
          Start a conversation
        </button>
      </div>
    );
  }

  const privacyOn = conv.privacyMode || globalPrivacy;
  const selectedProvider = providers.find((p) => p.id === (conv.selectedProviderId || ""));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <h2 className="max-w-[220px] truncate text-sm font-semibold">{conv.title}</h2>
        {privacyOn && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            <ShieldCheck size={12} /> Local only
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Routing mode */}
          <select
            value={conv.routingMode}
            onChange={(e) => patchConv({ routingMode: e.target.value })}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200"
            title="Routing mode: Auto (system picks), Ask (confirm first), Manual (you pick)"
          >
            <option value="auto">⚡ Auto route</option>
            <option value="ask">❓ Ask me</option>
            <option value="manual">🎯 Manual</option>
          </select>
          <select
            aria-label="Reasoning effort"
            value={reasoningDepth}
            onChange={async (e) => {
              const next = e.target.value as ReasoningDepth;
              setReasoningDepth(next);
              try { await api("/api/settings", { method: "PATCH", json: { reasoningDepth: next } }); }
              catch (err) { setError(err instanceof Error ? err.message : String(err)); }
            }}
            className="max-w-[142px] rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200"
            title="Reasoning effort for this request and as the saved default. Native model controls are used when available."
          >
            <option value="auto">Reasoning · Auto</option>
            <option value="fast">Reasoning · Fast</option>
            <option value="balanced">Reasoning · Balanced</option>
            <option value="deep">Reasoning · Deep</option>
            <option value="maximum">Reasoning · Maximum</option>
          </select>
          {/* Model selector (manual) */}
          {(conv.routingMode === "manual" || conv.selectedModel) && (
            <div className="relative">
              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
              >
                <Zap size={12} className="text-amber-300" />
                {conv.selectedModel || selectedProvider?.defaultModel || "Select model"}
                <ChevronDown size={12} />
              </button>
              {showModelMenu && (
                <div className="absolute right-0 z-30 mt-1 max-h-64 w-72 overflow-auto rounded-xl border border-white/10 bg-[#141828] p-1 shadow-xl">
                  {providers.map((p) => (
                    <div key={p.id} className="mb-1">
                      <div className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-400">
                        {p.isLocal ? "🖥️" : "☁️"} {p.name}
                      </div>
                      {(p.models.length ? p.models.map((m) => m.modelId) : [p.defaultModel].filter(Boolean)).map((m) => (
                        <button
                          key={p.id + m}
                          onClick={() => {
                            patchConv({ selectedProviderId: p.id, selectedModel: m });
                            setShowModelMenu(false);
                          }}
                          className={`block w-full truncate rounded-lg px-3 py-1.5 text-left text-xs hover:bg-white/10 ${conv.selectedModel === m ? "bg-indigo-500/20 text-indigo-200" : "text-slate-200"}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ))}
                  {!providers.length && <div className="p-3 text-xs text-slate-400">No providers connected. Go to Settings → Providers.</div>}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => patchConv({ agentMode: !conv.agentMode })}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${conv.agentMode ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200" : "border-white/10 bg-white/5 text-slate-300"}`}
            title="Agent Mode: multi-step tasks with tools and approvals"
          >
            <ListChecks size={12} /> Agent {conv.agentMode ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => patchConv({ privacyMode: !conv.privacyMode })}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${conv.privacyMode ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200" : "border-white/10 bg-white/5 text-slate-300"}`}
            title="Privacy Mode: local models + local tools only"
          >
            <ShieldCheck size={12} /> {conv.privacyMode ? "Private" : "Privacy"}
          </button>
        </div>
      </div>

      {/* Ask-route banner */}
      {askRoute && (
        <div className="animate-slide-up mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="flex-1">
              <div className="font-semibold text-amber-200">Routing confirmation</div>
              <div className="mt-1 text-slate-200">{String(askRoute.question || "")}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const p = askRoute.provider as { id: string; model: string };
                    const lastUser = [...messages].reverse().find((m) => m.role === "user");
                    if (lastUser) send(lastUser.content, { providerId: p.id, model: p.model });
                  }}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-amber-400"
                >
                  Use {(askRoute.provider as { name?: string })?.name} / {(askRoute.provider as { model?: string })?.model}
                </button>
                <button onClick={() => setAskRoute(null)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.filter((m) => !m.id.startsWith("temp-") || streaming).map((m) => (
            <div key={m.id} className={`group flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${m.role === "user" ? "bg-indigo-500 text-white" : "bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-white"}`}>
                {m.role === "user" ? "You" : <Bot size={16} />}
              </div>
              <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-indigo-500/20" : "bg-white/5"}`}>
                {m.role === "assistant" && (m.model || m.capability) && (
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    {m.model && <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">{m.model}</span>}
                    {m.capability && <span className="rounded bg-white/10 px-1.5 py-0.5">{m.capability}</span>}
                    {m.status === "error" && <span className="text-red-300">error</span>}
                  </div>
                )}
                {editingId === m.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-black/30 p-2 text-sm"
                      rows={4}
                    />
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => editAndResend(m)} className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-bold text-white">Save & resend</button>
                      <button onClick={() => setEditingId(null)} className="rounded-lg border border-white/15 px-3 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <Markdown text={m.content} />
                )}
                {!!m.citations?.length && (
                  <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sources</div>
                    {m.citations.map((c, i) => (
                      <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
                        <ExternalLink size={11} className="shrink-0" />
                        <span className="truncate">[{i + 1}] {c.title} — {c.source}</span>
                      </a>
                    ))}
                  </div>
                )}
                {verification?.id === m.id && (
                  <div className="mt-2 rounded-xl border border-teal-500/30 bg-teal-500/10 p-3">
                    <Markdown text={verification.text} />
                    <button onClick={() => setVerification(null)} className="mt-1 text-xs text-slate-400 hover:text-white">Dismiss</button>
                  </div>
                )}
                {/* actions */}
                <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => navigator.clipboard.writeText(m.content).catch(() => {})}
                    className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" title="Copy"
                  >
                    <Copy size={13} />
                  </button>
                  {m.role === "user" && (
                    <button
                      onClick={() => { setEditingId(m.id); setEditText(m.content); }}
                      className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" title="Edit and resend"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {m.role === "assistant" && (
                    <>
                      <button onClick={() => retry(m)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" title="Retry from here">
                        <RotateCcw size={13} />
                      </button>
                      <button
                        onClick={() => verifyMessage(m)}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                        title="Verify this response independently"
                      >
                        {verifyingId === m.id ? <RefreshCw size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                      </button>
                    </>
                  )}
                  <span className="ml-auto text-[10px] text-slate-500">{timeAgo(m.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}

          {/* Streaming bubble */}
          {streaming && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-white">
                <Bot size={16} />
              </div>
              <div className="min-w-0 max-w-[85%] rounded-2xl bg-white/5 px-4 py-3">
                {streamMeta && (
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">
                      {String(streamMeta["provider"] || "")} / {String(streamMeta["model"] || "")}
                    </span>
                    {streamMeta["capability"] ? <span className="rounded bg-white/10 px-1.5 py-0.5">{String(streamMeta["capability"])}</span> : null}
                    {streamMeta["reasoningDepth"] ? <span className="rounded bg-white/10 px-1.5 py-0.5">Reasoning: {String(streamMeta["reasoningDepth"])}</span> : null}
                    {streamMeta["liveSearch"] ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-200">Live sources</span> : null}
                    <span className="animate-pulse-dot text-emerald-300">● streaming</span>
                  </div>
                )}
                {toolEvents.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {toolEvents.map((t, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs text-slate-300">
                        <Wrench size={12} className="text-amber-300" />
                        {String(t.name)} — {String(t.status)}{t.summary ? `: ${String(t.summary).slice(0, 120)}` : ""}
                      </div>
                    ))}
                  </div>
                )}
                {streamText ? <Markdown text={streamText} /> : (
                  <div className="flex items-center gap-1 py-2">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-2 w-2 rounded-full bg-slate-400" style={{ animation: `typing-bounce 1.2s ${i * 0.15}s infinite` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {webNotice && (
            <div role="status" className="mx-auto max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {webNotice}
              <button onClick={() => setWebNotice(null)} className="ml-2 text-xs underline">Dismiss</button>
            </div>
          )}
          {error && (
            <div className="mx-auto max-w-3xl rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
              <button onClick={() => setError(null)} className="ml-2 text-xs underline">Dismiss</button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 p-3">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2">
            <VoiceControls
              busy={streaming}
              onStopResponse={stop}
              onVoiceRequest={async (spokenText) => conv.agentMode ? startAgentTask(spokenText, true) : send(spokenText)}
            />
          </div>
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs">
                  <FileText size={12} /> {a.name}
                  <button onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} className="text-slate-400 hover:text-white">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-glow flex items-end gap-2 rounded-2xl border border-white/15 bg-white/5 p-2 transition">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" title="Attach files">
              <Paperclip size={18} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (conv.agentMode) startAgentTask();
                  else send();
                }
              }}
              placeholder={conv.agentMode ? "Describe a goal for the agent — it will plan, use tools, and ask for approvals…" : "Message Ragnarok… (Enter to send, Shift+Enter for newline)"}
              className="max-h-40 min-h-[44px] flex-1 resize-y bg-transparent px-1 py-2 text-sm outline-none placeholder:text-slate-500"
              rows={2}
            />
            {streaming ? (
              <button onClick={stop} className="flex items-center gap-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-400" title="Stop generation">
                <Square size={16} /> Stop
              </button>
            ) : conv.agentMode ? (
              <button onClick={() => startAgentTask()} disabled={!input.trim()} className="flex items-center gap-1 rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-fuchsia-400 disabled:opacity-40" title="Start agent task">
                <ListChecks size={16} /> Run
              </button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim() && !attachments.length} className="flex items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 disabled:opacity-40">
                <Send size={16} /> Send
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              {conv.routingMode === "auto" ? "⚡ Auto: best model picked per task" : conv.routingMode === "ask" ? "❓ Ask: confirms before each model use" : `🎯 Manual: ${conv.selectedModel || "default"}`}
              {" · "}Try “Remember that…”, or ask for current events to trigger live search.
            </span>
            {messages.some((m) => m.role === "assistant") && (
              <button onClick={regenerate} className="flex items-center gap-1 hover:text-slate-300">
                <RefreshCw size={11} /> Regenerate
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
