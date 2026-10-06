"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Headphones, Mic, MicOff, Pause, Play, Radio, Square, VolumeX, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { DEFAULT_VOICE_PREFERENCES, normalizeVoicePreferences, type VoicePreferences, type VoiceProfile } from "@/lib/voice/config";

type VoiceState = "idle" | "listening" | "wake-standby" | "processing" | "speaking" | "muted" | "error";
type SessionMode = "push" | "continuous" | "wake";

interface RecognitionAlternativeLike { transcript: string }
interface RecognitionResultLike extends ArrayLike<RecognitionAlternativeLike> { isFinal: boolean }
interface RecognitionEventLike { resultIndex: number; results: ArrayLike<RecognitionResultLike> }
interface RecognitionErrorLike { error: string; message?: string }
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function cleanForSpeech(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*|__|\*|_|~~/g, "")
    .replace(/\[(\d+)\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wakeQuery(transcript: string, phrase: VoicePreferences["wakePhrase"]): { heard: boolean; query: string } {
  const re = phrase === "hey-ragnarok" ? /\bhey\s+ragnarok\b/i : /\b(?:hey\s+)?ragnarok\b/i;
  const match = re.exec(transcript);
  if (!match) return { heard: false, query: "" };
  return { heard: true, query: transcript.slice(match.index + match[0].length).replace(/^[\s,.:;!?-]+/, "").trim() };
}

export function VoiceControls({
  onVoiceRequest,
  onStopResponse,
  busy,
}: {
  onVoiceRequest: (text: string) => Promise<string>;
  onStopResponse: () => void;
  busy: boolean;
}) {
  const [preferences, setPreferences] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionMode | null>(null);
  const preferencesRef = useRef(preferences);
  const stateRef = useRef<VoiceState>(state);
  const sessionRef = useRef<SessionMode | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const mutedRef = useRef(false);
  const conversationOpenRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const finalizeRef = useRef<number | null>(null);
  const restartRef = useRef<number | null>(null);
  const activationRef = useRef<number | null>(null);
  const onRequestRef = useRef(onVoiceRequest);
  const onStopRef = useRef(onStopResponse);
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    onRequestRef.current = onVoiceRequest;
    onStopRef.current = onStopResponse;
  }, [onVoiceRequest, onStopResponse]);

  const updateState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) window.clearTimeout(ref.current);
    ref.current = null;
  };

  const loadPreferences = useCallback(async () => {
    try {
      const result = await api<{ settings: { voicePreferences?: unknown } }>("/api/settings");
      const next = normalizeVoicePreferences(result.settings.voicePreferences);
      preferencesRef.current = next;
      setPreferences(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function scheduleRecognitionRestart() {
    clearTimer(restartRef);
    if (!sessionRef.current || mutedRef.current || requestInFlightRef.current) return;
    const currentState = stateRef.current;
    if (currentState !== "listening" && currentState !== "wake-standby") return;
    restartRef.current = window.setTimeout(() => {
      restartRef.current = null;
      startRecognition();
    }, 300);
  }

  function openListeningAfterTurn() {
    if (!sessionRef.current || mutedRef.current) {
      updateState(mutedRef.current ? "muted" : "idle");
      return;
    }
    if (sessionRef.current === "continuous") {
      updateState("listening");
      startRecognition();
      return;
    }
    if (sessionRef.current === "wake") {
      const seconds = preferencesRef.current.conversationTimeoutSeconds;
      if (seconds === 0) {
        conversationOpenRef.current = false;
        updateState("wake-standby");
      } else {
        conversationOpenRef.current = true;
        updateState("listening");
      }
      startRecognition();
      if (seconds > 0) {
        clearTimer(timeoutRef);
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          if (sessionRef.current === "wake") {
            conversationOpenRef.current = false;
            updateState("wake-standby");
          }
        }, seconds * 1000);
      }
      return;
    }
    sessionRef.current = null;
    setActiveSession(null);
    updateState("idle");
  }

  const speak = useCallback(async (text: string) => {
    const spoken = cleanForSpeech(text);
    if (!spoken) return;
    if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setError("Speech output is not available in this browser. The response is still available as text.");
      return;
    }
    window.speechSynthesis.cancel();
    const profile = preferencesRef.current.profiles.find((p) => p.id === preferencesRef.current.defaultVoiceId);
    const utterance = new SpeechSynthesisUtterance(spoken);
    const available = window.speechSynthesis.getVoices();
    const selectedVoice = profile ? available.find((v) => v.voiceURI === profile.voiceURI) : undefined;
    if (selectedVoice) utterance.voice = selectedVoice;
    if (profile) {
      utterance.lang = profile.lang;
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitch;
    }
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      utterance.onstart = () => updateState("speaking");
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });
  }, [updateState]);

  async function finalizeTranscript() {
    clearTimer(finalizeRef);
    setInterim("");
    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    if (!text || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    clearTimer(timeoutRef);
    clearTimer(activationRef);
    conversationOpenRef.current = true;
    updateState("processing");
    recognitionRef.current?.stop();
    setError("");
    try {
      const answer = await onRequestRef.current(text);
      if (answer.trim()) {
        await speak(answer);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      requestInFlightRef.current = false;
      openListeningAfterTurn();
    }
  }

  function startRecognition() {
    const mode = sessionRef.current;
    if (!mode || mutedRef.current || requestInFlightRef.current || recognitionRef.current) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError("Voice input is not supported in this browser. Use a current Chrome- or Edge-based browser, or continue by typing.");
      updateState("error");
      sessionRef.current = null;
      setActiveSession(null);
      return;
    }
    try {
      const recognition = new Constructor();
      recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
      recognition.continuous = mode !== "push";
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
      updateState(mode === "wake" && !conversationOpenRef.current ? "wake-standby" : "listening");
      recognition.onresult = (event) => {
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript?.trim();
          if (!text) continue;
          if (result.isFinal) finalParts.push(text);
          else interimParts.push(text);
        }
        setInterim(interimParts.join(" "));
        const finalText = finalParts.join(" ").trim();
        if (!finalText) return;

        let acceptedText = finalText;
        if (mode === "wake" && !conversationOpenRef.current) {
          const wake = wakeQuery(finalText, preferencesRef.current.wakePhrase);
          if (!wake.heard) return;
          conversationOpenRef.current = true;
          updateState("listening");
          acceptedText = wake.query;
          if (!acceptedText) {
            clearTimer(activationRef);
            activationRef.current = window.setTimeout(() => {
              activationRef.current = null;
              if (sessionRef.current === "wake" && !transcriptRef.current) {
                conversationOpenRef.current = false;
                updateState("wake-standby");
              }
            }, 12000);
            return;
          }
        }
        transcriptRef.current = `${transcriptRef.current} ${acceptedText}`.trim();
        if (mode === "wake" && conversationOpenRef.current) updateState("listening");
        clearTimer(finalizeRef);
        finalizeRef.current = window.setTimeout(() => { void finalizeTranscript(); }, mode === "push" ? 500 : 850);
      };
      recognition.onerror = (event) => {
        const reason = event.error || "unknown";
        if (reason === "no-speech" || reason === "aborted") return;
        if (reason === "not-allowed" || reason === "service-not-allowed") {
          setError("Microphone or speech recognition permission was denied. Allow microphone access in your browser settings, then resume voice mode.");
          sessionRef.current = null;
          setActiveSession(null);
          updateState("error");
        } else {
          setError(`Speech recognition error: ${reason}.`);
          updateState("error");
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (!finalizeRef.current && !requestInFlightRef.current) scheduleRecognitionRestart();
      };
      recognition.start();
      setError("");
    } catch (e) {
      recognitionRef.current = null;
      setError(e instanceof Error ? e.message : "Could not start speech recognition. Check microphone permission.");
      updateState("error");
      sessionRef.current = null;
      setActiveSession(null);
    }
  }

  const beginSession = (mode: SessionMode) => {
    if (busy) return;
    setError("");
    clearTimer(timeoutRef);
    clearTimer(activationRef);
    clearTimer(restartRef);
    window.speechSynthesis?.cancel();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    transcriptRef.current = "";
    conversationOpenRef.current = mode !== "wake";
    mutedRef.current = false;
    sessionRef.current = mode;
    setActiveSession(mode);
    updateState(mode === "wake" ? "wake-standby" : "listening");
    startRecognition();
  };

  const endSession = () => {
    clearTimer(timeoutRef);
    clearTimer(finalizeRef);
    clearTimer(restartRef);
    clearTimer(activationRef);
    mutedRef.current = false;
    conversationOpenRef.current = false;
    transcriptRef.current = "";
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
    sessionRef.current = null;
    setActiveSession(null);
    setInterim("");
    updateState("idle");
  };

  const toggleMute = () => {
    if (!sessionRef.current) return;
    if (mutedRef.current) {
      mutedRef.current = false;
      updateState(sessionRef.current === "wake" && !conversationOpenRef.current ? "wake-standby" : "listening");
      startRecognition();
    } else {
      mutedRef.current = true;
      clearTimer(restartRef);
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setInterim("");
      updateState("muted");
    }
  };

  const startMainVoice = () => {
    if (stateRef.current === "speaking") {
      window.speechSynthesis?.cancel();
      updateState(sessionRef.current === "wake" && !conversationOpenRef.current ? "wake-standby" : "listening");
      if (!sessionRef.current) sessionRef.current = preferencesRef.current.mode === "continuous" ? "continuous" : "push";
      if (sessionRef.current === "push") setActiveSession("push");
      startRecognition();
      return;
    }
    if (stateRef.current === "processing" || busy) {
      onStopRef.current();
      return;
    }
    if (sessionRef.current === "push" && stateRef.current === "listening") {
      endSession();
      return;
    }
    if (sessionRef.current === "continuous" || sessionRef.current === "wake") {
      toggleMute();
      return;
    }
    beginSession(preferencesRef.current.mode === "continuous" ? "continuous" : "push");
  };

  const startWake = () => {
    if (!preferencesRef.current.wakeWordEnabled) return;
    beginSession("wake");
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupported(Boolean(recognitionConstructor()));
      void loadPreferences();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      sessionRef.current = null;
      clearTimer(timeoutRef);
      clearTimer(finalizeRef);
      clearTimer(restartRef);
      clearTimer(activationRef);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      window.speechSynthesis?.cancel();
    };
  }, [loadPreferences]);

  const isMicActive = state === "listening" || state === "wake-standby";
  const stateText: Record<VoiceState, string> = {
    idle: "Voice idle",
    listening: "Listening · microphone active",
    "wake-standby": "Wake-word standby · microphone active",
    processing: "Processing speech",
    speaking: "Ragnarok is speaking",
    muted: "Microphone muted",
    error: "Voice unavailable",
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-2.5 py-2" aria-label="Voice conversation controls">
      <button
        type="button"
        onClick={startMainVoice}
        disabled={!supported && !busy}
        aria-label={state === "listening" || state === "wake-standby" ? "Mute or stop microphone" : state === "speaking" ? "Interrupt Ragnarok and listen" : state === "processing" || busy ? "Stop response" : preferences.mode === "continuous" ? "Start continuous voice conversation" : "Start push-to-talk"}
        title={!supported ? "Speech recognition is not supported by this browser" : "Start or control voice input"}
        className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${isMicActive ? "bg-red-500/20 text-red-200 ring-1 ring-red-400/40" : state === "speaking" ? "bg-amber-500/15 text-amber-100" : "bg-sky-500/15 text-sky-100 hover:bg-sky-500/25"}`}
      >
        {isMicActive ? <MicOff size={16} /> : state === "speaking" ? <AudioLines size={16} /> : state === "processing" || busy ? <Square size={14} /> : <Mic size={16} />}
        {isMicActive ? "Mute / stop" : state === "speaking" ? "Interrupt" : state === "processing" || busy ? "Stop response" : preferences.mode === "continuous" ? "Start voice" : "Push to Talk"}
      </button>

      {preferences.mode !== "continuous" && (
        <button type="button" onClick={() => activeSession === "continuous" ? endSession() : beginSession("continuous")} disabled={!supported || busy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40" title="Listen after every spoken reply until you end the session">
          {activeSession === "continuous" ? <Square size={13} /> : <Headphones size={14} />}{activeSession === "continuous" ? "End continuous" : "Continuous"}
        </button>
      )}

      {preferences.wakeWordEnabled && (
        <button type="button" onClick={() => activeSession === "wake" ? endSession() : startWake()} disabled={!supported || busy} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-40 ${activeSession === "wake" ? "border-sky-400/40 bg-sky-400/10 text-sky-100" : "border-white/15 text-slate-200 hover:bg-white/10"}`} title="Keep the foreground chat tab listening for the configured wake phrase">
          <Radio size={14} />{activeSession === "wake" ? "Wake listening on" : "Wake word"}
        </button>
      )}

      {activeSession && activeSession !== "push" && (
        <button type="button" onClick={toggleMute} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10" title={state === "muted" ? "Resume microphone" : "Mute microphone while keeping voice mode ready"}>
          {state === "muted" ? <Play size={13} /> : <Pause size={13} />}{state === "muted" ? "Resume" : "Mute mic"}
        </button>
      )}

      {state === "speaking" && (
        <button type="button" onClick={() => { window.speechSynthesis?.cancel(); openListeningAfterTurn(); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-400/30 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-500/10" title="Stop spoken audio and listen for an interruption"><VolumeX size={14} /> Stop speaking</button>
      )}
      {activeSession && (
        <button type="button" onClick={endSession} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-300 hover:bg-white/10" title="Exit voice conversation"><X size={14} /> Exit</button>
      )}

      <div className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-[11px] text-slate-300" role="status" aria-live="polite">
        <span className={`h-2 w-2 rounded-full ${state === "error" ? "bg-red-400" : isMicActive ? "animate-pulse bg-red-400" : state === "processing" ? "animate-pulse bg-amber-300" : state === "speaking" ? "animate-pulse bg-sky-300" : "bg-slate-500"}`} />
        {stateText[state]}
      </div>
      {interim && <span className="max-w-full truncate text-[11px] italic text-slate-400" aria-live="polite">“{interim}”</span>}
      {error && <span role="alert" className="w-full text-xs text-amber-200">{error}</span>}
      {!supported && <span className="w-full text-[11px] text-slate-500">Voice input requires a browser that supports Web Speech Recognition.</span>}
      {activeSession === "wake" && <span className="w-full text-[11px] text-slate-500">Say {preferences.wakePhrase === "hey-ragnarok" ? "“Hey Ragnarok”" : "“Ragnarok”"}; microphone is active only while this voice session remains on.</span>}
    </div>
  );
}
