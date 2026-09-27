import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { db, t } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { setActive } from "./actions";
import { NewUserForm, ResetPasswordForm } from "./forms";

export const metadata: Metadata = { title: "Users · saveBOARD ERP" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await db.select().from(t.users).orderBy(asc(t.users.displayName));
  const access = await db.select().from(t.userEntities);
  const entitiesFor = (id: string) =>
    access
      .filter((a) => a.userId === id)
      .map((a) => a.entityId)
      .sort()
      .join(", ");

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <h1 className="text-xl font-medium">Users</h1>
      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              {["Name", "Username", "Entities", "Role", "Last sign-in", "Status", ""].map((h) => (
                <th key={h} className="border-b border-line px-3 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="align-top">
                <td className="border-b border-line px-3 py-2">{u.displayName}</td>
                <td className="border-b border-line px-3 py-2 font-mono text-xs">{u.username}</td>
                <td className="border-b border-line px-3 py-2">{entitiesFor(u.id)}</td>
                <td className="border-b border-line px-3 py-2">{u.isAdmin ? "Admin" : "Staff"}</td>
                <td className="border-b border-line px-3 py-2 whitespace-nowrap">
                  {u.lastLoginAt ? u.lastLoginAt.toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" }) : "Never"}
                </td>
                <td className="border-b border-line px-3 py-2">
                  {!u.active ? (
                    <span className="text-bad">Disabled</span>
                  ) : u.lockedUntil && u.lockedUntil > new Date() ? (
                    <span className="text-warn">Locked</span>
                  ) : (
                    "Active"
                  )}
                </td>
                <td className="border-b border-line px-3 py-2">
                  <div className="flex flex-wrap items-start gap-2">
                    <ResetPasswordForm userId={u.id} />
                    {u.id !== me.id && (
                      <form action={setActive}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                        <button className="btn-secondary text-xs">{u.active ? "Disable" : "Enable"}</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NewUserForm />
    </div>
  );
}
