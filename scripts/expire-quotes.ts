/**
 * Marks open (draft/sent) quotes older than N days as expired, in every entity. Logged in audit_log.
 *   npm run db:expire-quotes -- 365          # local
 *   npm run db:expire-quotes:prod -- 365     # Supabase
 */
import "./env";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { auditLog, salesOrders } from "../src/db/schema";

const days = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 365);

async function main() {
  const db = createDb();
  const expired = await db
    .update(salesOrders)
    .set({ quoteStatus: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(salesOrders.status, "quote"),
        inArray(salesOrders.quoteStatus, ["draft", "sent"]),
        lt(salesOrders.orderDate, sql`current_date - ${days}::int`),
      ),
    )
    .returning({ id: salesOrders.id, entityId: salesOrders.entityId, number: salesOrders.number, orderDate: salesOrders.orderDate });
  if (expired.length)
    await db.insert(auditLog).values(
      expired.map((q) => ({
        entityId: q.entityId,
        tableName: "sales_orders",
        recordId: q.id,
        action: "expire_quote",
        changes: { quoteStatus: { from: "sent", to: "expired" }, reason: `Older than ${days} days (bulk expiry)` },
      })),
    );
  const byEntity = Object.groupBy(expired, (q) => q.entityId);
  for (const [entity, list] of Object.entries(byEntity)) {
    const dates = list!.map((q) => q.orderDate).sort();
    console.log(`${entity}: ${list!.length} quotes expired (created ${dates[0]} to ${dates.at(-1)})`);
  }
  if (!expired.length) console.log("No open quotes older than", days, "days.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
