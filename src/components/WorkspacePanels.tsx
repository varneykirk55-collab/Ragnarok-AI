"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FolderKanban, Plus, Trash2, Loader2, Brain, Pin, PinOff, Pencil, Search,
  FlaskConical, ExternalLink, Image as ImageIcon, FolderOpen, FileText, Upload, Eye, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { api, timeAgo } from "@/lib/client-api";
import { Markdown } from "./Markdown";

// ---------------- Projects ----------------
export function ProjectsPanel({ refreshKey, onChanged, onOpenProject }: { refreshKey: number; onChanged: () => void; onOpenProject: (id: string) => void }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string; description: string; instructions: string; color: string; updatedAt: string }>>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", instructions: "", color: "#6366f1" });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ projects: typeof projects }>("/api/projects");
      setProjects(data.projects);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const save = async () => {
    try {
      if (editing) {
        await api(`/api/projects/${editing}`, { method: "PATCH", json: form });
      } else {
        if (!form.name.trim()) throw new Error("Name required");
        await api("/api/projects", { method: "POST", json: form });
      }
      setShowAdd(false); setEditing(null);
      setForm({ name: "", description: "", instructions: "", color: "#6366f1" });
      load(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Projects</h2>
          <p className="text-sm text-slate-400">Isolated workspaces with their own conversations, files, memories, and instructions.</p>
        </div>
        <button onClick={() => { setShowAdd(!showAdd); setEditing(null); }} className="flex items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white">
          <Plus size={16} /> New project
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {showAdd && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-400">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Color</span>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-white/15 bg-black/30" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-400">Description</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Project instructions (added to every conversation in this project)</span>
            <textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" placeholder="e.g. Always use TypeScript. Cite sources. Prefer concise answers." />
          </label>
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white">{editing ? "Save" : "Create"}</button>
            <button onClick={() => { setShowAdd(false); setEditing(null); }} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p) => (
          <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
              <span className="font-semibold">{p.name}</span>
              <span className="ml-auto text-[11px] text-slate-500">{timeAgo(p.updatedAt)}</span>
            </div>
            {p.description && <p className="mt-1 text-sm text-slate-400">{p.description}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => onOpenProject(p.id)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/15">Open files</button>
              <button onClick={() => { setEditing(p.id); setForm({ name: p.name, description: p.description, instructions: p.instructions, color: p.color }); setShowAdd(true); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">Edit</button>
              <button onClick={async () => { if (confirm(`Delete project "${p.name}"? Conversations are kept but unlinked.`)) { await api(`/api/projects/${p.id}`, { method: "DELETE" }); load(); onChanged(); } }} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {projects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
          <FolderKanban size={28} className="mx-auto text-slate-500" />
          <p className="mt-2">No projects yet. Create one to group conversations, files, and memories.</p>
        </div>
      )}
    </div>
  );
}

// ---------------- Memory ----------------
const CATEGORIES = ["preferences", "projects", "businesses", "people", "workflows", "decisions", "goals", "instructions", "facts", "general"];

export function MemoryPanel({ refreshKey }: { refreshKey: number }) {
  const [memories, setMemories] = useState<Array<{ id: string; category: string; title: string; content: string; pinned: boolean; enabled: boolean; importance: number; updatedAt: string }>>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "facts", importance: 5 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ memories: typeof memories }>(`/api/memories?q=${encodeURIComponent(search)}&category=${category}`);
      setMemories(data.memories);
      const s = await api<{ settings: { memoryEnabled: boolean } }>("/api/settings");
      setMemoryEnabled(s.settings.memoryEnabled);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [search, category]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 300); return () => window.clearTimeout(timer); }, [load]);

  const save = async () => {
    try {
      if (editingId) {
        await api(`/api/memories/${editingId}`, { method: "PATCH", json: form });
      } else {
        if (!form.content.trim()) throw new Error("Content required");
        await api("/api/memories", { method: "POST", json: form });
      }
      setShowAdd(false); setEditingId(null);
      setForm({ title: "", content: "", category: "facts", importance: 5 });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Memory</h2>
          <p className="text-sm text-slate-400">Local, persistent, semantically retrieved. Type “Remember…” in chat for quick capture.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { await api("/api/settings", { method: "PATCH", json: { memoryEnabled: !memoryEnabled } }); setMemoryEnabled(!memoryEnabled); }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${memoryEnabled ? "border-emerald-500/50 text-emerald-200" : "border-white/15 text-slate-400"}`}
          >
            Memory {memoryEnabled ? "ON" : "OFF"}
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setEditingId(null); }} className="flex items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white">
            <Plus size={16} /> Add memory
          </button>
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search memories…" className="w-full rounded-xl border border-white/15 bg-white/5 py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-white/15 bg-white/5 px-3 text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {showAdd && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-400">Title</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Category</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-400">Content</span>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" />
          </label>
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white">{editingId ? "Save" : "Add"}</button>
            <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {memories.map((m) => (
          <div key={m.id} className={`rounded-2xl border p-4 ${m.enabled ? "border-white/10 bg-white/5" : "border-white/5 bg-white/[0.02] opacity-60"}`}>
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-200">{m.category}</span>
              <span className="font-semibold">{m.title}</span>
              {m.pinned && <Pin size={12} className="text-amber-300" />}
              <span className="ml-auto text-[11px] text-slate-500">{timeAgo(m.updatedAt)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{m.content}</p>
            <div className="mt-2 flex gap-1.5">
              <button onClick={async () => { await api(`/api/memories/${m.id}`, { method: "PATCH", json: { pinned: !m.pinned } }); load(); }} className="rounded-lg border border-white/15 p-1.5 text-xs" title={m.pinned ? "Unpin" : "Pin"}>
                {m.pinned ? <PinOff size={12} /> : <Pin size={12} />}
              </button>
              <button onClick={() => { setEditingId(m.id); setForm({ title: m.title, content: m.content, category: m.category, importance: m.importance }); setShowAdd(true); }} className="rounded-lg border border-white/15 p-1.5" title="Edit">
                <Pencil size={12} />
              </button>
              <button onClick={async () => { await api(`/api/memories/${m.id}`, { method: "PATCH", json: { enabled: !m.enabled } }); load(); }} className="rounded-lg border border-white/15 px-2 py-1 text-xs">
                {m.enabled ? "Disable" : "Enable"}
              </button>
              <button onClick={async () => { if (confirm("Delete this memory?")) { await api(`/api/memories/${m.id}`, { method: "DELETE" }); load(); } }} className="rounded-lg border border-red-500/30 p-1.5 text-red-300">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {memories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
          <Brain size={28} className="mx-auto text-slate-500" />
          <p className="mt-2">No memories yet. In chat, type “Remember that I prefer…” and it will be stored here.</p>
        </div>
      )}
    </div>
  );
}

// ---------------- Files ----------------
export function FilesPanel({ refreshKey, projectFilter }: { refreshKey: number; projectFilter: string | null }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>(projectFilter || "");
  const [files, setFiles] = useState<Array<{ name: string; path: string; size: number; dir: boolean }>>([]);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectFilter) return;
    const timer = window.setTimeout(() => setProjectId(projectFilter), 0);
    return () => window.clearTimeout(timer);
  }, [projectFilter]);

  const load = useCallback(async () => {
    try {
      const p = await api<{ projects: typeof projects }>("/api/projects");
      setProjects(p.projects);
      const f = await api<{ files: typeof files }>(`/api/files?projectId=${projectId}`);
      setFiles(f.files);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const upload = async (fl: FileList | null) => {
    if (!fl?.length) return;
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("file", fl[0]);
    const res = await fetch("/api/files", { method: "POST", body: form });
    if (!res.ok) setError(await res.text());
    else load();
  };

  const view = async (path: string) => {
    try {
      const data = await api<{ content: string }>(`/api/files/read?projectId=${projectId}&path=${encodeURIComponent(path)}`);
      setPreview({ path, content: data.content });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Files</h2>
          <p className="text-sm text-slate-400">Project-scoped workspace. The assistant reads/writes here via file tools — never outside this sandbox.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm">
            <option value="">Shared workspace</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white">
            <Upload size={14} /> Upload
            <input type="file" className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      <div className="overflow-hidden rounded-2xl border border-white/10">
        {files.filter((f) => !f.dir).map((f) => (
          <div key={f.path} className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5 text-sm last:border-0 hover:bg-white/5">
            <FileText size={14} className="shrink-0 text-slate-400" />
            <span className="truncate font-mono text-xs">{f.path}</span>
            <span className="ml-auto text-[11px] text-slate-500">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`}</span>
            <button onClick={() => view(f.path)} className="rounded-lg border border-white/15 p-1.5" title="Preview"><Eye size={12} /></button>
            <button onClick={async () => { if (confirm(`Delete ${f.path}?`)) { await api(`/api/files?projectId=${projectId}&path=${encodeURIComponent(f.path)}`, { method: "DELETE" }); load(); } }} className="rounded-lg border border-red-500/30 p-1.5 text-red-300">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {!files.filter((f) => !f.dir).length && (
          <div className="p-8 text-center text-sm text-slate-500">
            <FolderOpen size={28} className="mx-auto text-slate-600" />
            <p className="mt-2">Workspace is empty. Agent reports, documents, and uploads land here.</p>
          </div>
        )}
      </div>
      {preview && (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs text-slate-300">{preview.path}</span>
            <button onClick={() => setPreview(null)} className="text-xs text-slate-400 hover:text-white">Close</button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-200">{preview.content}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------- Research (search + factcheck + image) ----------------
export function ResearchPanel({ globalPrivacy }: { globalPrivacy: boolean }) {
  const [tab, setTab] = useState<"search" | "factcheck" | "image">("search");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Array<{ title: string; url: string; snippet: string; source: string }>>([]);
  const [provider, setProvider] = useState("");
  const [factResult, setFactResult] = useState<{ verdict: string; analysis: string; sources: Array<{ title: string; url: string; source: string }> } | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageNotice, setImageNotice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(null); setResults([]);
    try {
      const data = await api<{ results: typeof results; provider: string }>("/api/search", { method: "POST", json: { query, maxResults: 10, privacyMode: globalPrivacy } });
      setResults(data.results);
      setProvider(data.provider);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const doFactCheck = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(null); setFactResult(null);
    try {
      const data = await api<typeof factResult & { error?: string }>("/api/factcheck", { method: "POST", json: { claim: query, privacyMode: globalPrivacy } });
      setFactResult(data as typeof factResult);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const doImage = async () => {
    if (!imagePrompt.trim()) return;
    setLoading(true); setError(null); setImageUrl(""); setImageNotice("");
    try {
      const data = await api<{ url?: string; b64?: string; notice?: string; provider: string }>("/api/image", { method: "POST", json: { prompt: imagePrompt } });
      setImageUrl(data.b64 ? `data:image/png;base64,${data.b64}` : data.url || "");
      setImageNotice(`${data.provider}${data.notice ? ` — ${data.notice}` : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const verdictColor = (v: string) => {
    if (v.includes("supported") && !v.includes("unsupported")) return "text-emerald-300";
    if (v === "mixed") return "text-amber-300";
    if (v === "misleading" || v === "unsupported") return "text-red-300";
    return "text-slate-300";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <h2 className="text-xl font-bold">Research</h2>
        <p className="text-sm text-slate-400">Live web search with real citations, evidence-based fact checking, and image generation.</p>
      </div>
      <div className="flex gap-1 rounded-xl bg-white/5 p-1">
        {(["search", "factcheck", "image"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === t ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"}`}>
            {t === "search" ? <Search size={14} /> : t === "factcheck" ? <FlaskConical size={14} /> : <ImageIcon size={14} />}
            {t === "search" ? "Web search" : t === "factcheck" ? "Fact check" : "Generate image"}
          </button>
        ))}
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}

      {tab !== "image" ? (
        <>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") tab === "search" ? doSearch() : doFactCheck(); }}
              placeholder={tab === "search" ? "Search the live web…" : "Paste a claim, paragraph, or article to verify…"}
              className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm"
            />
            <button onClick={tab === "search" ? doSearch : doFactCheck} disabled={loading} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {loading ? <Loader2 size={16} className="animate-spin" /> : tab === "search" ? "Search" : "Check"}
            </button>
          </div>
          {tab === "search" && provider && <div className="text-xs text-slate-500">via {provider} · {results.length} results · live, never fabricated</div>}
          {tab === "search" && results.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="block rounded-2xl border border-white/10 bg-white/5 p-4 hover:border-indigo-500/40">
              <div className="flex items-center gap-1 text-xs text-slate-400"><ExternalLink size={11} /> [{i + 1}] {r.source}</div>
              <div className="mt-1 font-semibold text-indigo-200">{r.title}</div>
              <p className="mt-1 text-sm text-slate-300">{r.snippet}</p>
              <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{r.url}</div>
            </a>
          ))}
          {tab === "factcheck" && factResult && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2">
                  {factResult.verdict.includes("unsupported") || factResult.verdict === "misleading" ? <AlertTriangle className="text-red-300" /> : <CheckCircle2 className="text-emerald-300" />}
                  <span className={`text-lg font-bold uppercase ${verdictColor(factResult.verdict)}`}>{factResult.verdict.replace(/_/g, " ")}</span>
                </div>
                <div className="mt-2"><Markdown text={factResult.analysis} /></div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sources consulted</div>
              {factResult.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-white/10 bg-white/5 p-3 text-sm hover:border-indigo-500/40">
                  <span className="text-indigo-200">[{i + 1}] {s.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{s.source}</span>
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <input value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} placeholder="Describe the image to generate…" className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm" />
            <button onClick={doImage} disabled={loading} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {loading ? <Loader2 size={16} className="animate-spin" /> : "Generate"}
            </button>
          </div>
          {imageNotice && <div className="text-xs text-slate-500">{imageNotice}</div>}
          {imageUrl && (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={imagePrompt} className="w-full" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
