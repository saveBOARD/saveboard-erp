"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { assertEntityAccess, getEntityContext, requireAdmin } from "@/lib/dal";
import { type ImportResult, importKatanaCustomers, parseKatanaCustomers } from "@/lib/imports/katana-customers";

const MAX_BYTES = 4 * 1024 * 1024;

/** Preview (apply=false) or apply a Katana customer export to the current entity's customers. Admins only. */
export async function runCustomerImport(formData: FormData): Promise<{ result?: ImportResult; error?: string }> {
  const admin = await requireAdmin();
  const { entity } = await getEntityContext();
  const entityId = String(formData.get("entityId") ?? "");
  // The page was opened for one entity; refuse if the user has since switched to the other one.
  if (entityId !== entity.id) return { error: `You've switched to ${entity.id} since opening this page. Reload the page and try again.` };
  await assertEntityAccess(admin.id, entityId);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the Katana customer export (.xlsx) first." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "That isn't an Excel .xlsx file." };
  if (file.size > MAX_BYTES) return { error: "That file is over 4 MB — is it the right one?" };
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const katana = parseKatanaCustomers(wb);
    if (!katana.length) return { error: "No customers found in that file." };
    const apply = formData.get("apply") === "1";
    const result = await importKatanaCustomers(db, entityId, katana, { apply, userId: admin.id });
    if (apply) revalidatePath("/sell/customers", "layout");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The import failed." };
  }
}
