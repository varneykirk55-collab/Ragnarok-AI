import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuntimeCoreInstructions,
  formatRuntimeDateAnswer,
  getRuntimeDateTime,
  getRuntimeTimeZone,
  isRuntimeDateQuestion,
} from "../src/lib/context/runtime.ts";

test("runtime clock date is dynamic and formats against the configured timezone", () => {
  const beforeMidnight = getRuntimeDateTime(new Date("2026-10-09T23:30:00.000Z"), "UTC");
  const afterMidnight = getRuntimeDateTime(new Date("2026-10-10T00:30:00.000Z"), "UTC");
  assert.equal(beforeMidnight.isoDate, "2026-10-09");
  assert.equal(afterMidnight.isoDate, "2026-10-10");
  assert.equal(beforeMidnight.timeZone, "UTC");
});

test("explicit non-UTC timezone is applied consistently and invalid configuration falls back to UTC", () => {
  const instant = new Date("2026-10-10T00:30:00.000Z");
  const pacific = getRuntimeDateTime(instant, "America/Los_Angeles");
  assert.equal(pacific.isoDate, "2026-10-09");
  assert.equal(pacific.time, "17:30:00");
  assert.equal(getRuntimeTimeZone("Not/A_Timezone"), "UTC");
});

test("date and year questions are recognized as runtime-clock requests, not research", () => {
  for (const question of [
    "What is today's date?",
    "What's the current date?",
    "What year is it currently?",
    "What date is it today?",
    "Please tell me what time is it now.",
  ]) {
    assert.equal(isRuntimeDateQuestion(question), true, question);
  }
  assert.equal(isRuntimeDateQuestion("Search the web for today's White House news."), false);
  assert.equal(isRuntimeDateQuestion("What year was this 2024 article published?"), false);
});

test("direct clock answer and system authority use a live runtime date rather than a constant", () => {
  const previous = process.env.RAGNAROK_TIME_ZONE;
  process.env.RAGNAROK_TIME_ZONE = "UTC";
  try {
    const instant = new Date("2026-10-09T23:33:00.000Z");
    assert.match(formatRuntimeDateAnswer(instant), /Friday, October 9, 2026 \(2026-10-09, UTC\)/);
    const instructions = buildRuntimeCoreInstructions(instant);
    assert.match(instructions, /2026-10-09/);
    assert.match(instructions, /Historical facts, publication\/update dates, search snippets/);
    assert.match(instructions, /You are Ragnarok/);
    assert.match(instructions, /never adopt their identity/);
  } finally {
    if (previous === undefined) delete process.env.RAGNAROK_TIME_ZONE;
    else process.env.RAGNAROK_TIME_ZONE = previous;
  }
});
