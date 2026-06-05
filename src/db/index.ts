import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

// `schema.ts` is reflected from the DB via `pnpm db:pull`; `auth-schema.ts` is
// hand-maintained for better-auth. Merge both so query helpers and the
// better-auth drizzle adapter share one client.
const fullSchema = { ...schema, ...authSchema };

// Lazily created so the app builds even when DATABASE_URL is absent.
let _db: ReturnType<typeof drizzle<typeof fullSchema>> | null = null;

export function getDb() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  _db = drizzle(neon(connectionString), { schema: fullSchema });
  return _db;
}
