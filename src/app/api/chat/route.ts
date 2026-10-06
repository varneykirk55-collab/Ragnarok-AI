import { NextRequest } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { routeRequest } from "@/lib/router/router";
import { chatWithFallback } from "@/lib/llm/chat";
import { buildContext } from "@/lib/context/builder";
import { trackUsage, checkBudget } from "@/lib/usage/tracker";
import { getSettings } from "@/lib/server-settings";
import { parseMemoryCommand, createMemory, forgetMatching } from "@/lib/memory/store";
import { toLLMTools, checkPermission } from "@/lib/tools/registry";
import { executeTool } from "@/lib/tools/registry";
import type { ChatMessage } from "@/lib/providers/types";
import { webSearch } from "@/lib/search/providers";
import { log } from "@/lib/logger";

export const maxDuration = 300;

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const conversationId = body.conversationId as string | undefined;
  const content = (body.content as string) || "";
  const attachments = (body.attachments as Array<Record<string, unknown>>) || [];
  const confirmRoute = body.confirmRoute as { providerId: string; model: string } | undefined;

  if (!conversationId) {
    return new Response(JSON.stringify({ error: "conversationId required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!content.trim() && !attachments.length) {
    return new Response(JSON.stringify({ error: "Empty message" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const convRows = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convRows.length) {
    return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  const conv = convRows[0];
  const settings = await getSettings();

  // Budget guard
  const budget = await checkBudget(settings.budgetDailyUsd, settings.budgetMonthlyUsd);
  if ((budget.dailyExceeded || budget.monthlyExceeded) && !body.overrideBudget) {
    return new Response(
      JSON.stringify({
        error: `Budget limit reached (today $${budget.dayCost.toFixed(2)} / month $${budget.monthCost.toFixed(2)}). Adjust budgets in Settings → Costs or confirm override.`,
        budget,
      }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  // Persist user message
  await db.insert(messages).values({
    conversationId,
    role: "user",
    content: content.slice(0, 50000),
    attachments,
  });
  // Auto-title from first message
  if (conv.title === "New conversation") {
    const title = content.trim().split("\n")[0].slice(0, 60) || "New conversation";
    await db.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  } else {
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  }

  // Memory commands (Remember / Forget) — handled locally without LLM
  const memCmd = parseMemoryCommand(content);
  if (memCmd && settings.memoryEnabled) {
    if (memCmd.action === "remember") {
      const row = await createMemory({
        content: memCmd.payload.slice(0, 2000),
        category: "facts",
        projectId: conv.projectId || undefined,
        source: "user",
      });
      const reply = `Saved to memory (${row.category}): “${memCmd.payload.slice(0, 200)}”. You can view, edit, or delete it in Memory.`;
      await db.insert(messages).values({ conversationId, role: "assistant", content: reply });
      return sseResponse(async function* () {
        yield sseEncode("meta", { provider: "local", model: "memory", capability: "conversation" });
        yield sseEncode("token", { text: reply });
        yield sseEncode("done", { content: reply });
      });
    } else {
      const n = await forgetMatching(memCmd.payload, conv.projectId || undefined);
      const reply = n > 0 ? `Forgot ${n} matching memor${n === 1 ? "y" : "ies"}.` : "I couldn't find a matching memory. Check the Memory manager to review what's stored.";
      await db.insert(messages).values({ conversationId, role: "assistant", content: reply });
      return sseResponse(async function* () {
        yield sseEncode("meta", { provider: "local", model: "memory", capability: "conversation" });
        yield sseEncode("token", { text: reply });
        yield sseEncode("done", { content: reply });
      });
    }
  }

  const hasImages = attachments.some((a) => String(a.kind || a.type || "").includes("image"));

  return sseResponse(async function* () {
    try {
      // ---- Routing ----
      let decision;
      if (confirmRoute) {
        const { getResolvedProvider } = await import("@/lib/providers/manager");
        const p = await getResolvedProvider(confirmRoute.providerId);
        if (!p) throw new Error("Confirmed provider no longer exists.");
        decision = {
          provider: p, model: confirmRoute.model, capability: "conversation" as const,
          confidence: 1, mode: conv.routingMode as "auto" | "ask" | "manual",
          needsApproval: false, candidates: [], fallbackChain: [] as Array<{ providerId: string; model: string }>,
        };
      } else {
        decision = await routeRequest({
          text: content,
          mode: (conv.routingMode as "auto" | "ask" | "manual") || settings.routingMode,
          manualProviderId: conv.selectedProviderId || undefined,
          manualModel: conv.selectedModel || undefined,
          privacyMode: conv.privacyMode,
          hasAttachments: attachments.length > 0,
          hasImages,
        });
      }

      // Ask-me mode: pause and ask user
      if (decision.needsApproval && !confirmRoute) {
        yield sseEncode("ask_route", {
          question: decision.approvalQuestion,
          provider: { id: decision.provider.id, name: decision.provider.name, model: decision.model },
          candidates: decision.candidates,
          capability: decision.capability,
          confidence: decision.confidence,
        });
        yield sseEncode("done", { awaitingRouteConfirm: true });
        return;
      }

      yield sseEncode("meta", {
        provider: decision.provider.name,
        providerId: decision.provider.id,
        model: decision.model,
        capability: decision.capability,
        confidence: decision.confidence,
        privacyMode: conv.privacyMode,
      });

      // ---- Context ----
      const ctx = await buildContext({ conversationId, userText: content });
      const llmMessages: ChatMessage[] = [
        { role: "system", content: ctx.systemPrompt },
        ...ctx.recentMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        {
          role: "user",
          content: attachments.length
            ? `${content}\n\n[Attachments: ${attachments.map((a) => `${a.name} (${a.kind || a.type})`).join(", ")}${hasImages ? " — NOTE: image understanding depends on the selected model's vision capability." : ""}${attachments.filter((a) => a.textContent).map((a) => `\n\n--- ${a.name} ---\n${String(a.textContent).slice(0, 6000)}`).join("")}]`
            : content,
        },
      ];

      // ---- Tool-capable chat loop (max 4 tool rounds in chat mode) ----
      const availableTools = toLLMTools(["search_web", "fetch_webpage", "read_file", "write_file", "create_document", "inspect_repository", "run_code", "recall_memory", "save_memory"]);
      let fullContent = "";
      let totalIn = 0;
      let totalOut = 0;
      const allCitations: Array<Record<string, unknown>> = [];
      const allToolCalls: Array<Record<string, unknown>> = [];
      let aborted = false;

      req.signal.addEventListener("abort", () => { aborted = true; });

      for (let round = 0; round < 4; round++) {
        // True streaming: drain token queue while the LLM call is in flight.
        const pending: string[] = [];
        let settled: { result?: Awaited<ReturnType<typeof chatWithFallback>>; error?: unknown } | null = null;
        const llmPromise = chatWithFallback({
          primary: decision.provider,
          model: decision.model,
          fallbackChain: decision.fallbackChain,
          messages: llmMessages,
          tools: availableTools as unknown as import("@/lib/providers/types").ToolSchema[],
          temperature: 0.7,
          signal: req.signal,
          onToken: (t) => { pending.push(t); },
        }).then(
          (r) => { settled = { result: r }; },
          (e) => { settled = { error: e }; }
        );
        let streamed = "";
        while (!settled) {
          if (pending.length) {
            const chunk = pending.splice(0).join("");
            streamed += chunk;
            fullContent += chunk;
            yield sseEncode("token", { text: chunk });
          }
          await Promise.race([llmPromise, new Promise((r) => setTimeout(r, 15))]);
        }
        if (pending.length) {
          const chunk = pending.splice(0).join("");
          streamed += chunk;
          fullContent += chunk;
          yield sseEncode("token", { text: chunk });
        }
        if ((settled as { error?: unknown }).error) throw (settled as { error: unknown }).error;
        const { result, provider, model } = (settled as { result: Awaited<ReturnType<typeof chatWithFallback>> }).result;
        // Fallback: if adapter didn't stream (non-SSE path), emit full text now
        if (!streamed && result.content) {
          fullContent += result.content;
          yield sseEncode("token", { text: result.content });
        }
        totalIn += result.tokensIn;
        totalOut += result.tokensOut;

        if (!result.toolCalls?.length) {
          await trackUsage({
            providerId: provider.id, providerName: provider.name, model,
            capability: decision.capability, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
            conversationId,
          });
          break;
        }

        // Execute tools (chat mode: only auto-allowed low-risk tools; others explained, not executed)
        llmMessages.push({ role: "assistant", content: result.content || "", toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          allToolCalls.push({ name: call.name, arguments: call.arguments });
          yield sseEncode("tool", { name: call.name, status: "running" });
          const check = await checkPermission(call.name);
          if (check.verdict !== "allow") {
            const note = `Tool "${call.name}" requires approval (${check.verdict}). In chat mode, switch to Agent Mode for approval-driven tool use, or set the tool to Always Allow in Settings → Tools.`;
            llmMessages.push({ role: "tool", content: note, toolCallId: call.id, name: call.name });
            yield sseEncode("tool", { name: call.name, status: "needs_approval", note });
            continue;
          }
          try {
            const res = await executeTool(call.name, call.arguments, {
              conversationId,
              projectId: conv.projectId || undefined,
              privacyMode: conv.privacyMode,
              workspaceRoot: "",
            }, { skipPermissionCheck: true });
            const text = res.ok
              ? `OK: ${res.summary}\n${JSON.stringify(res.output).slice(0, 4000)}`
              : `FAILED: ${res.error || res.summary}`;
            llmMessages.push({ role: "tool", content: text, toolCallId: call.id, name: call.name });
            if (res.citations?.length) {
              for (const c of res.citations) allCitations.push(c as unknown as Record<string, unknown>);
              yield sseEncode("citations", { citations: res.citations });
            }
            yield sseEncode("tool", { name: call.name, status: res.ok ? "done" : "failed", summary: res.summary });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            llmMessages.push({ role: "tool", content: `FAILED: ${msg}`, toolCallId: call.id, name: call.name });
            yield sseEncode("tool", { name: call.name, status: "failed", summary: msg.slice(0, 200) });
          }
        }
        await trackUsage({
          providerId: provider.id, providerName: provider.name, model,
          capability: decision.capability, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
          conversationId,
        });
        if (aborted) break;
        // Continue loop so model can consume tool results
        if (round === 3) {
          fullContent += "\n\n*(Tool iteration limit reached in chat mode. Use Agent Mode for longer multi-step tasks.)*";
          yield sseEncode("token", { text: "\n\n*(Tool iteration limit reached in chat mode. Use Agent Mode for longer multi-step tasks.)*" });
        }
      }

      // Persist assistant message
      const { estimateCost } = await import("@/lib/usage/pricing");
      const { cost } = estimateCost(decision.model, totalIn, totalOut);
      await db.insert(messages).values({
        conversationId,
        role: "assistant",
        content: fullContent,
        providerId: decision.provider.id,
        model: decision.model,
        capability: decision.capability,
        tokensIn: totalIn,
        tokensOut: totalOut,
        costUsd: cost,
        citations: allCitations,
        toolCalls: allToolCalls,
        status: "complete",
      });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      yield sseEncode("done", { content: fullContent, tokensIn: totalIn, tokensOut: totalOut, citations: allCitations });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log("error", "chat", `Chat failed: ${msg.slice(0, 300)}`);
      const friendly = msg.includes("No enabled providers") || msg.includes("Privacy Mode")
        ? `${msg}`
        : `Request failed: ${msg}`;
      try {
        await db.insert(messages).values({ conversationId, role: "assistant", content: `⚠️ ${friendly}`, status: "error", error: msg.slice(0, 1000) });
      } catch { /* ignore */ }
      yield sseEncode("error", { message: friendly });
      yield sseEncode("done", { error: friendly });
    }
  });
}

function sseResponse(gen: () => AsyncGenerator<string>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of gen()) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(sseEncode("error", { message: e instanceof Error ? e.message : String(e) })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
