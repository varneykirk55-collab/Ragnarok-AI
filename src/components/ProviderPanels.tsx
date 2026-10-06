"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plug, Plus, RefreshCw, Trash2, XCircle, Power, KeyRound, ChevronDown } from "lucide-react";
import { api } from "@/lib/client-api";

interface Provider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  enabled: boolean;
  isLocal: boolean;
  status: string;
  statusMessage?: string;
  defaultModel: string;
  fallbackModels: string[];
  hasApiKey: boolean;
}

const TYPE_INFO: Record<string, { label: string; hint: string; needsKey: boolean; local: boolean; basePlaceholder: string }> = {
  openai: { label: "OpenAI", hint: "GPT models via api.openai.com", needsKey: true, local: false, basePlaceholder: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic", hint: "Claude models", needsKey: true, local: false, basePlaceholder: "https://api.anthropic.com/v1" },
  google: { label: "Google", hint: "Gemini models", needsKey: true, local: false, basePlaceholder: "https://generativelanguage.googleapis.com/v1beta" },
  xai: { label: "xAI", hint: "Grok models", needsKey: true, local: false, basePlaceholder: "https://api.x.ai/v1" },
  ollama: { label: "Ollama (local)", hint: "Local models via Ollama. Run: ollama serve", needsKey: false, local: true, basePlaceholder: "http://localhost:11434" },
  openai_compatible: { label: "OpenAI-Compatible (local/custom)", hint: "LM Studio, llama.cpp, vLLM, Together, DeepSeek, etc.", needsKey: false, local: true, basePlaceholder: "http://localhost:1234/v1" },
};

function StatusBadge({ p }: { p: Provider }) {
  const map: Record<string, { dot: string; label: string }> = {
    connected: { dot: "bg-emerald-400", label: "Connected" },
    local: { dot: "bg-sky-400", label: "Local" },
    error: { dot: "bg-red-400", label: "Error" },
    disabled: { dot: "bg-slate-500", label: "Disabled" },
    disconnected: { dot: "bg-amber-400", label: "Not tested" },
  };
  const s = map[p.status] || map.disconnected;
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-300">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
    </span>
  );
}

