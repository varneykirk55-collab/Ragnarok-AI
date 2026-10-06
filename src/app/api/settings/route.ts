import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings } from "@/lib/server-settings";
import { normalizeVoicePreferences, type ReasoningDepth, type WebAccessMode } from "@/lib/voice/config";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const allowed = [
      "routingMode", "privacyMode", "defaultCapabilityModels", "budgetDailyUsd", "budgetMonthlyUsd",
      "requireApprovalOverUsd", "memoryEnabled", "memoryAutoCapture", "contextRecentMessages",
      "contextMaxChars", "agentMaxSteps", "agentMaxRetries", "appearanceTheme", "workspaceRoot", "onboardingDone",
      "reasoningDepth", "webAccess", "voicePreferences", "sidebarFlagEnabled",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    if (body.reasoningDepth !== undefined) {
      if (!["auto", "fast", "balanced", "deep", "maximum"].includes(body.reasoningDepth as ReasoningDepth)) {
        return NextResponse.json({ error: "Invalid reasoning depth." }, { status: 400 });
      }
    }
    if (body.webAccess !== undefined) {
      if (!["auto", "on", "off"].includes(body.webAccess as WebAccessMode)) {
        return NextResponse.json({ error: "Invalid web access mode." }, { status: 400 });
      }
    }
    if (body.voicePreferences !== undefined) patch.voicePreferences = normalizeVoicePreferences(body.voicePreferences);
    const settings = await setSettings(patch);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
