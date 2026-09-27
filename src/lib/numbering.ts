import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { t } from "@/db";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Takes the next document number (e.g. "SO-1586") for an entity. Runs inside the caller's transaction, and the
 * single UPDATE … RETURNING means two people saving at once can never get the same number.
 */
export async function takeNumber(tx: Tx, entityId: string, kind: "SO" | "PO" | "MO" | "SA" | "STK" | "RET") {
  // Kinds Katana never had (returns) start at 1 the first time they're used.
  if (kind === "RET") await tx.insert(t.numberSequences).values({ entityId, kind, prefix: `${kind}-`, nextValue: 1 }).onConflictDoNothing();
  const [row] = await tx
    .update(t.numberSequences)
    .set({ nextValue: sql`${t.numberSequences.nextValue} + 1` })
    .where(and(eq(t.numberSequences.entityId, entityId), eq(t.numberSequences.kind, kind)))
    .returning({ prefix: t.numberSequences.prefix, taken: sql<number>`${t.numberSequences.nextValue} - 1` });
  if (!row) throw new Error(`No ${kind} number sequence for ${entityId}`);
  return `${row.prefix}${row.taken}`;
}
