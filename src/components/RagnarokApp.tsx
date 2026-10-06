"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot, MessageSquarePlus, Search, FolderKanban, ListChecks, FolderOpen, Brain,
  CalendarClock, Wrench, DollarSign, Settings as SettingsIcon, Plug, Menu, X,
  ShieldCheck, FlaskConical, ChevronRight, Trash2, Pin, Archive, Cable, Plus,
} from "lucide-react";
import { api, timeAgo } from "@/lib/client-api";
import { ChatPanel } from "./ChatPanel";
import { ProvidersPanel, ConnectorsPanel } from "./ProviderPanels";
import { ProjectsPanel, MemoryPanel, FilesPanel, ResearchPanel } from "./WorkspacePanels";
import { TasksPanel, ToolsPanel, UsagePanel, AutomationsPanel, SettingsPanel } from "./OpsPanels";

type View =
  | "chat" | "research" | "projects" | "tasks" | "files" | "memory" | "automations"
  | "providers" | "connectors" | "tools" | "usage" | "settings";

interface Conversation {
  id: string;
  title: string;
  projectId?: string | null;
  pinned: boolean;
  archived: boolean;
  updatedAt: string;
}

const NAV: Array<{ id: View; label: string; icon: React.ReactNode; group: string }> = [
  { id: "chat", label: "Conversations", icon: <Bot size={17} />, group: "Workspace" },
  { id: "research", label: "Research", icon: <Search size={17} />, group: "Workspace" },
  { id: "projects", label: "Projects", icon: <FolderKanban size={17} />, group: "Workspace" },
  { id: "tasks", label: "Agent tasks", icon: <ListChecks size={17} />, group: "Workspace" },
  { id: "files", label: "Files", icon: <FolderOpen size={17} />, group: "Workspace" },
  { id: "memory", label: "Memory", icon: <Brain size={17} />, group: "Workspace" },
  { id: "automations", label: "Automations", icon: <CalendarClock size={17} />, group: "Workspace" },
  { id: "providers", label: "Providers", icon: <Plug size={17} />, group: "System" },
  { id: "connectors", label: "Connectors", icon: <Cable size={17} />, group: "System" },
  { id: "tools", label: "Tools", icon: <Wrench size={17} />, group: "System" },
  { id: "usage", label: "Costs", icon: <DollarSign size={17} />, group: "System" },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={17} />, group: "System" },
];

