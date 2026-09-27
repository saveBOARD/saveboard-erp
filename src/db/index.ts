import "server-only";
import { createDb } from "./client";

// One connection pool per server instance (reused across hot reloads in dev).
const globalForDb = globalThis as unknown as { db?: ReturnType<typeof createDb> };
export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

export * as t from "./schema";
