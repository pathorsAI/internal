import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// Read-only / passive connection to the shared Neon database.
// Schema is owned by the DBA and reflected via `pnpm db:pull` into ./schema.
// Lazily created so the app builds even when DATABASE_URL is absent.
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  _db = drizzle(neon(connectionString), { schema });
  return _db;
}
