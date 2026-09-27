"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { BarChart3, Boxes, Building2, ChevronDown, Hammer, LogOut, MapPin, Package, ShoppingBasket, Store, UserCog } from "lucide-react";
import clsx from "clsx";
import { SECTIONS } from "@/lib/nav";
import { switchEntity } from "@/app/(app)/actions";
import { logout } from "@/app/login/actions";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sell: Store,
  make: Hammer,
  buy: ShoppingBasket,
  stock: Boxes,
  items: Package,
  insights: BarChart3,
};

function currentSection(pathname: string) {
  return SECTIONS.find((s) => pathname.startsWith(`/${s.key}`));
}

export function TopNav({
  user,
  entities,
  currentEntity,
}: {
  user: { displayName: string; isAdmin: boolean };
  entities: { id: string; name: string }[];
  currentEntity: string;
}) {
  const pathname = usePathname();
  const active = currentSection(pathname);
  const formRef = useRef<HTMLFormElement>(null);
  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="no-print flex flex-wrap items-stretch bg-nav text-nav-ink">
      <Link href="/" className="flex items-center px-4 py-2" aria-label="saveBOARD home">
        <Image src="/logo-on-dark.png" alt="saveBOARD" width={600} height={181} priority className="h-9 w-auto" />
      </Link>
      <nav className="flex flex-wrap items-stretch" aria-label="Main">
        {SECTIONS.map((s) => {
          const Icon = ICONS[s.key];
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active?.key === s.key ? "page" : undefined}
              className={clsx(
                "flex min-w-[68px] flex-col items-center justify-center gap-0.5 px-3 py-2 text-xs hover:bg-nav-hover",
                active?.key === s.key && "bg-nav-hover font-medium",
              )}
            >
              <Icon className="h-5 w-5" />
              {s.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2 px-4 py-2">
        <form ref={formRef} action={switchEntity} className="flex items-center gap-1 rounded bg-nav-hover px-2 py-1 text-sm">
          <MapPin className="h-4 w-4" aria-hidden />
          <label htmlFor="entity" className="sr-only">
            Entity
          </label>
          <select
            id="entity"
            name="entity"
            defaultValue={currentEntity}
            onChange={() => formRef.current?.requestSubmit()}
            className="cursor-pointer bg-transparent font-medium outline-none [&>option]:text-ink"
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id === "NZ" ? "New Zealand" : "Australia"}
              </option>
            ))}
          </select>
        </form>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full py-1 pl-1 pr-2 hover:bg-nav-hover">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4a6275] text-sm font-medium">{initials}</span>
            <ChevronDown className="h-4 w-4" aria-hidden />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md bg-surface text-sm text-ink shadow-lg ring-1 ring-line">
            <div className="border-b border-line px-4 py-2 text-muted">{user.displayName}</div>
            <Link href="/account" className="flex items-center gap-2 px-4 py-2 hover:bg-page">
              <UserCog className="h-4 w-4" /> Change password
            </Link>
            {user.isAdmin && (
              <>
                <Link href="/settings/users" className="flex items-center gap-2 px-4 py-2 hover:bg-page">
                  <UserCog className="h-4 w-4" /> Users
                </Link>
                <Link href="/settings/company" className="flex items-center gap-2 px-4 py-2 hover:bg-page">
                  <Building2 className="h-4 w-4" /> Company details
                </Link>
              </>
            )}
            <form action={logout}>
              <button className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-page">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}

export function SubNav() {
  const pathname = usePathname();
  const section = currentSection(pathname);
  if (!section) return null;
  return (
    <nav className="no-print flex flex-wrap gap-x-6 border-b border-line bg-surface px-6 text-sm" aria-label={section.label}>
      {section.tabs.map((tab) => {
        const on = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "border-b-2 py-2.5 text-link hover:text-primary",
              on ? "border-primary font-medium text-primary" : "border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