export function ProvidersPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "openai", baseUrl: "", apiKey: "", defaultModel: "" });
  const [testing, setTesting] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [modelsFor, setModelsFor] = useState<{ id: string; list: Array<{ id: string }> } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editModel, setEditModel] = useState<{ id: string; model: string; fallbacks: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<{ providers: Provider[] }>("/api/providers");
      setProviders(data.providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [refreshKey]);

  const addProvider = async () => {
    setError(null);
    try {
      if (!form.name.trim()) throw new Error("Name is required.");
      const info = TYPE_INFO[form.type];
      if (info.needsKey && !form.apiKey.trim()) throw new Error(`${info.label} requires an API key.`);
      await api("/api/providers", {
        method: "POST",
        json: { name: form.name.trim(), type: form.type, baseUrl: form.baseUrl.trim() || info.basePlaceholder, apiKey: form.apiKey.trim(), isLocal: info.local, defaultModel: form.defaultModel.trim() },
      });
      setShowAdd(false);
      setForm({ name: "", type: "openai", baseUrl: "", apiKey: "", defaultModel: "" });
      setNotice("Provider added. Click Test to verify, then Fetch models.");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    setError(null);
    try {
      const res = await api<{ ok: boolean; message: string; latencyMs?: number }>(`/api/providers/${id}`, { method: "POST", json: { action: "test" } });
      setNotice(res.ok ? `✓ ${res.message}${res.latencyMs ? ` (${res.latencyMs}ms)` : ""}` : `✗ ${res.message}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  };

  const fetchModels = async (id: string) => {
    setFetching(id);
    setError(null);
    try {
      const res = await api<{ models: Array<{ id: string }>; count: number }>(`/api/providers/${id}`, { method: "POST", json: { action: "fetch-models" } });
      setModelsFor({ id, list: res.models });
      setNotice(`Found ${res.count} models. Pick a default below.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(null);
    }
  };

  const saveModelConfig = async () => {
    if (!editModel) return;
    try {
      await api(`/api/providers/${editModel.id}`, {
        method: "PATCH",
        json: { defaultModel: editModel.model, fallbackModels: editModel.fallbacks.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      setEditModel(null);
      setNotice("Model configuration saved.");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Providers</h2>
          <p className="text-sm text-slate-400">Connect cloud APIs and local models. The assistant routes between them — swap providers anytime without rebuilding.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-400">
          <Plus size={16} /> Add provider
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>}

      {showAdd && (
        <div className="animate-slide-up space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="font-semibold">Add provider</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-400">Display name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. My OpenAI, Home Ollama" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm">
                {Object.entries(TYPE_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-400">{TYPE_INFO[form.type].hint}</p>
          <label className="block">
            <span className="text-xs text-slate-400">Base URL (endpoint)</span>
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={TYPE_INFO[form.type].basePlaceholder} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" />
          </label>
          {TYPE_INFO[form.type].needsKey && (
            <label className="block">
              <span className="flex items-center gap-1 text-xs text-slate-400"><KeyRound size={12} /> API key (stored encrypted, never displayed again)</span>
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-…" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-slate-400">Default model (optional — can fetch after adding)</span>
            <input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} placeholder="e.g. gpt-4o-mini, claude-sonnet-4-5, llama3.1" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" />
          </label>
          <div className="flex gap-2">
            <button onClick={addProvider} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white">Add</button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {providers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
          <Plug size={28} className="mx-auto text-slate-500" />
          <p className="mt-2 font-semibold">No providers yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            Add a cloud API key (OpenAI, Anthropic, Google, xAI) or connect a local Ollama server.
            Without any provider the assistant cannot generate responses — but your data stays local regardless.
          </p>
          <div className="mx-auto mt-3 max-w-md rounded-xl bg-black/30 p-3 text-left font-mono text-xs text-slate-300">
            # Local setup (Ollama)<br />
            ollama serve<br />
            ollama pull llama3.1
          </div>
        </div>
      )}

      {providers.map((p) => (
        <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xl">{p.isLocal ? "🖥️" : "☁️"}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-300">{TYPE_INFO[p.type]?.label || p.type}</span>
                <StatusBadge p={p} />
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                {p.baseUrl} · default: {p.defaultModel || <span className="text-amber-300">none set</span>} · {p.hasApiKey ? "🔑 key stored" : "no key"}
              </div>
              {p.statusMessage && <div className="mt-0.5 text-xs text-slate-400">{p.statusMessage}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => test(p.id)} disabled={testing === p.id} className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs hover:bg-white/10">
                {testing === p.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Test
              </button>
              <button onClick={() => fetchModels(p.id)} disabled={fetching === p.id} className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs hover:bg-white/10">
                {fetching === p.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Models
              </button>
              <button
                onClick={() => { setExpanded(expanded === p.id ? null : p.id); setEditModel({ id: p.id, model: p.defaultModel || "", fallbacks: (p.fallbackModels || []).join(", ") }); }}
                className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs hover:bg-white/10"
              >
                <ChevronDown size={13} /> Configure
              </button>
              <button
                onClick={async () => { await api(`/api/providers/${p.id}`, { method: "PATCH", json: { enabled: !p.enabled } }); load(); onChanged(); }}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${p.enabled ? "border-white/15 hover:bg-white/10" : "border-amber-500/50 text-amber-200"}`}
                title={p.enabled ? "Disable" : "Enable"}
              >
                <Power size={13} /> {p.enabled ? "On" : "Off"}
              </button>
              <button
                onClick={async () => { if (confirm(`Remove provider "${p.name}"?`)) { await api(`/api/providers/${p.id}`, { method: "DELETE" }); load(); onChanged(); } }}
                className="rounded-lg border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10"
                title="Remove"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {expanded === p.id && editModel && (
            <div className="mt-3 space-y-2 rounded-xl bg-black/30 p-3">
              <label className="block">
                <span className="text-xs text-slate-400">Default model</span>
                <input value={editModel.model} onChange={(e) => setEditModel({ ...editModel, model: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" placeholder="model id" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Fallback models (comma-separated, same provider)</span>
                <input value={editModel.fallbacks} onChange={(e) => setEditModel({ ...editModel, fallbacks: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" placeholder="model-b, model-c" />
              </label>
              <RotateKeyForm id={p.id} hasKey={p.hasApiKey} onDone={() => { load(); setNotice("API key updated."); }} />
              <div className="flex gap-2">
                <button onClick={saveModelConfig} className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-bold text-white">Save</button>
                <button onClick={() => setExpanded(null)} className="rounded-lg border border-white/15 px-4 py-1.5 text-sm">Close</button>
              </div>
            </div>
          )}

          {modelsFor?.id === p.id && (
            <div className="mt-3 max-h-48 overflow-auto rounded-xl bg-black/30 p-2">
              <div className="px-2 py-1 text-xs text-slate-400">{modelsFor.list.length} models — click to set as default:</div>
              <div className="flex flex-wrap gap-1.5 p-1">
                {modelsFor.list.slice(0, 100).map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => { await api(`/api/providers/${p.id}`, { method: "PATCH", json: { defaultModel: m.id } }); setModelsFor(null); load(); onChanged(); setNotice(`Default model set to ${m.id}`); }}
                    className={`rounded-lg border px-2 py-1 font-mono text-xs ${p.defaultModel === m.id ? "border-indigo-500 bg-indigo-500/20 text-indigo-200" : "border-white/10 hover:bg-white/10"}`}
                  >
                    {m.id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">How routing uses providers:</span> Auto mode scores providers per task (capability, local preference, availability).
        If the primary fails, the router walks your fallback models, then other providers. Ask mode confirms before each use. Manual mode pins your choice per conversation.
        Privacy Mode restricts everything to local (🖥️) providers.
      </div>
    </div>
  );
}

function RotateKeyForm({ id, hasKey, onDone }: { id: string; hasKey: boolean; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-end gap-2">
      <label className="block flex-1">
        <span className="text-xs text-slate-400">{hasKey ? "Replace API key" : "Set API key"} (never displayed after save)</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste new key" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" />
      </label>
      <button
        disabled={!key.trim() || saving}
        onClick={async () => { setSaving(true); await api(`/api/providers/${id}`, { method: "PATCH", json: { apiKey: key.trim() } }); setKey(""); setSaving(false); onDone(); }}
        className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15 disabled:opacity-40"
      >
        {saving ? "…" : "Save key"}
      </button>
      {hasKey && (
        <button
          onClick={async () => { if (confirm("Remove stored API key?")) { await api(`/api/providers/${id}`, { method: "PATCH", json: { clearKey: true } }); onDone(); } }}
          className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function ConnectorsPanel({ refreshKey }: { refreshKey: number }) {
  const [connectors, setConnectors] = useState<Array<{ id: string; type: string; name: string; config: Record<string, unknown>; enabled: boolean; hasSecrets: boolean }>>([]);
  const [form, setForm] = useState({ type: "search_tavily", name: "", apiKey: "", baseUrl: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api<{ connectors: typeof connectors }>("/api/connectors");
      setConnectors(data.connectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { load(); }, [refreshKey]);

  const add = async () => {
    try {
      await api("/api/connectors", { method: "POST", json: { type: form.type, name: form.name || form.type, apiKey: form.apiKey, config: { baseUrl: form.baseUrl } } });
      setShowAdd(false);
      setForm({ type: "search_tavily", name: "", apiKey: "", baseUrl: "" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Connectors</h2>
          <p className="text-sm text-slate-400">Search providers and external services. Web search works out-of-the-box (free providers); add API keys for higher quality.</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white">
          <Plus size={16} /> Add
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {showAdd && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-400">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm">
                <option value="search_tavily">Search — Tavily</option>
                <option value="search_brave">Search — Brave</option>
                <option value="search_serper">Search — Serper (Google)</option>
                <option value="search_searxng">Search — SearXNG (self-hosted)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm" placeholder="e.g. Tavily prod" />
            </label>
          </div>
          {form.type === "search_searxng" ? (
            <label className="block">
              <span className="text-xs text-slate-400">SearXNG base URL</span>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" placeholder="http://localhost:8080" />
            </label>
          ) : (
            <label className="block">
              <span className="text-xs text-slate-400">API key (encrypted)</span>
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm" />
            </label>
          )}
          <div className="flex gap-2">
            <button onClick={add} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white">Add</button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
        <div className="font-semibold">Built-in (no configuration needed)</div>
        <div className="mt-1 text-slate-400">DuckDuckGo + Wikipedia search with real citations. Email, calendar, GitHub, and cloud-storage connectors are planned — the connector framework is ready.</div>
      </div>
      {connectors.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex-1">
            <div className="font-semibold">{c.name}</div>
            <div className="font-mono text-xs text-slate-400">{c.type} · {c.hasSecrets ? "🔑 key stored" : (c.config as { baseUrl?: string })?.baseUrl || "no key"}</div>
          </div>
          <button onClick={async () => { await api("/api/connectors", { method: "PATCH", json: { id: c.id, enabled: !c.enabled } }); load(); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">
            {c.enabled ? "Enabled" : "Disabled"}
          </button>
          <button onClick={async () => { if (confirm("Remove connector?")) { await api(`/api/connectors?id=${c.id}`, { method: "DELETE" }); load(); } }} className="rounded-lg border border-red-500/30 p-1.5 text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {connectors.length === 0 && <div className="text-center text-sm text-slate-500">No optional connectors configured — free search is active.</div>}
    </div>
  );
}
