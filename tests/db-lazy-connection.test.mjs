import assert from "node:assert/strict";
import test from "node:test";

test("importing the db module without DATABASE_URL does not throw (next build / Docker)", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { db } = await import("../src/db/index.ts");
    assert.throws(() => db.select, /DATABASE_URL is required/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});
