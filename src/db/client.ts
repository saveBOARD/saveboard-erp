import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzlePostgres<typeof schema>>;

/**
 * DATABASE_URL set (Supabase, staging, production) -> real Postgres.
 * Not set (local development) -> PGlite, an embedded Postgres stored in ./.data/pglite.
 */
export function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (url) {
    // prepare:false is required by Supabase's transaction-mode connection pooler.
    return drizzlePostgres(postgres(url, { prepare: false, max: 5 }), { schema });
  }
  mkdirSync("./.data", { recursive: true });
  return drizzlePglite(new PGlite("./.data/pglite"), { schema }) as unknown as Db;
}
