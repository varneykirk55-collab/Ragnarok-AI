import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings } from "@/lib/server-settings";

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
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    const settings = await setSettings(patch);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
