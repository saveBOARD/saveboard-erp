import type { Metadata } from "next";
import { getEntityContext, requireAdmin } from "@/lib/dal";
import { ImportCustomersForm } from "./form";

export const metadata: Metadata = { title: "Import customers · saveBOARD ERP" };

export default async function ImportCustomersPage() {
  await requireAdmin();
  const { entity } = await getEntityContext();
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div>
        <h1 className="text-xl font-medium">Import customers from Katana — {entity.name}</h1>
        <p className="max-w-3xl text-sm text-muted">
          Upload Katana&apos;s customer export (<i>katana_customers_edit_…xlsx</i>) to fill in missing contact names, emails, phone numbers,
          billing addresses and delivery sites for <b>{entity.id}</b> customers. Katana customers that aren&apos;t in the app yet are added.
          Nothing already in the app is changed or deleted. You&apos;ll see a preview first; nothing is saved until you click Apply.
          Switch entity (top right) to import the other company&apos;s file.
        </p>
      </div>
      <ImportCustomersForm entityId={entity.id} />
    </div>
  );
}
