import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db, t } from "@/db";
import { getEntityContext, requireAdmin } from "@/lib/dal";
import { CompanyForm } from "./form";

export const metadata: Metadata = { title: "Company details · saveBOARD ERP" };

export default async function CompanyPage() {
  await requireAdmin();
  const { entity } = await getEntityContext();
  const [e] = await db.select().from(t.entities).where(eq(t.entities.id, entity.id));
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <h1 className="text-xl font-medium">Company details — {e.name}</h1>
        <p className="text-sm text-muted">
          Printed on quotes, order acknowledgements and packing slips for <b>{e.legalName}</b>. Switch entity (top right) to edit
          the other company.
        </p>
      </div>
      <CompanyForm
        entityId={e.id}
        values={{ address: e.address, phone: e.phone, email: e.email, website: e.website, taxNumber: e.taxNumber, quoteTerms: e.quoteTerms }}
        taxLabel={e.id === "AUS" ? "ABN" : "GST number"}
      />
    </div>
  );
}
