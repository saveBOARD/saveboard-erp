import type { Metadata } from "next";
import { requireUser } from "@/lib/dal";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Change password · saveBOARD ERP" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto mt-8 max-w-sm rounded border border-line bg-surface p-6">
      <h1 className="text-lg font-medium">Change password</h1>
      <p className="mt-1 mb-4 text-sm text-muted">
        Signed in as <b>{user.username}</b>.
      </p>
      <ChangePasswordForm />
    </div>
  );
}
