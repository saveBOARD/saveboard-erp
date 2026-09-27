import { defineConfig } from "drizzle-kit";

// Only used to generate SQL migrations from src/db/schema.ts (`npm run db:generate`).
// Migrations are applied by `npm run db:migrate`, which works for both local PGlite and Supabase.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
