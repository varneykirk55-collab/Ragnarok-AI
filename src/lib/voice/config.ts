export type ReasoningDepth = "auto" | "fast" | "balanced" | "deep" | "maximum";
export type WebAccessMode = "auto" | "on" | "off";
export type VoiceMode = "push_to_talk" | "continuous";
export type WakePhrase = "ragnarok" | "hey-ragnarok";

export interface VoiceProfile {
  id: string;
  provider: "browser";
  name: string;
  voiceURI: string;
  voiceName: string;
  lang: string;
  rate: number;
  pitch: number;
}

export interface VoicePreferences {
  mode: VoiceMode;
  profiles: VoiceProfile[];
  defaultVoiceId: string;
  wakeWordEnabled: boolean;
  wakePhrase: WakePhrase;
  conversationTimeoutSeconds: 0 | 15 | 30 | 60 | -1;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  mode: "push_to_talk",
  profiles: [],
  defaultVoiceId: "",
  wakeWordEnabled: false,
  wakePhrase: "ragnarok",
  conversationTimeoutSeconds: 30,
};

export function normalizeVoicePreferences(value: unknown): VoicePreferences {
  const raw = value && typeof value === "object" ? value as Partial<VoicePreferences> : {};
  const allowedTimeouts = [0, 15, 30, 60, -1] as const;
  const profiles = Array.isArray(raw.profiles) ? raw.profiles
    .filter((p): p is VoiceProfile => Boolean(p && typeof p === "object" && typeof p.id === "string" && typeof p.voiceURI === "string" && typeof p.voiceName === "string"))
    .slice(0, 100)
    .map((p) => ({
      id: p.id.slice(0, 300),
      provider: "browser" as const,
      name: (typeof p.name === "string" ? p.name : p.voiceName).slice(0, 100),
      voiceURI: p.voiceURI.slice(0, 500),
      voiceName: p.voiceName.slice(0, 200),
      lang: (typeof p.lang === "string" ? p.lang : "en-US").slice(0, 40),
      rate: Number.isFinite(Number(p.rate)) ? Math.min(2, Math.max(0.5, Number(p.rate))) : 1,
      pitch: Number.isFinite(Number(p.pitch)) ? Math.min(2, Math.max(0, Number(p.pitch))) : 1,
    })) : [];
  const requestedTimeout = Number(raw.conversationTimeoutSeconds);
  const timeout = allowedTimeouts.includes(requestedTimeout as typeof allowedTimeouts[number])
    ? requestedTimeout as VoicePreferences["conversationTimeoutSeconds"]
    : DEFAULT_VOICE_PREFERENCES.conversationTimeoutSeconds;
  const requestedDefault = typeof raw.defaultVoiceId === "string" ? raw.defaultVoiceId.slice(0, 300) : "";

  return {
    mode: raw.mode === "continuous" ? "continuous" : "push_to_talk",
    profiles,
    defaultVoiceId: profiles.some((p) => p.id === requestedDefault) ? requestedDefault : "",
    wakeWordEnabled: raw.wakeWordEnabled === true,
    wakePhrase: raw.wakePhrase === "hey-ragnarok" ? "hey-ragnarok" : "ragnarok",
    conversationTimeoutSeconds: timeout,
  };
}

export function reasoningInstruction(depth: ReasoningDepth): string {
  switch (depth) {
    case "fast":
      return "Reasoning effort: FAST. Prefer a direct, concise solution for straightforward requests. Avoid unnecessary tool calls and expansive analysis; still check important facts and calculations.";
    case "balanced":
      return "Reasoning effort: BALANCED. Use proportionate analysis for ordinary tasks, checking assumptions and likely edge cases. Provide a concise rationale, not private chain-of-thought.";
    case "deep":
      return "Reasoning effort: DEEP. Spend additional effort on multi-step analysis, coding, research, mathematics, planning, and trade-offs. Validate key assumptions and results. Give conclusions and a useful summary of rationale, not private chain-of-thought.";
    case "maximum":
      return "Reasoning effort: MAXIMUM. Use the strongest practical reasoning, tools, context, and verification available for this request. Take time to check difficult steps and uncertainty. Do not disclose private chain-of-thought; give conclusions and a concise, auditable rationale.";
    case "auto":
    default:
      return "Reasoning effort: AUTO. Select effort proportionate to task complexity: use a fast path for simple questions and more careful multi-step work for difficult analysis, coding, research, mathematics, or decisions. Do not disclose private chain-of-thought.";
  }
}
