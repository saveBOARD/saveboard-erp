import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const sql = postgres(url, { prepare: false, max: 1 });
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    await sql.end();
    console.log("Migrated Postgres at", new URL(url).host);
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite("./.data/pglite");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    await client.close();
    console.log("Migrated local PGlite database (.data/pglite)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
