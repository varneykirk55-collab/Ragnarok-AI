// TEST HARNESS ONLY — a fake OpenAI-compatible server used to verify
// routing, streaming, fallback, tool-calling, and the agent loop without
// spending API money. Not part of the app; not started automatically.
import http from "node:http";

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-gpt" }, { id: "mock-gpt-fallback" }] }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      if (j.model === "bad-model" || j.model === "mock-gpt-bad") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "model not found: " + j.model } }));
        return;
      }
      const msgs = j.messages || [];
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      const toolMsgs = msgs.filter((m) => m.role === "tool");
      const userText = (lastUser?.content || "").slice(0, 500);

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      const streamText = (text) => {
        const parts = [text.slice(0, 10), text.slice(10, 30), text.slice(30)];
        for (const p of parts) {
          if (p) send({ choices: [{ delta: { content: p }, finish_reason: null }] });
        }
        send({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
        res.write("data: [DONE]\n\n");
        res.end();
      };
      const streamTool = (id, name, args) => {
        const argStr = JSON.stringify(args);
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: argStr.slice(0, 20) } }] }, finish_reason: null }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argStr.slice(20) } }] }, finish_reason: null }] });
        send({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 60, completion_tokens: 30 } });
        res.write("data: [DONE]\n\n");
        res.end();
      };

      if (toolMsgs.length > 0) {
        const lastTool = toolMsgs[toolMsgs.length - 1].content || "";
        if (/agent-proof|GOAL:/s.test(msgs.map((m) => m.content).join("\n"))) {
          streamText("TASK_COMPLETE: Created agent-proof.md via write_file. Tool result confirmed: " + lastTool.slice(0, 120));
        } else {
          streamText(`Done. Tool said: ${lastTool.slice(0, 200)}`);
        }
        return;
      }
      if (/calculate|6\s*\*\s*7/i.test(userText)) {
        streamTool("call_1", "run_code", { language: "python", code: "print(6*7)" });
        return;
      }
      if (/GOAL:|agent-proof/i.test(msgs.map((m) => m.content).join("\n"))) {
        streamTool("call_a1", "write_file", { path: "agent-proof.md", content: "# Agent proof\n\nThe agent loop works.\n" });
        return;
      }
      streamText(`Mock reply to: "${userText.slice(0, 100)}" — streaming works.`);
    });
    return;
  }
  res.writeHead(404);
  res.end("nope");
});

server.listen(3200, () => console.log("mock llm on 3200"));
