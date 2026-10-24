import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Use the same DATABASE_URL as the app (from the environment or .env) so
// `drizzle-kit push` creates tables in the database Ragnarok actually reads.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://nexus:nexus@127.0.0.1:5432/nexus",
  },
});