export function RagnarokApp() {
  const [view, setView] = useState<View>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [convSearch, setConvSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [globalPrivacy, setGlobalPrivacy] = useState(false);
  const [sidebarFlagEnabled, setSidebarFlagEnabled] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; color: string }>>([]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api<{ conversations: Conversation[] }>(`/api/conversations?q=${encodeURIComponent(convSearch)}`);
      setConversations(data.conversations.filter((c) => !c.archived));
    } catch { /* ignore */ }
  }, [convSearch]);

  const loadMeta = useCallback(async () => {
    try {
      const s = await api<{ settings: { privacyMode: boolean; onboardingDone: boolean; sidebarFlagEnabled?: boolean } }>("/api/settings");
      setGlobalPrivacy(Boolean(s.settings.privacyMode));
      setSidebarFlagEnabled(s.settings.sidebarFlagEnabled !== false);
      const p = await api<{ providers: Array<{ enabled: boolean }> }>("/api/providers");
      if (!s.settings.onboardingDone && p.providers.length === 0) setNeedsOnboarding(true);
      const pr = await api<{ projects: typeof projects }>("/api/projects");
      setProjects(pr.projects);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversations(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations, refreshKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMeta(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMeta, refreshKey]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { taskId?: string } | undefined;
      setFocusTaskId(detail?.taskId || null);
      setView("tasks");
      refresh();
    };
    window.addEventListener("ragnarok:goto-tasks", handler);
    return () => window.removeEventListener("ragnarok:goto-tasks", handler);
  }, [refresh]);

  useEffect(() => {
    const handler = () => { setView("connectors"); setSidebarOpen(false); };
    window.addEventListener("ragnarok:goto-connectors", handler);
    return () => window.removeEventListener("ragnarok:goto-connectors", handler);
  }, []);

  const newConversation = async (projectId?: string) => {
    try {
      const data = await api<{ conversation: { id: string } }>("/api/conversations", { method: "POST", json: { projectId: projectId || null } });
      setActiveConv(data.conversation.id);
      setView("chat");
      setSidebarOpen(false);
      refresh();
    } catch { /* ignore */ }
  };

  const grouped = NAV.reduce<Record<string, typeof NAV>>((acc, n) => {
    (acc[n.group] ||= []).push(n);
    return acc;
  }, {});

  const sidebar = (
    <div className="relative z-10 flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#b89a4a]/40 bg-[#10243a]">
          <Bot size={20} className="text-[#d4ba70]" />
        </div>
        <div>
          <div className="text-[15px] font-extrabold tracking-tight">RAGNAROK</div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Personal AI</div>
        </div>
        {globalPrivacy && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300" title="Global privacy mode: local only">
            <ShieldCheck size={11} /> LOCAL
          </span>
        )}
      </div>

      <div className="px-3">
        <button
          onClick={() => newConversation()}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-500 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-400"
        >
          <MessageSquarePlus size={16} /> New chat
        </button>
      </div>

      {/* Nav */}
      <nav className="mt-3 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group}>
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{group}</div>
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => { setView(n.id); setSidebarOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${view === n.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
              >
                {n.icon}
                {n.label}
                {view === n.id && <ChevronRight size={14} className="ml-auto" />}
              </button>
            ))}
          </div>
        ))}

        {/* Conversation list (only in chat view context, always visible for quick switching) */}
        <div>
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Recent chats</span>
          </div>
          <input
            value={convSearch}
            onChange={(e) => setConvSearch(e.target.value)}
            placeholder="Search chats…"
            className="mb-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs outline-none placeholder:text-slate-600 focus:border-indigo-500/50"
          />
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {conversations.slice(0, 30).map((c) => (
              <div
                key={c.id}
                className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] ${activeConv === c.id ? "bg-indigo-500/20 text-indigo-100" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
                onClick={() => { setActiveConv(c.id); setView("chat"); setSidebarOpen(false); }}
              >
                {c.pinned && <Pin size={11} className="shrink-0 text-amber-300" />}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
                  <button
                    onClick={async (e) => { e.stopPropagation(); await api(`/api/conversations/${c.id}`, { method: "PATCH", json: { pinned: !c.pinned } }); refresh(); }}
                    className="rounded p-0.5 hover:bg-white/10" title="Pin"
                  >
                    <Pin size={11} />
                  </button>
                  <button
                    onClick={async (e) => { e.stopPropagation(); if (confirm("Delete conversation?")) { await api(`/api/conversations/${c.id}`, { method: "DELETE" }); if (activeConv === c.id) setActiveConv(null); refresh(); } }}
                    className="rounded p-0.5 hover:bg-white/10" title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            ))}
            {!conversations.length && <div className="px-2 py-2 text-xs text-slate-600">No conversations yet.</div>}
          </div>
        </div>
      </nav>

      <div className="border-t border-white/10 p-3 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Local-first · data stays with you
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#030405] text-slate-100">
      {/* Desktop sidebar */}
      <aside className={(sidebarFlagEnabled ? "nordic-sidebar" : "plain-sidebar") + " hidden w-64 shrink-0 border-r border-white/10 md:block"}>
        {sidebar}
      </aside>
      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className={(sidebarFlagEnabled ? "nordic-sidebar" : "plain-sidebar") + " absolute left-0 top-0 h-full w-72 border-r border-white/10"}>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Mobile topbar */}
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 md:hidden">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 hover:bg-white/10">
            <Menu size={18} />
          </button>
          <span className="font-extrabold">RAGNAROK</span>
          {globalPrivacy && <ShieldCheck size={14} className="text-emerald-300" />}
          <button onClick={() => newConversation()} className="ml-auto rounded-lg bg-indigo-500 p-2 text-white">
            <Plus size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {needsOnboarding ? (
            <Onboarding
              onDone={async () => {
                await api("/api/settings", { method: "PATCH", json: { onboardingDone: true } });
                setNeedsOnboarding(false);
                refresh();
              }}
              onGoProviders={() => { setNeedsOnboarding(false); setView("providers"); }}
            />
          ) : view === "chat" ? (
            <div className="h-full min-h-[calc(100vh-49px)] md:min-h-0">
              <ChatPanel
                conversationId={activeConv}
                onConversationChange={() => loadConversations()}
                onNewConversation={() => newConversation()}
                refreshKey={refreshKey}
                globalPrivacy={globalPrivacy}
              />
            </div>
          ) : view === "research" ? (
            <ResearchPanel globalPrivacy={globalPrivacy} />
          ) : view === "projects" ? (
            <ProjectsPanel refreshKey={refreshKey} onChanged={refresh} onOpenProject={(id) => { setProjectFilter(id); setView("files"); }} />
          ) : view === "tasks" ? (
            <TasksPanel refreshKey={refreshKey} focusTaskId={focusTaskId} />
          ) : view === "files" ? (
            <FilesPanel refreshKey={refreshKey} projectFilter={projectFilter} />
          ) : view === "memory" ? (
            <MemoryPanel refreshKey={refreshKey} />
          ) : view === "automations" ? (
            <AutomationsPanel refreshKey={refreshKey} />
          ) : view === "providers" ? (
            <ProvidersPanel refreshKey={refreshKey} onChanged={refresh} />
          ) : view === "connectors" ? (
            <ConnectorsPanel refreshKey={refreshKey} />
          ) : view === "tools" ? (
            <ToolsPanel refreshKey={refreshKey} onChanged={refresh} />
          ) : view === "usage" ? (
            <UsagePanel refreshKey={refreshKey} />
          ) : (
            <SettingsPanel refreshKey={refreshKey} onChanged={refresh} globalPrivacy={globalPrivacy} onPrivacy={setGlobalPrivacy} />
          )}
        </div>
      </main>
    </div>
  );
}

