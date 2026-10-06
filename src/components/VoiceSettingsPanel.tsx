"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioLines, Check, Info, Mic, Play, Plus, Save, Trash2, Volume2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { DEFAULT_VOICE_PREFERENCES, normalizeVoicePreferences, type VoicePreferences, type VoiceProfile } from "@/lib/voice/config";

function installedVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export function VoiceSettingsPanel() {
  const [preferences, setPreferences] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [addVoiceUri, setAddVoiceUri] = useState("");
  const [newVoiceName, setNewVoiceName] = useState("");
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await api<{ settings: { voicePreferences?: unknown } }>("/api/settings");
      setPreferences(normalizeVoicePreferences(result.settings.voicePreferences));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const refreshVoices = () => setVoices(installedVoices());
    const timer = window.setTimeout(() => {
      void load();
      setRecognitionSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
      refreshVoices();
    }, 0);
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);
    // Some browsers populate voice lists shortly after first paint.
    const voiceTimer = window.setTimeout(refreshVoices, 500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(voiceTimer);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refreshVoices);
      window.speechSynthesis?.cancel();
    };
  }, [load]);

  const save = async (next: VoicePreferences, success = "Voice settings saved.") => {
    setError("");
    setPreferences(next);
    try {
      const result = await api<{ settings: { voicePreferences: unknown } }>("/api/settings", {
        method: "PATCH",
        json: { voicePreferences: next },
      });
      setPreferences(normalizeVoicePreferences(result.settings.voicePreferences));
      setNotice(success);
      window.setTimeout(() => setNotice(""), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    }
  };

  const savedUris = useMemo(() => new Set(preferences.profiles.map((p) => p.voiceURI)), [preferences.profiles]);
  const availableToAdd = voices.filter((v) => !savedUris.has(v.voiceURI));
  const defaultProfile = preferences.profiles.find((p) => p.id === preferences.defaultVoiceId);

  const addVoice = () => {
    const voice = voices.find((v) => v.voiceURI === addVoiceUri);
    if (!voice) return;
    const id = `browser:${voice.voiceURI}`.slice(0, 290);
    const profile: VoiceProfile = {
      id,
      provider: "browser",
      name: (newVoiceName.trim() || voice.name).slice(0, 100),
      voiceURI: voice.voiceURI,
      voiceName: voice.name,
      lang: voice.lang || "en-US",
      rate: 1,
      pitch: 1,
    };
    void save({ ...preferences, profiles: [...preferences.profiles, profile] }, `${profile.name} added to your voice library.`);
    setAddVoiceUri("");
    setNewVoiceName("");
  };

  const preview = (profile?: VoiceProfile) => {
    if (!window.speechSynthesis) {
      setError("Speech synthesis is not available in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("Hello. I am Ragnarok. This is a preview of the selected voice.");
    const installed = voices.find((v) => v.voiceURI === profile?.voiceURI);
    if (installed) utterance.voice = installed;
    if (profile) {
      utterance.lang = profile.lang;
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitch;
    }
    utterance.onstart = () => setPreviewing(profile?.id ?? "system");
    utterance.onend = () => setPreviewing(null);
    utterance.onerror = () => setPreviewing(null);
    window.speechSynthesis.speak(utterance);
  };

  const setDefault = (id: string) => {
    const profile = preferences.profiles.find((p) => p.id === id);
    void save({ ...preferences, defaultVoiceId: id }, id ? `${profile?.name ?? "Voice"} is now the default voice.` : "Browser default voice selected.");
  };

  if (loading) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">Loading voice settings…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-400/10 p-2 text-sky-200"><AudioLines size={18} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Ragnarok voice</h3>
            <p className="mt-1 text-sm text-slate-400">Voice output is provided by the browser and installed operating-system voices. It is independent from your AI model selection.</p>
          </div>
        </div>
        {error && <div role="alert" className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        {notice && <div role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Voice mode</span>
            <select
              value={preferences.mode}
              onChange={(e) => void save({ ...preferences, mode: e.target.value as VoicePreferences["mode"] })}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm"
            >
              <option value="push_to_talk">Push to Talk</option>
              <option value="continuous">Continuous conversation</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Default voice</span>
            <select value={preferences.defaultVoiceId} onChange={(e) => setDefault(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm">
              <option value="">Browser default voice</option>
              {preferences.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name} · {profile.lang}</option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-slate-500">Current default: {defaultProfile?.name ?? "Browser default"} · Provider: Browser speech synthesis</span>
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Available browser voices</div>
              <div className="text-xs text-slate-500">{voices.length ? `${voices.length} installed voice${voices.length === 1 ? "" : "s"} detected on this device.` : "No installed voices detected yet. Browser voices may appear after a short delay."}</div>
            </div>
            <button onClick={() => preview(defaultProfile)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/10">
              <Play size={13} /> {previewing ? "Previewing…" : "Preview default"}
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select value={addVoiceUri} onChange={(e) => { setAddVoiceUri(e.target.value); const v = voices.find((voice) => voice.voiceURI === e.target.value); setNewVoiceName(v?.name ?? ""); }} className="min-w-0 rounded-lg border border-white/15 bg-[#090b0f] px-3 py-2 text-sm" aria-label="Choose an installed voice to add">
              <option value="">Add an installed voice…</option>
              {availableToAdd.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}{voice.default ? " · system default" : ""}</option>)}
            </select>
            <input value={newVoiceName} onChange={(e) => setNewVoiceName(e.target.value)} maxLength={100} placeholder="Optional custom name" className="min-w-0 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm" aria-label="Name this voice configuration" />
            <button onClick={addVoice} disabled={!addVoiceUri} className="inline-flex items-center justify-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40">
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {preferences.profiles.map((profile) => {
            const installed = voices.some((v) => v.voiceURI === profile.voiceURI);
            const draftName = nameDrafts[profile.id] ?? profile.name;
            return (
              <div key={profile.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="max-w-full truncate font-medium">{profile.name}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">Browser</span>
                      {!installed && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">Not installed here</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{profile.voiceName} · {profile.lang} · {profile.voiceURI}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => preview(profile)} disabled={!installed} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40" title="Preview this voice"><Volume2 size={13} /> Test</button>
                    <button onClick={() => setDefault(profile.id)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${preferences.defaultVoiceId === profile.id ? "border-emerald-500/40 text-emerald-200" : "border-white/15 hover:bg-white/10"}`} title="Set as Ragnarok's default voice">
                      {preferences.defaultVoiceId === profile.id ? <Check size={13} /> : null}{preferences.defaultVoiceId === profile.id ? "Default" : "Set default"}
                    </button>
                    <button onClick={() => { if (confirm(`Remove “${profile.name}” from your voice library?`)) void save({ ...preferences, profiles: preferences.profiles.filter((p) => p.id !== profile.id), defaultVoiceId: preferences.defaultVoiceId === profile.id ? "" : preferences.defaultVoiceId }, `${profile.name} removed.`); }} className="rounded-lg border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10" title="Remove voice configuration"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input value={draftName} onChange={(e) => setNameDrafts((current) => ({ ...current, [profile.id]: e.target.value }))} maxLength={100} className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm" aria-label={`Rename ${profile.name}`} />
                  <button onClick={() => void save({ ...preferences, profiles: preferences.profiles.map((p) => p.id === profile.id ? { ...p, name: (draftName.trim() || p.voiceName).slice(0, 100) } : p) }, "Voice name updated.")} disabled={draftName.trim() === profile.name} className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-40"><Save size={13} /> Save name</button>
                </div>
              </div>
            );
          })}
          {!preferences.profiles.length && <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-sm text-slate-500">No saved voices yet. Add one of the voices installed in this browser to create a persistent voice configuration.</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center gap-2 font-semibold"><Mic size={16} className="text-sky-200" /> Hands-free & wake word</div>
        <p className="mt-1 text-sm text-slate-400">Wake-word listening runs only after you explicitly start it from the chat voice controls. Keep Ragnarok open in a foreground browser tab; browsers may suspend microphone recognition in the background.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Wake Word Detection</div>
            <div className="text-xs text-slate-500">The name is detected by browser speech recognition while the chat voice session is armed.</div>
          </div>
          <button type="button" aria-pressed={preferences.wakeWordEnabled} onClick={() => void save({ ...preferences, wakeWordEnabled: !preferences.wakeWordEnabled }, `Wake word detection ${preferences.wakeWordEnabled ? "disabled" : "enabled"}.`)} className={`rounded-lg border px-4 py-2 text-sm font-bold ${preferences.wakeWordEnabled ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/15 text-slate-300"}`}>
            {preferences.wakeWordEnabled ? "ON · armed in chat" : "OFF"}
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="text-xs font-medium text-slate-400">Wake phrase</span>
            <select value={preferences.wakePhrase} disabled={!preferences.wakeWordEnabled} onChange={(e) => void save({ ...preferences, wakePhrase: e.target.value as VoicePreferences["wakePhrase"] })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm disabled:opacity-50">
              <option value="ragnarok">“Ragnarok” (also recognizes “Hey Ragnarok”)</option>
              <option value="hey-ragnarok">“Hey Ragnarok”</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-medium text-slate-400">Conversation timeout</span>
            <select value={preferences.conversationTimeoutSeconds} onChange={(e) => void save({ ...preferences, conversationTimeoutSeconds: Number(e.target.value) as VoicePreferences["conversationTimeoutSeconds"] })} className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm">
              <option value={0}>Immediately return to wake standby</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={-1}>Remain active until manually ended</option>
            </select>
          </label>
        </div>
        <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-400/5 p-3 text-xs leading-relaxed text-slate-300">
          <div className="flex items-start gap-2"><Info size={15} className="mt-0.5 shrink-0 text-sky-200" /><span>
            {recognitionSupported
              ? "Speech recognition is available in this browser. The browser/OS recognition provider may process microphone audio according to its own privacy policy; Ragnarok does not store raw audio. Microphone use is always shown in the chat and requires browser permission."
              : "This browser does not expose the Web Speech Recognition API. Voice input and wake-word detection cannot run here; use a current supported browser such as Chrome or Edge. Voice output remains available if speech synthesis is installed."}
          </span></div>
        </div>
      </div>
    </div>
  );
}
