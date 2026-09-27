/**
 * Loads environment for the db:* scripts.
 *   default  -> .env.local              (local PGlite database)
 *   --prod   -> .env.production.local   (Supabase; DATABASE_URL required)
 */
import { config } from "dotenv";

export const isProd = process.argv.includes("--prod");

config({ path: isProd ? ".env.production.local" : ".env.local", quiet: true });
config({ quiet: true });

if (isProd && !process.env.DATABASE_URL) {
  console.error("--prod needs DATABASE_URL in .env.production.local (the Supabase transaction pooler connection string).");
  process.exit(1);
}
console.log(isProd ? `Target: Supabase (${new URL(process.env.DATABASE_URL!).host})` : "Target: local database (.data/pglite)");
