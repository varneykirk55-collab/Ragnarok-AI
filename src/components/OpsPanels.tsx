"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot, Check, ChevronDown, Clock, Loader2, OctagonX, Play, Plus, RefreshCw,
  ShieldAlert, Trash2, Wrench, X, Zap, CalendarClock, DollarSign, Settings as SettingsIcon,
  Download, Upload, ScrollText, Pause, Brain, Search, ShieldCheck,
} from "lucide-react";
import { api, timeAgo } from "@/lib/client-api";
import { Markdown } from "./Markdown";
import { VoiceSettingsPanel } from "./VoiceSettingsPanel";

// ---------------- Tasks (Agent) ----------------
interface Task {
  id: string;
  goal: string;
  status: string;
  currentStep: number;
  maxSteps: number;
  modelsUsed: string[];
  toolsUsed: string[];
  outcome?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

interface TaskStep {
  id: string;
  stepIndex: number;
  kind: string;
  title: string;
  detail: string;
  toolName?: string;
  status: string;
  createdAt: string;
}

export function TasksPanel({ refreshKey, focusTaskId }: { refreshKey: number; focusTaskId: string | null }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string | null>(focusTaskId);
  const [detail, setDetail] = useState<{ task: Task; steps: TaskStep[]; approvals: Array<{ id: string; toolName: string; action: string; riskLevel: string; status: string; createdAt: string }> } | null>(null);
  const [newGoal, setNewGoal] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!focusTaskId) return;
    const timer = window.setTimeout(() => setSelected(focusTaskId), 0);
    return () => window.clearTimeout(timer);
  }, [focusTaskId]);

  const loadList = useCallback(async () => {
    try {
      const data = await api<{ tasks: Task[] }>("/api/agent/tasks");
      setTasks(data.tasks);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await api<typeof detail & {}>(`/api/agent/tasks/${id}`);
      setDetail(data as typeof detail);
    } catch { /* ignore transient */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList, refreshKey]);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void loadList();
      if (selected) void loadDetail(selected);
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected, loadList, loadDetail]);
  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => { void loadDetail(selected); }, 0);
    return () => window.clearTimeout(timer);
  }, [selected, loadDetail]);

  const start = async () => {
    if (!newGoal.trim()) return;
    try {
      const data = await api<{ task: Task }>("/api/agent/tasks", { method: "POST", json: { goal: newGoal.trim() } });
      setNewGoal(""); setShowNew(false);
      await loadList();
      setSelected(data.task.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const act = async (id: string, action: string) => {
    await api(`/api/agent/tasks/${id}`, { method: "POST", json: { action } });
    loadDetail(id); loadList();
  };

  const resolveApproval = async (approvalId: string, approved: boolean) => {
    await api("/api/agent/approvals", { method: "POST", json: { approvalId, approved } });
    if (selected) setTimeout(() => loadDetail(selected), 800);
  };

  const statusColor = (s: string) => {
    if (s === "completed") return "bg-emerald-500/15 text-emerald-300";
    if (s === "failed") return "bg-red-500/15 text-red-300";
    if (s === "running" || s === "planning") return "bg-sky-500/15 text-sky-300";
    if (s === "awaiting_approval") return "bg-amber-500/15 text-amber-300";
    if (s === "stopped" || s === "paused") return "bg-slate-500/15 text-slate-300";
    return "bg-white/10 text-slate-300";
  };

  const pendingApprovals = detail?.approvals.filter((a) => a.status === "pending") || [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:h-full md:flex-row md:p-6">
      {/* List */}
      <div className="space-y-2 md:w-80 md:shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Agent tasks</h2>
          <button onClick={() => setShowNew(!showNew)} className="flex items-center gap-1 rounded-xl bg-fuchsia-500 px-3 py-1.5 text-xs font-bold text-white">
            <Plus size={14} /> New task
          </button>
        </div>
        {showNew && (
          <div className="space-y-2 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
            <textarea value={newGoal} onChange={(e) => setNewGoal(e.target.value)} rows={3} placeholder="Goal: e.g. Research 5 local LLM options, compare them, cite sources, save a summary to this project." className="w-full rounded-lg border border-white/15 bg-black/30 p-2 text-sm" />
            <button onClick={start} className="w-full rounded-lg bg-fuchsia-500 py-2 text-sm font-bold text-white">Start agent</button>
          </div>
        )}
        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{error}</div>}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto md:max-h-none">
          {tasks.map((t) => (
            <button key={t.id} onClick={() => setSelected(t.id)} className={`w-full rounded-2xl border p-3 text-left ${selected === t.id ? "border-fuchsia-500/50 bg-fuchsia-500/10" : "border-white/10 bg-white/5 hover:border-white/20"}`}>
              <div className="line-clamp-2 text-sm font-medium">{t.goal}</div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${statusColor(t.status)}`}>{t.status.replace(/_/g, " ")}</span>
                <span>{timeAgo(t.createdAt)}</span>
              </div>
            </button>
          ))}
          {!tasks.length && <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-500">No agent tasks yet. Describe a multi-step goal to begin.</div>}
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1">
        {!selected || !detail ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 text-sm text-slate-500">
            <Bot size={20} className="mr-2" /> Select a task to inspect its plan, tools, and approvals.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusColor(detail.task.status)}`}>
                  {detail.task.status.replace(/_/g, " ").toUpperCase()}
                </span>
                <span className="text-xs text-slate-400">step {detail.task.currentStep}/{detail.task.maxSteps}</span>
                <div className="ml-auto flex gap-1.5">
                  {(detail.task.status === "running" || detail.task.status === "awaiting_approval" || detail.task.status === "pending") && (
                    <button onClick={() => act(detail.task.id, "stop")} className="flex items-center gap-1 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white">
                      <OctagonX size={13} /> STOP
                    </button>
                  )}
                  {(detail.task.status === "stopped" || detail.task.status === "failed" || detail.task.status === "paused") && (
                    <button onClick={() => act(detail.task.id, "resume")} className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">
                      <Play size={13} /> Resume
                    </button>
                  )}
                  {detail.task.status === "running" && (
                    <button onClick={() => act(detail.task.id, "pause")} className="flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs">
                      <Pause size={13} /> Pause
                    </button>
                  )}
                  <button onClick={() => loadDetail(detail.task.id)} className="rounded-lg border border-white/15 p-1.5"><RefreshCw size={13} /></button>
                </div>
              </div>
              <div className="mt-2 font-semibold">{detail.task.goal}</div>
              {!!detail.task.modelsUsed?.length && <div className="mt-1 font-mono text-[11px] text-slate-400">models: {detail.task.modelsUsed.join(" · ")}</div>}
              {!!detail.task.toolsUsed?.length && <div className="font-mono text-[11px] text-slate-400">tools: {detail.task.toolsUsed.join(" · ")}</div>}
              {detail.task.outcome && (
                <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                  <div className="text-xs font-bold uppercase text-emerald-300">Outcome</div>
                  <Markdown text={detail.task.outcome} />
                </div>
              )}
              {detail.task.error && <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">{detail.task.error}</div>}
            </div>

            {pendingApprovals.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 font-bold text-amber-200"><ShieldAlert size={16} /> Approval required ({pendingApprovals.length})</div>
                {pendingApprovals.map((a) => (
                  <div key={a.id} className="rounded-xl bg-black/30 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Wrench size={14} className="text-amber-300" />
                      <span className="font-mono font-bold">{a.toolName}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${a.riskLevel === "high" ? "bg-red-500/20 text-red-200" : "bg-amber-500/20 text-amber-200"}`}>{a.riskLevel} risk</span>
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-300">{a.action}</div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => resolveApproval(a.id, true)} className="flex items-center gap-1 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-white">
                        <Check size={13} /> Approve & run
                      </button>
                      <button onClick={() => resolveApproval(a.id, false)} className="flex items-center gap-1 rounded-lg border border-red-500/40 px-4 py-1.5 text-xs font-bold text-red-200">
                        <X size={13} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Activity</div>
              {detail.steps.map((s) => (
                <div key={s.id} className="flex gap-2 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm">
                  <span className="mt-0.5 text-base">
                    {s.kind === "plan" ? "📋" : s.kind === "tool_call" ? "🔧" : s.kind === "approval" ? "🛡️" : s.kind === "result" ? "✅" : s.kind === "llm" ? "💭" : "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{s.title}</span>
                      {s.status === "failed" && <span className="rounded bg-red-500/20 px-1 text-[10px] text-red-200">failed</span>}
                      {s.status === "awaiting_approval" && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-200">waiting</span>}
                      {s.status === "running" && <span className="animate-pulse-dot rounded bg-sky-500/20 px-1 text-[10px] text-sky-200">running</span>}
                    </div>
                    {s.detail && <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-400">{s.detail.slice(0, 1200)}</div>}
                  </div>
                </div>
              ))}
              {!detail.steps.length && <div className="text-sm text-slate-500">No activity yet — the agent is starting.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Tools & permissions ----------------
export function ToolsPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [tools, setTools] = useState<Array<{ name: string; description: string; category: string; riskLevel: string; policy: string; available: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tools: typeof tools }>("/api/tools");
      setTools(data.tools);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const setPolicy = async (name: string, policy: string) => {
    try {
      await api("/api/tools/permissions", { method: "POST", json: { toolName: name, policy } });
      load(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const riskColor = (r: string) => r === "low" ? "text-emerald-300" : r === "medium" ? "text-amber-300" : "text-red-300";

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
      <div>
        <h2 className="text-xl font-bold">Tools & permissions</h2>
        <p className="text-sm text-slate-400">Every tool declares its risk. Chat mode auto-runs only “Always allow” tools; the agent pauses for approval otherwise.</p>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {tools.map((t) => (
        <div key={t.name} className={`rounded-2xl border p-4 ${t.available ? "border-white/10 bg-white/5" : "border-white/5 bg-white/[0.02] opacity-70"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold">{t.name}</span>
            <span className={`text-xs font-bold uppercase ${riskColor(t.riskLevel)}`}>{t.riskLevel} risk</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">{t.category}</span>
            {!t.available && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px]">planned</span>}
            <select
              value={t.policy}
              onChange={(e) => setPolicy(t.name, e.target.value)}
              disabled={!t.available}
              className="ml-auto rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs"
            >
              <option value="always_allow">Always allow</option>
              <option value="ask">Ask (agent)</option>
              <option value="always_ask">Always ask</option>
              <option value="deny">Disabled</option>
            </select>
          </div>
          <p className="mt-1 text-sm text-slate-400">{t.description}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------- Usage ----------------
export function UsagePanel({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<{ day: { cost: number; tokensIn: number; tokensOut: number; calls: number }; month: { cost: number; tokensIn: number; tokensOut: number; calls: number }; byProvider: Array<{ provider: string; model: string; cost: number; calls: number; tokensIn: number; tokensOut: number }>; note: string } | null>(null);

  useEffect(() => {
    api<typeof stats & {}>("/api/usage").then((d) => setStats(d as typeof stats)).catch(() => {});
  }, [refreshKey]);

  if (!stats) return <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-slate-500" /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <h2 className="text-xl font-bold">Costs & usage</h2>
        <p className="text-sm text-slate-400">{stats.note}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-400"><DollarSign size={14} /> Today</div>
          <div className="mt-1 text-3xl font-bold">${Number(stats.day?.cost || 0).toFixed(4)}</div>
          <div className="mt-1 text-xs text-slate-400">{stats.day?.calls || 0} calls · {Number(stats.day?.tokensIn || 0).toLocaleString()} in / {Number(stats.day?.tokensOut || 0).toLocaleString()} out</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-400"><DollarSign size={14} /> Last 30 days</div>
          <div className="mt-1 text-3xl font-bold">${Number(stats.month?.cost || 0).toFixed(2)}</div>
          <div className="mt-1 text-xs text-slate-400">{stats.month?.calls || 0} calls · {Number(stats.month?.tokensIn || 0).toLocaleString()} in / {Number(stats.month?.tokensOut || 0).toLocaleString()} out</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-400">By provider / model (30d)</div>
        {stats.byProvider.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-2.5 text-sm">
            <span className="font-semibold">{r.provider || "(unknown)"}</span>
            <span className="font-mono text-xs text-slate-400">{r.model}</span>
            <span className="ml-auto font-mono text-xs">${Number(r.cost).toFixed(4)}</span>
            <span className="text-[11px] text-slate-500">{r.calls} calls</span>
          </div>
        ))}
        {!stats.byProvider.length && <div className="p-6 text-center text-sm text-slate-500">No usage recorded yet.</div>}
      </div>
    </div>
  );
}

// ---------------- Automations ----------------
export function AutomationsPanel({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Array<{ id: string; name: string; goal: string; scheduleKind: string; scheduleValue: string; enabled: boolean; lastRunAt?: string; lastStatus?: string }>>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", goal: "", scheduleKind: "interval", scheduleValue: "1440" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ automations: typeof items }>("/api/automations");
      setItems(data.automations);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const save = async () => {
    try {
      await api("/api/automations", { method: "POST", json: form });
      setShowAdd(false);
      setForm({ name: "", goal: "", scheduleKind: "interval", scheduleValue: "1440" });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Automations</h2>
          <p className="text-sm text-slate-400">Scheduled agent goals stored locally. V1 supports Run Now; background cron runs via the bundled scheduler.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white">
          <Plus size={16} /> New
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {showAdd && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <label className="block">
            <span className="text-xs text-slate-400">Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" placeholder="Morning industry briefing" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Goal (agent instructions)</span>
            <textarea value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" placeholder="Research overnight developments in local AI and save a briefing…" />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-400">Schedule type</span>
              <select value={form.scheduleKind} onChange={(e) => setForm({ ...form, scheduleKind: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm">
                <option value="interval">Every N minutes</option>
                <option value="cron">Cron expression</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">{form.scheduleKind === "interval" ? "Minutes" : "Cron"}</span>
              <input value={form.scheduleValue} onChange={(e) => setForm({ ...form, scheduleValue: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" placeholder={form.scheduleKind === "interval" ? "1440" : "0 7 * * *"} />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white">Save</button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      {items.map((a) => (
        <div key={a.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-slate-400" />
            <span className="font-semibold">{a.name}</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">{a.scheduleKind === "interval" ? `every ${a.scheduleValue}m` : a.scheduleValue}</span>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
              {a.lastRunAt ? `last run ${timeAgo(a.lastRunAt)}` : "never run"}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-400">{a.goal}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={async () => { await api(`/api/automations/${a.id}`, { method: "POST" }); load(); }} className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">
              <Play size={12} /> Run now
            </button>
            <button onClick={async () => { await api(`/api/automations/${a.id}`, { method: "PATCH", json: { enabled: !a.enabled } }); load(); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">
              {a.enabled ? "Pause" : "Resume"}
            </button>
            <button onClick={async () => { if (confirm("Delete automation?")) { await api(`/api/automations/${a.id}`, { method: "DELETE" }); load(); } }} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
      {!items.length && <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">No automations. Example: “Every morning, brief me on AI regulation news.”</div>}
    </div>
  );
}

// ---------------- Settings ----------------
export function SettingsPanel({ refreshKey, onChanged, globalPrivacy, onPrivacy }: { refreshKey: number; onChanged: () => void; globalPrivacy: boolean; onPrivacy: (v: boolean) => void }) {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [logs, setLogs] = useState<Array<{ id: string; level: string; category: string; message: string; createdAt: string }>>([]);
  const [searchConnectors, setSearchConnectors] = useState<Array<{ id: string; type: string; name: string; enabled: boolean; status: string }>>([]);
  const [section, setSection] = useState<"general" | "voice" | "intelligence" | "web">("general");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ settings: Record<string, unknown> }>("/api/settings");
      setSettings(data.settings);
      const [l, c] = await Promise.all([
        api<{ logs: typeof logs }>("/api/logs"),
        api<{ connectors: typeof searchConnectors }>("/api/connectors"),
      ]);
      setLogs(l.logs);
      setSearchConnectors(c.connectors.filter((connector) => connector.type.startsWith("search_")));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      const data = await api<{ settings: Record<string, unknown> }>("/api/settings", { method: "PATCH", json: patch });
      setSettings(data.settings);
      if (patch.privacyMode !== undefined) onPrivacy(Boolean(patch.privacyMode));
      setNotice("Settings saved.");
      setTimeout(() => setNotice(null), 2200);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const num = (k: string) => (settings[k] as number | null) ?? "";
  const selectClass = "mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm";
  const sections = [
    { id: "general" as const, label: "General" },
    { id: "voice" as const, label: "Voice" },
    { id: "intelligence" as const, label: "Intelligence" },
    { id: "web" as const, label: "Web & Research" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <h2 className="text-xl font-bold">Settings</h2>
        <p className="text-sm text-slate-400">Configure Ragnarok&apos;s voice, reasoning effort, live web access, privacy, and existing application defaults.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Settings categories">
        {sections.map((tab) => (
          <button key={tab.id} role="tab" aria-selected={section === tab.id} onClick={() => setSection(tab.id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${section === tab.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}>
            {tab.label}
          </button>
        ))}
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>}

      {section === "voice" && <VoiceSettingsPanel />}

      {section === "intelligence" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex items-center gap-2 font-semibold"><Zap size={15} className="text-amber-200" /> Auto Route</div>
            <label className="mt-3 block">
              <span className="text-xs text-slate-400">Default routing mode</span>
              <select value={String(settings.routingMode || "auto")} onChange={(e) => save({ routingMode: e.target.value })} className={selectClass}>
                <option value="auto">Automatic · choose a suitable provider and model</option>
                <option value="ask">Ask me · confirm the selected model first</option>
                <option value="manual">Manual · use the model pinned in each conversation</option>
              </select>
            </label>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">Automatic routing considers task capability, privacy, reasoning depth, tool/research needs, and speed/cost signals. Local and smaller models are favored for simple fast requests; stronger models are favored for difficult work when available.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex items-center gap-2 font-semibold"><Brain size={15} className="text-violet-200" /> Reasoning effort</div>
            <label className="mt-3 block">
              <span className="text-xs text-slate-400">Default reasoning depth</span>
              <select value={String(settings.reasoningDepth || "auto")} onChange={(e) => save({ reasoningDepth: e.target.value })} className={selectClass}>
                <option value="auto">Auto · estimate task complexity</option>
                <option value="fast">Fast · favor speed and lower cost</option>
                <option value="balanced">Balanced · ordinary requests</option>
                <option value="deep">Deep · difficult analysis, code, research, math, and planning</option>
                <option value="maximum">Maximum · highest practical effort for this request</option>
              </select>
            </label>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">The choice is saved between sessions and can be overridden in the chat header. Native effort controls are sent only to model families known to support them (including supported OpenAI reasoning and Gemini thinking models); other models receive an effort-aware prompt and Auto Route scoring instead.</p>
          </div>
        </div>
      )}

      {section === "web" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex items-center gap-2 font-semibold"><Search size={15} className="text-sky-200" /> Web Access</div>
            <label className="mt-3 block">
              <span className="text-xs text-slate-400">Chat web retrieval</span>
              <select value={String(settings.webAccess || "auto")} onChange={(e) => save({ webAccess: e.target.value })} className={selectClass}>
                <option value="auto">Auto · search when current information is needed</option>
                <option value="on">On · retrieve live sources for each chat request</option>
                <option value="off">Off · disable web search and browsing in chat</option>
              </select>
            </label>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">Auto uses task and freshness classification. On performs real search and, when privacy allows, retrieves readable pages. Off removes web tools from chat and instructs the model not to imply live retrieval. Manual searches in the Research workspace remain explicit user actions and always honor Privacy Mode.</p>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-sm font-medium">Search providers</div>
              {searchConnectors.filter((connector) => connector.enabled).length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {searchConnectors.filter((connector) => connector.enabled).map((connector) => (
                    <span key={connector.id} className="rounded-lg border border-sky-400/20 bg-sky-400/5 px-2.5 py-1.5 text-xs text-sky-100">{connector.name} · {connector.type.replace("search_", "")}</span>
                  ))}
                </div>
              ) : <p className="mt-1 text-xs text-slate-500">Built-in live search: DuckDuckGo + Wikipedia. Add Tavily, Brave, Serper, or self-hosted SearXNG for additional providers.</p>}
              <button onClick={() => window.dispatchEvent(new CustomEvent("ragnarok:goto-connectors"))} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">Manage search connectors</button>
            </div>
            <div className="mt-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-xs text-slate-300">When live sources are retrieved, Ragnarok shows clickable citations beneath its answer. If retrieval fails, it reports the limitation rather than claiming the model&apos;s pretrained knowledge is live.</div>
          </div>
        </div>
      )}

      {section === "general" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 font-semibold"><SettingsIcon size={15} /> Appearance</div>
            <p className="mt-1 text-sm text-slate-400">The workspace stays near-black. The sidebar can show a restrained Swedish-blue field with a muted gold Nordic cross.</p>
            <label className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>Swedish flag sidebar treatment</span>
              <button onClick={() => save({ sidebarFlagEnabled: settings.sidebarFlagEnabled === false })} aria-pressed={settings.sidebarFlagEnabled !== false} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${settings.sidebarFlagEnabled !== false ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/15 text-slate-300"}`}>
                {settings.sidebarFlagEnabled !== false ? "ON" : "OFF"}
              </button>
            </label>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={15} /> Privacy</div>
            <label className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>Privacy Mode · restrict model routing to local providers</span>
              <button onClick={() => save({ privacyMode: !globalPrivacy })} aria-pressed={globalPrivacy} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${globalPrivacy ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-300"}`}>
                {globalPrivacy ? "ON" : "OFF"}
              </button>
            </label>
            <p className="mt-2 text-xs text-slate-500">Global privacy applies even if an individual conversation has Privacy Mode off. Cloud model calls are blocked; web search requires a configured private SearXNG instance.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 font-semibold"><DollarSign size={15} /> Budget controls</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block"><span className="text-xs text-slate-400">Daily warn ($)</span><input type="number" step="0.5" value={num("budgetDailyUsd")} onChange={(e) => save({ budgetDailyUsd: e.target.value ? Number(e.target.value) : null })} className={selectClass} placeholder="—" /></label>
                <label className="block"><span className="text-xs text-slate-400">Monthly warn ($)</span><input type="number" step="1" value={num("budgetMonthlyUsd")} onChange={(e) => save({ budgetMonthlyUsd: e.target.value ? Number(e.target.value) : null })} className={selectClass} placeholder="—" /></label>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Chat is blocked with a clear message once a limit is reached (override available per request).</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 font-semibold"><Bot size={15} /> Agent limits</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block"><span className="text-xs text-slate-400">Max steps</span><input type="number" value={Number(settings.agentMaxSteps || 25)} onChange={(e) => save({ agentMaxSteps: Number(e.target.value) || 25 })} className={selectClass} /></label>
                <label className="block"><span className="text-xs text-slate-400">Max retries</span><input type="number" value={Number(settings.agentMaxRetries ?? 2)} onChange={(e) => save({ agentMaxRetries: Number(e.target.value) ?? 2 })} className={selectClass} /></label>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Hard caps prevent runaway loops. Agent state persists — resume anytime.</p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 font-semibold"><SettingsIcon size={15} /> Context</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="text-xs text-slate-400">Recent messages</span><input type="number" value={Number(settings.contextRecentMessages || 24)} onChange={(e) => save({ contextRecentMessages: Number(e.target.value) || 24 })} className={selectClass} /></label>
              <label className="block"><span className="text-xs text-slate-400">Max chars</span><input type="number" value={Number(settings.contextMaxChars || 24000)} onChange={(e) => save({ contextMaxChars: Number(e.target.value) || 24000 })} className={selectClass} /></label>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 font-semibold"><Download size={15} /> Backup & restore</div>
            <p className="mt-1 text-xs text-slate-400">Export everything (conversations, memories, projects, task history, settings). API keys are never exported.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href="/api/export" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/15">Download backup</a>
              <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-white/15 px-4 py-2 text-sm">
                <Upload size={14} /> Restore
                <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const json = JSON.parse(await f.text());
                    const res = await api<{ restored: Record<string, number> }>("/api/import", { method: "POST", json });
                    setNotice(`Restored: ${JSON.stringify(res.restored)}`);
                    onChanged();
                  } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                }} />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 font-semibold"><ScrollText size={15} /> System logs <span className="text-xs font-normal text-slate-500">(secrets never logged)</span></div>
            <div className="mt-2 max-h-72 space-y-1 overflow-auto font-mono text-xs">
              {logs.slice(0, 120).map((l) => (
                <div key={l.id} className="flex flex-wrap gap-2 border-b border-white/5 py-1">
                  <span className={l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-300" : "text-slate-400"}>[{l.level}]</span>
                  <span className="text-sky-300">[{l.category}]</span>
                  <span className="min-w-0 flex-1 break-words text-slate-300">{l.message}</span>
                  <span className="text-slate-600">{timeAgo(l.createdAt)}</span>
                </div>
              ))}
              {!logs.length && <div className="text-slate-500">No logs yet.</div>}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-500">Ragnarok · Local-first · Your data stays in your database and workspace. Remote access: use a VPN or authenticated reverse proxy — never expose this port directly to the internet.</div>
        </div>
      )}
    </div>
  );
}
