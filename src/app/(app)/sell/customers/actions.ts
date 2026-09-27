"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, t } from "@/db";
import { diff, formNumber, formText } from "@/lib/audit";
import { assertEntityAccess, getEntityContext } from "@/lib/dal";

export type FormState = { error?: string; ok?: string } | undefined;

async function context() {
  const { user, entity } = await getEntityContext();
  await assertEntityAccess(user.id, entity.id);
  return { user, entity };
}

async function ownCustomer(entityId: string, id: string) {
  const [c] = await db.select().from(t.customers).where(and(eq(t.customers.id, id), eq(t.customers.entityId, entityId)));
  if (!c) throw new Error("Customer not found.");
  return c;
}

/** Create or update a customer from the customer form. */
export async function saveCustomer(_: FormState, fd: FormData): Promise<FormState> {
  let savedId: string;
  try {
    const { user, entity } = await context();
    const id = formText(fd, "id");
    const name = formText(fd, "name", 200);
    if (!name) return { error: "Enter the customer's name." };
    const creditLimit = formNumber(fd, "creditLimit", "Credit limit");
    if (creditLimit !== null && creditLimit < 0) return { error: "Credit limit can't be negative." };
    const values = {
      name,
      code: formText(fd, "code", 40),
      billingLine1: formText(fd, "billingLine1"),
      billingLine2: formText(fd, "billingLine2"),
      billingCity: formText(fd, "billingCity"),
      billingRegion: formText(fd, "billingRegion"),
      billingPostcode: formText(fd, "billingPostcode"),
      billingCountry: formText(fd, "billingCountry"),
      contactName: formText(fd, "contactName"),
      phone: formText(fd, "phone"),
      email: formText(fd, "email"),
      businessNumber: formText(fd, "businessNumber"),
      paymentTerms: formText(fd, "paymentTerms"),
      priceTier: formText(fd, "priceTier"),
      creditLimit: creditLimit === null ? null : String(creditLimit),
      creditHold: fd.get("creditHold") === "on",
      notes: formText(fd, "notes", 5000),
      active: fd.get("active") !== "off",
    };
    const [clash] = await db
      .select({ id: t.customers.id })
      .from(t.customers)
      .where(
        and(
          eq(t.customers.entityId, entity.id),
          sql`lower(${t.customers.name}) = lower(${name})`,
          id ? ne(t.customers.id, id) : sql`true`,
        ),
      );
    if (clash) return { error: `There is already a customer called "${name}".` };

    if (id) {
      const before = await ownCustomer(entity.id, id);
      await db.update(t.customers).set(values).where(eq(t.customers.id, id));
      const changes = diff(before, values);
      if (Object.keys(changes).length)
        await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "customers", recordId: id, action: "update", changes });
      savedId = id;
    } else {
      const [c] = await db.insert(t.customers).values({ ...values, entityId: entity.id }).returning({ id: t.customers.id });
      await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "customers", recordId: c.id, action: "create", changes: { name } });
      savedId = c.id;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the customer." };
  }
  revalidatePath("/sell/customers");
  redirect(`/sell/customers/${savedId}`);
}

/** Add or update a delivery site. */
export async function saveSite(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { user, entity } = await context();
    const customerId = String(fd.get("customerId") ?? "");
    await ownCustomer(entity.id, customerId);
    const siteId = formText(fd, "siteId");
    const values = {
      name: formText(fd, "name", 200) ?? "Site",
      line1: formText(fd, "line1"),
      line2: formText(fd, "line2"),
      city: formText(fd, "city"),
      region: formText(fd, "region"),
      postcode: formText(fd, "postcode"),
      country: formText(fd, "country"),
      contactName: formText(fd, "contactName"),
      contactPhone: formText(fd, "contactPhone"),
      isDefault: fd.get("isDefault") === "on",
    };
    await db.transaction(async (tx) => {
      if (values.isDefault) await tx.update(t.customerSites).set({ isDefault: false }).where(eq(t.customerSites.customerId, customerId));
      if (siteId) {
        await tx.update(t.customerSites).set(values).where(and(eq(t.customerSites.id, siteId), eq(t.customerSites.customerId, customerId)));
      } else {
        await tx.insert(t.customerSites).values({ ...values, customerId });
      }
      await tx.insert(t.auditLog).values({
        entityId: entity.id,
        userId: user.id,
        tableName: "customer_sites",
        recordId: siteId ?? customerId,
        action: siteId ? "update" : "create",
        changes: values,
      });
    });
    revalidatePath(`/sell/customers/${customerId}`);
    return { ok: "Site saved." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the site." };
  }
}

/** Remove a delivery site. Past orders keep their own copy of the address, so nothing else changes. */
export async function deleteSite(fd: FormData) {
  const { user, entity } = await context();
  const customerId = String(fd.get("customerId") ?? "");
  const siteId = String(fd.get("siteId") ?? "");
  await ownCustomer(entity.id, customerId);
  await db.delete(t.customerSites).where(and(eq(t.customerSites.id, siteId), eq(t.customerSites.customerId, customerId)));
  await db.insert(t.auditLog).values({ entityId: entity.id, userId: user.id, tableName: "customer_sites", recordId: siteId, action: "delete" });
  revalidatePath(`/sell/customers/${customerId}`);
}
