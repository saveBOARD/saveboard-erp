import "server-only";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { XERO_SETTINGS, type XeroSettings } from "@/lib/invoicing/xero";

/** How this entity's invoices are coded in Xero: the choice saved in Settings → Xero, else the defaults. */
export async function entityXeroSettings(entityId: string): Promise<XeroSettings & { chosen: boolean }> {
  const [e] = await db
    .select({ account: t.entities.xeroAccountCode, income: t.entities.xeroTaxIncome, zero: t.entities.xeroTaxZero })
    .from(t.entities)
    .where(eq(t.entities.id, entityId));
  const d = XERO_SETTINGS[entityId];
  return {
    accountCode: e?.account || d.accountCode,
    taxOnIncome: e?.income || d.taxOnIncome,
    taxZeroRated: e?.zero || d.taxZeroRated,
    chosen: !!(e?.account || e?.income || e?.zero),
  };
}
