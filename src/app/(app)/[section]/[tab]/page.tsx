import { Construction } from "lucide-react";
import { notFound } from "next/navigation";
import { PHASE_NAMES, SECTIONS } from "@/lib/nav";

/** Screens that are on the plan but not built yet. Built screens have their own route and take precedence. */
export default async function ComingSoon(props: PageProps<"/[section]/[tab]">) {
  const { section, tab } = await props.params;
  const found = SECTIONS.find((s) => s.key === section)?.tabs.find((t) => t.href === `/${section}/${tab}`);
  if (!found) notFound();
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-line bg-surface p-8 text-center">
      <Construction className="mx-auto h-10 w-10 text-warn" aria-hidden />
      <h1 className="mt-3 text-lg font-medium">{found.label}</h1>
      <p className="mt-1 text-sm text-muted">
        This screen is coming in <b>{found.phase ? PHASE_NAMES[found.phase] : "a later phase"}</b>. Until then, keep using the
        Excel workbook for this.
      </p>
    </div>
  );
}
