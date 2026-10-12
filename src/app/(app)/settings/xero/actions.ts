"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, t } from "@/db";
import { getEntityContext, requireAdmin } from "@/lib/dal";
import { deleteConnection, accessToken } from "@/lib/xero/client";
import { highestInvoiceNumber, invoiceSequence, renumberDrafts } from "@/lib/invoicing/renumber";
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

/** Sets the next invoice number (e.g. 1760 → INV-1760). Can't go back onto a number already used. */
export async function setNextInvoiceNumber(next: number): Promise<XeroActionResult> {
  try {
    const user = await requireAdmin();
    const { entity } = await getEntityContext();
    const seq = await invoiceSequence(entity.id);
    if (!seq) return { error: `${entity.id} invoices use the sales order number.` };
    if (!Number.isInteger(next) || next < 1) return { error: "Enter a whole number, e.g. 1760." };
    const highest = await highestInvoiceNumber(entity.id, seq.prefix);
    if (next <= highest) return { error: `${seq.prefix}${highest} has already been used; the next number must be ${highest + 1} or more.` };
    await db
      .update(t.numberSequences)
      .set({ nextValue: next })
      .where(and(eq(t.numberSequences.entityId, entity.id), eq(t.numberSequences.kind, "INV")));
    await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "number_sequences", recordId: `${entity.id}/INV`, action: "set_next", changes: { from: seq.next, to: next } });
    revalidatePath("/settings/xero");
    return { ok: `The next invoice will be ${seq.prefix}${next}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

/** Gives Xero drafts still numbered with the SO number the next invoice numbers (changes them in Xero). */
export async function renumberXeroDrafts(): Promise<XeroActionResult> {
  try {
    await requireAdmin();
    const { entity } = await getEntityContext();
    const r = await renumberDrafts(entity.id);
    revalidatePath("/settings/xero");
    revalidatePath("/sell/invoicing");
    const parts = [r.done.length ? `Renumbered: ${r.done.join(", ")}.` : "Nothing to renumber.", r.skipped.length ? `Left as they were (no longer drafts): ${r.skipped.join(", ")}.` : ""];
    return { ok: parts.filter(Boolean).join(" ") };
  } catch (e) {
    revalidatePath("/settings/xero");
    return { error: `${e instanceof Error ? e.message : "Couldn't renumber."} Any invoices renumbered before this point keep their new numbers.` };
  }
}
