"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, t } from "@/db";
import { getEntityContext, requireAdmin } from "@/lib/dal";
import { deleteConnection, accessToken } from "@/lib/xero/client";
import { xeroCodingOptions } from "@/lib/xero/coding";
import { refreshFromXero, xeroSettingsCheck } from "@/lib/xero/sync";

export type XeroActionResult = { ok?: string; error?: string };

/** Disconnects the current entity from Xero (and tells Xero to drop the connection). */
export async function disconnectXero(): Promise<XeroActionResult> {
  try {
    const user = await requireAdmin();
    const { entity } = await getEntityContext();
    const [c] = await db.select().from(t.xeroConnections).where(eq(t.xeroConnections.entityId, entity.id));
    if (!c) return { ok: "Not connected." };
    try {
      const { token } = await accessToken(entity.id);
      await deleteConnection(token, c.connectionId);
    } catch {
      // Already revoked on Xero's side: just forget it here.
    }
    await db.delete(t.xeroConnections).where(eq(t.xeroConnections.entityId, entity.id));
    await db.insert(t.xeroSyncLog).values({ entityId: entity.id, kind: "connect", ok: true, message: `Disconnected from ${c.tenantName}`, userId: user.id });
    await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "xero_connections", recordId: entity.id, action: "disconnect", changes: { org: c.tenantName } });
    revalidatePath("/settings/xero");
    return { ok: `Disconnected from ${c.tenantName}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't disconnect." };
  }
}

/** Checks the account code and tax rates the app uses exist in the connected organisation. */
export async function checkXero(): Promise<XeroActionResult> {
  try {
    await requireAdmin();
    const { entity } = await getEntityContext();
    const s = await xeroSettingsCheck(entity.id);
    const problems = [
      !s.account && `account ${s.names.accountCode} not found`,
      !s.taxOnIncome && `tax rate "${s.names.taxOnIncome}" not found`,
      !s.taxZeroRated && `tax rate "${s.names.taxZeroRated}" not found`,
    ].filter(Boolean);
    return problems.length
      ? { error: `Xero settings problem: ${problems.join(", ")}.` }
      : { ok: `All good: account ${s.account}; "${s.names.taxOnIncome}" = ${s.taxOnIncome}; "${s.names.taxZeroRated}" = ${s.taxZeroRated}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reach Xero." };
  }
}

/** Reads invoice / credit note status and payments back from Xero now (also runs every morning). */
export async function refreshNow(): Promise<XeroActionResult> {
  try {
    const { user, entity } = await getEntityContext();
    const r = await refreshFromXero(entity.id, user.id);
    revalidatePath("/settings/xero");
    revalidatePath("/sell/invoicing");
    revalidatePath("/sell/orders");
    return { ok: `Checked ${r.checked} documents in Xero; ${r.paid} newly paid (those orders are now Closed).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reach Xero." };
  }
}

/** Saves which sales account and tax rates this entity's invoices and credit notes use in Xero. */
export async function saveXeroCoding(input: { accountCode: string; taxIncome: string; taxZero: string }): Promise<XeroActionResult> {
  try {
    const user = await requireAdmin();
    const { entity } = await getEntityContext();
    const opts = await xeroCodingOptions(entity.id);
    if (!opts.accounts.some((a) => a.code === input.accountCode)) return { error: `Account ${input.accountCode} isn't an active revenue account in Xero.` };
    for (const name of [input.taxIncome, input.taxZero])
      if (!opts.taxRates.some((r) => r.name === name)) return { error: `Tax rate "${name}" isn't an active sales tax rate in Xero.` };
    await db
      .update(t.entities)
      .set({ xeroAccountCode: input.accountCode, xeroTaxIncome: input.taxIncome, xeroTaxZero: input.taxZero })
      .where(eq(t.entities.id, entity.id));
    await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "entities", recordId: entity.id, action: "xero_coding", changes: input });
    revalidatePath("/settings/xero");
    revalidatePath("/sell/invoicing");
    return { ok: `Saved. Invoices now use account ${input.accountCode}, "${input.taxIncome}" and "${input.taxZero}". Use Send to Xero on Sell → Invoicing → Invoiced for any not sent yet.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
}
