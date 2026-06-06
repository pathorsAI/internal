import { defineConfig } from "drizzle-kit";

// Introspection-only config. We never generate/migrate/push from this app —
// the Neon schema is owned by the DBA. Run `pnpm db:pull` to reflect it.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
