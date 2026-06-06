import { defineConfig } from "drizzle-kit";

// Introspection-only config. This app never generates/migrates/pushes schema —
// the database is the source of truth. Run `bun run db:pull` to reflect it.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
