import type { CapabilityCategory, ResolvedProvider } from "../providers/types";
import { listResolvedProviders, listStoredModels } from "../providers/manager";
import { getSettings } from "../server-settings";
import { log } from "../logger";
import type { ReasoningDepth } from "../voice/config";

// ---------- Task classification (rule + heuristic layer, extensible) ----------

export interface Classification {
  capability: CapabilityCategory;
  confidence: number;
  needsWeb: boolean;
  needsTools: boolean;
  reasons: string[];
}

const PATTERNS: Array<{ capability: CapabilityCategory; re: RegExp; weight: number; needsWeb?: boolean; needsTools?: boolean }> = [
  { capability: "image_generation", re: /\b(generate|create|make|draw|paint)\b[^.]{0,80}\b(image|picture|photo|illustration|logo|artwork|poster|wallpaper)\b/i, weight: 0.95 },
  { capability: "image_generation", re: /\b(text[- ]to[- ]image|dall-?e|midjourney|stable diffusion|imagen)\b/i, weight: 0.9 },
  { capability: "video", re: /\b(generate|create|make)\b[^.]{0,60}\b(video|animation|clip|footage)\b/i, weight: 0.9 },
  { capability: "audio", re: /\b(text[- ]to[- ]speech|voiceover|transcribe|speech[- ]to[- ]text|generate.*audio|podcast voice)\b/i, weight: 0.9 },
  { capability: "factcheck", re: /\b(fact[- ]?check|verify (this )?claim|is (this|it|that) (true|false)|debunk|misinformation)\b/i, weight: 0.9, needsWeb: true },
  { capability: "research", re: /\b(research|latest|current|news|today'?s|this week|price of|compare (products|prices|options)|market (analysis|overview)|sources|cite|search (the )?web|look up online|find online|browse (the )?web)\b/i, weight: 0.75, needsWeb: true },
  { capability: "coding", re: /\b(code|function|class|bug|debug|refactor|compile|typescript|python|javascript|rust|go\b|sql|api endpoint|pull request|stack trace|error:|npm|docker|git)\b/i, weight: 0.7, needsTools: true },
  { capability: "coding", re: /```[\s\S]{10,}|def |function\s+\w+\(|const\s+\w+\s*=|import\s+[\w{]/, weight: 0.8, needsTools: true },
  { capability: "data_analysis", re: /\b(analyze|analyse) (this )?(data|csv|spreadsheet|dataset|table)|pandas|chart|plot|regression|statistics\b/i, weight: 0.85, needsTools: true },
  { capability: "file_processing", re: /\b(read|open|parse|summariz(e|e this)|extract from)\b[^.]{0,60}\b(file|pdf|docx|csv|xlsx|document|attachment)\b/i, weight: 0.85, needsTools: true },
  { capability: "document_creation", re: /\b(write|draft|create)\b[^.]{0,60}\b(report|essay|memo|proposal|letter|resume|cover letter|contract|spreadsheet|presentation|slides)\b/i, weight: 0.7 },
  { capability: "image_understanding", re: /\b(what'?s in this image|describe this (image|picture|screenshot)|analyze (this )?(image|photo|screenshot))\b/i, weight: 0.9 },
  { capability: "browser", re: /\b(browse|open|visit|navigate to|click|fill (out|in)|scrape) (this )?(website|web ?page|url|link|site)\b/i, weight: 0.8, needsTools: true },
  { capability: "api_action", re: /\b(call (this )?api|webhook|rest (endpoint|api)|graphql|send (a )?request to)\b/i, weight: 0.85, needsTools: true },
  { capability: "automation", re: /\b(every (morning|day|hour|week)|schedule|monitor|alert me when|periodically|automatically|watch (this|the))\b/i, weight: 0.85, needsTools: true },
  { capability: "agent_task", re: /\b(do this autonomously|handle this end[- ]to[- ]end|multi[- ]step|break (this )?down|plan and execute|research.*(and|then).*(create|save|summariz))\b/i, weight: 0.8, needsTools: true },
  { capability: "reasoning", re: /\b(prove|theorem|logic puzzle|step[- ]by[- ]step reasoning|think (carefully|deeply)|complex (problem|decision)|trade[- ]?off analysis)\b/i, weight: 0.7 },
];

const FRESHNESS_PATTERNS = [
  /\b(today|yesterday|this week|this month|latest|current|recent|breaking|just (announced|released|happened)|right now|as of now)\b/i,
  /\b(20\d{2}|price|stock price|exchange rate|weather|election|score|release date|version \d)\b/i,
  /\b(who won|what happened|is .* (open|closed|available|down))\b/i,
];

export function classifyTask(text: string, opts?: { hasAttachments?: boolean; hasImages?: boolean; agentMode?: boolean }): Classification {
  const reasons: string[] = [];
  let best: CapabilityCategory = "conversation";
  let bestScore = 0.35;
  let needsWeb = false;
  let needsTools = false;

  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      if (p.weight > bestScore) {
        bestScore = p.weight;
        best = p.capability;
      }
      if (p.needsWeb) needsWeb = true;
      if (p.needsTools) needsTools = true;
      reasons.push(`matched ${p.capability} pattern`);
    }
  }
  // Freshness detection → research
  for (const re of FRESHNESS_PATTERNS) {
    if (re.test(text)) {
      needsWeb = true;
      reasons.push("freshness-sensitive content detected");
      if (best === "conversation") {
        best = "research";
        bestScore = Math.max(bestScore, 0.7);
      }
      break;
    }
  }
  if (opts?.hasImages) {
    best = "image_understanding";
    bestScore = 0.9;
    reasons.push("image attachment present");
  } else if (opts?.hasAttachments && best === "conversation") {
    best = "file_processing";
    bestScore = 0.75;
    needsTools = true;
    reasons.push("file attachment present");
  }
  if (opts?.agentMode && (needsTools || best !== "conversation")) {
    if (!["image_generation", "video", "audio"].includes(best)) {
      reasons.push("agent mode requested");
    }
  }
  if (/\b(search the web|look up online|find online|browse the web)\b/i.test(text)) {
    needsWeb = true;
    needsTools = true;
    reasons.push("explicit live-web request");
    if (best === "conversation") best = "research";
  }
  return { capability: best, confidence: Math.min(0.99, bestScore), needsWeb, needsTools, reasons };
}

export function resolveReasoningDepth(requested: ReasoningDepth | undefined, text: string): ReasoningDepth {
  if (requested && requested !== "auto") return requested;
  const normalized = text.trim();
  const complex = /\b(prove|derive|debug|refactor|architecture|trade[- ]?off|root cause|multi[- ]step|step[- ]by[- ]step|comprehensive|evaluate|design|plan|analy[sz]e|compare|research|strategy|mathematical|optimi[sz]e|security review)\b/i.test(normalized)
    || /```[\s\S]{30,}/.test(normalized)
    || (normalized.match(/\b(and|then|also|because|however|versus|vs\.)\b/gi)?.length ?? 0) >= 4
    || normalized.length > 1200;
  if (complex) return "deep";
  if (normalized.length < 180 && /^(what is|who is|where is|when is|define|translate|convert|how many|what does)\b/i.test(normalized)) return "fast";
  return "balanced";
}

// ---------- Model selection ----------

export interface RouteDecision {
  provider: ResolvedProvider;
  model: string;
  capability: CapabilityCategory;
  confidence: number;
  mode: "auto" | "ask" | "manual";
  reasoningDepth: ReasoningDepth;
  needsApproval: boolean;
  approvalQuestion?: string;
  candidates: Array<{ providerId: string; providerName: string; model: string; score: number; reason: string }>;
  fallbackChain: Array<{ providerId: string; model: string }>;
}

function scoreProvider(
  p: ResolvedProvider,
  capability: CapabilityCategory,
  prefs: { privacyMode: boolean; reasoningDepth: ReasoningDepth; agentMode: boolean; needsWeb: boolean; estimatedContextTokens: number; modelContextWindow: number }
): { score: number; reason: string } {
  let score = 50;
  const parts: string[] = [];
  if (!p.enabled) return { score: -1000, reason: "disabled" };
  if (prefs.privacyMode && !p.isLocal) return { score: -1000, reason: "excluded by privacy mode (cloud)" };
  if (p.isLocal) {
    score += prefs.privacyMode ? 30 : 8;
    parts.push("local");
  }
  // Assigned capabilities boost
  // (stored on provider row but resolved object lacks it; we approximate via default model presence)
  if (p.defaultModel) {
    score += 5;
  }
  // Capability-specific heuristics on model name
  const m = (p.defaultModel || "").toLowerCase();
  if (prefs.modelContextWindow > 0) {
    const contextRatio = prefs.estimatedContextTokens / prefs.modelContextWindow;
    if (contextRatio > 0.9) { score -= 80; parts.push("context-window-risk"); }
    else if (contextRatio > 0.7) { score -= 18; parts.push("limited-context-headroom"); }
    else if (prefs.estimatedContextTokens > 8192) {
      const headroomBonus = Math.min(10, Math.floor((0.7 - contextRatio) * 15));
      if (headroomBonus > 0) { score += headroomBonus; parts.push("context-headroom"); }
    }
  }
  if (capability === "coding" && /(code|coder|deepseek|sonnet|opus|o1|o3|gpt-4|claude)/.test(m)) { score += 12; parts.push("code-suited"); }
  if (capability === "reasoning" && /(o1|o3|opus|sonnet|reason|deepseek-r1|qwen.*max|gemini.*pro)/.test(m)) { score += 12; parts.push("reasoning-suited"); }
  if (capability === "research" && /(sonnet|gpt-4|gemini|grok|perplexity)/.test(m)) { score += 8; parts.push("research-suited"); }
  if ((capability === "image_understanding") && /(vision|4o|sonnet|gemini|llava|qwen.*vl)/.test(m)) { score += 15; parts.push("vision-capable"); }
  if (capability === "conversation" && p.isLocal) { score += 6; parts.push("fast-local"); }
  // Prefer cloud for heavy reasoning unless privacy mode
  if (!prefs.privacyMode && !p.isLocal && ["reasoning", "coding", "research", "agent_task"].includes(capability)) {
    score += 6;
    parts.push("cloud-scale");
  }
  if (prefs.reasoningDepth === "fast") {
    if (p.isLocal || /mini|flash|haiku|small|instant|turbo/i.test(m)) { score += 12; parts.push("speed-and-cost"); }
    if (/opus|o1|o3|deepseek-r1|gemini.*pro/i.test(m)) score -= 8;
  } else if (["deep", "maximum"].includes(prefs.reasoningDepth)) {
    if (/opus|sonnet|o[134]|gpt-5|deepseek-r1|qwen.*max|gemini.*pro/i.test(m)) {
      score += prefs.reasoningDepth === "maximum" ? 20 : 14;
      parts.push("high-reasoning-capability");
    }
    if (/mini|flash|haiku|small|instant/i.test(m)) score -= prefs.reasoningDepth === "maximum" ? 8 : 4;
  }
  if (prefs.needsWeb && /(sonnet|gpt-4|gpt-5|gemini|grok|perplexity|deepseek)/i.test(m)) {
    score += 5;
    parts.push("research-capable");
  }
  if (prefs.agentMode && /(tool|instruct|sonnet|gpt-4|gpt-5|gemini|qwen)/i.test(m)) score += 3;
  return { score, reason: parts.join(",") || "general" };
}

export async function routeRequest(input: {
  text: string;
  mode?: "auto" | "ask" | "manual";
  manualProviderId?: string;
  manualModel?: string;
  privacyMode?: boolean;
  agentMode?: boolean;
  hasAttachments?: boolean;
  hasImages?: boolean;
  reasoningDepth?: ReasoningDepth;
  estimatedContextTokens?: number;
}): Promise<RouteDecision> {
  const settings = await getSettings();
  const mode = input.mode ?? settings.routingMode ?? "auto";
  const privacyMode = input.privacyMode ?? settings.privacyMode ?? false;
  const requestedDepth = input.reasoningDepth ?? settings.reasoningDepth ?? "auto";
  const reasoningDepth = resolveReasoningDepth(requestedDepth, input.text);
  const classification = classifyTask(input.text, {
    hasAttachments: input.hasAttachments,
    hasImages: input.hasImages,
    agentMode: input.agentMode,
  });

  const [allProviders, storedModels] = await Promise.all([
    listResolvedProviders({ enabledOnly: true }),
    listStoredModels().catch(() => []),
  ]);
  const estimatedContextTokens = Math.max(1, input.estimatedContextTokens ?? Math.ceil(input.text.length / 4) + 4096);
  const eligible = privacyMode ? allProviders.filter((p) => p.isLocal) : allProviders;

  if (!eligible.length) {
    await log("error", "router", "No eligible providers", { privacyMode });
    throw new Error(
      privacyMode
        ? "Privacy Mode is on but no enabled local providers exist. Add Ollama or an OpenAI-compatible local server in Providers settings."
        : "No enabled providers. Add a provider in Providers settings (cloud API key or local Ollama)."
    );
  }

  // Manual mode: honor explicit choice
  if (mode === "manual") {
    const manualId = input.manualProviderId || (settings.defaultCapabilityModels[classification.capability]?.providerId ?? "");
    const manualModel = input.manualModel || settings.defaultCapabilityModels[classification.capability]?.model || "";
    const found = eligible.find((p) => p.id === manualId) ?? eligible[0];
    if (privacyMode && !found.isLocal) throw new Error("Manual selection violates Privacy Mode (not a local provider).");
    const model = manualModel || found.defaultModel;
    if (!model) throw new Error(`Provider "${found.name}" has no model selected. Set a default model in Providers settings.`);
    const fallbackChain = buildFallbackChain(found, model, eligible);
    return {
      provider: found,
      model,
      capability: classification.capability,
      confidence: classification.confidence,
      mode,
      reasoningDepth,
      needsApproval: false,
      candidates: [],
      fallbackChain,
    };
  }

  // Check user default for this capability first
  const pref = settings.defaultCapabilityModels[classification.capability];
  let chosen: ResolvedProvider | undefined;
  let chosenModel = "";
  if (pref?.providerId) {
    const p = eligible.find((x) => x.id === pref.providerId);
    if (p) {
      chosen = p;
      chosenModel = pref.model || p.defaultModel;
    }
  }

  // Score all providers
  const scored = eligible
    .map((p) => ({
      p,
      ...scoreProvider(p, classification.capability, {
        privacyMode,
        reasoningDepth,
        agentMode: Boolean(input.agentMode),
        needsWeb: classification.needsWeb,
        estimatedContextTokens,
        modelContextWindow: Number(storedModels.find((model) => model.providerId === p.id && model.modelId === p.defaultModel)?.contextWindow || 0),
      }),
    }))
    .filter((s) => s.score > -1000)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) throw new Error("No suitable provider available for this request.");

  if (!chosen) {
    chosen = scored[0].p;
    chosenModel = chosen.defaultModel;
    // If provider has no default model, we cannot use it — try next
    for (const s of scored) {
      if (s.p.defaultModel) {
        chosen = s.p;
        chosenModel = s.p.defaultModel;
        break;
      }
    }
  }
  if (!chosenModel) {
    throw new Error(`Provider "${chosen.name}" has no default model configured. Open Providers settings and fetch/select a model.`);
  }

  const candidates = scored.slice(0, 5).map((s) => ({
    providerId: s.p.id,
    providerName: s.p.name,
    model: s.p.defaultModel || "(no default)",
    score: s.score,
    reason: s.reason,
  }));
  const fallbackChain = buildFallbackChain(chosen, chosenModel, eligible);

  await log("info", "router", `Routed ${classification.capability} → ${chosen.name}/${chosenModel}`, {
    mode,
    confidence: classification.confidence,
  });

  if (mode === "ask") {
    return {
      provider: chosen,
      model: chosenModel,
      capability: classification.capability,
      confidence: classification.confidence,
      mode,
      reasoningDepth,
      needsApproval: true,
      approvalQuestion: `This task looks like **${classification.capability}** (confidence ${Math.round(classification.confidence * 100)}%). I suggest **${chosen.name} / ${chosenModel}**. Use it?`,
      candidates,
      fallbackChain,
    };
  }

  return {
    provider: chosen,
    model: chosenModel,
    capability: classification.capability,
    confidence: classification.confidence,
    mode,
    reasoningDepth,
    needsApproval: false,
    candidates,
    fallbackChain,
  };
}

function buildFallbackChain(
  primary: ResolvedProvider,
  primaryModel: string,
  eligible: ResolvedProvider[]
): Array<{ providerId: string; model: string }> {
  const chain: Array<{ providerId: string; model: string }> = [];
  // 1. Provider's own fallback models
  for (const m of primary.fallbackModels ?? []) {
    if (m && m !== primaryModel) chain.push({ providerId: primary.id, model: m });
  }
  // 2. Other providers' defaults
  for (const p of eligible) {
    if (p.id === primary.id) continue;
    if (p.defaultModel) chain.push({ providerId: p.id, model: p.defaultModel });
  }
  return chain.slice(0, 6);
}