function Onboarding({ onDone, onGoProviders }: { onDone: () => void; onGoProviders: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: <Bot size={36} className="text-white" />,
      title: "Meet Ragnarok, your permanent assistant",
      body: "One interface to every model, tool, and project. Models are interchangeable brains — your memory, conversations, and workflows stay yours, locally.",
    },
    {
      icon: <Plug size={36} className="text-white" />,
      title: "Connect a brain",
      body: "Add a cloud API key (OpenAI, Anthropic, Google, xAI) or point at a local Ollama server. You can mix both — routing picks the right one per task, with fallbacks when providers fail.",
    },
    {
      icon: <FlaskConical size={36} className="text-white" />,
      title: "Research, agents, memory",
      body: "Live web search with citations, multi-step agent tasks with approvals, sandboxed code execution, project workspaces, and long-term memory — all running from your own machine.",
    },
  ];
  const s = steps[step];
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-xl shadow-indigo-500/30">
          {s.icon}
        </div>
        <h2 className="mt-5 text-2xl font-extrabold">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.body}</p>
        <div className="mt-4 flex justify-center gap-1.5">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 w-6 rounded-full ${i === step ? "bg-indigo-400" : "bg-white/15"}`} />
          ))}
        </div>
        <div className="mt-6 flex justify-center gap-2">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold">
              Back
            </button>
          )}
          {step < steps.length - 1 ? (
            <button onClick={() => setStep(step + 1)} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white">
              Next
            </button>
          ) : (
            <>
              <button onClick={onGoProviders} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white">
                Connect a provider
              </button>
              <button onClick={onDone} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm">
                Explore first
              </button>
            </>
          )}
        </div>
        <button onClick={onDone} className="mt-3 text-xs text-slate-500 hover:text-slate-300">Skip setup</button>
      </div>
    </div>
  );
}
