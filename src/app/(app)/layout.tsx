import { getEntityContext } from "@/lib/dal";
import { SubNav, TopNav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, entities, entity } = await getEntityContext();
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav
        user={{ displayName: user.displayName, isAdmin: user.isAdmin }}
        entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        currentEntity={entity.id}
      />
      <SubNav />
      <main className="flex-1 px-4 py-4 sm:px-6">{children}</main>
    </div>
  );
}
