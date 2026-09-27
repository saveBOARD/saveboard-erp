/**
 * A picked date (YYYY-MM-DD) as a timestamp that falls on that same day in both NZ and Sydney:
 * 00:00 UTC is 10–13:00 local in both. (Noon *server* time was UTC noon on Vercel = next day in NZ.)
 */
export const dayStamp = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** A timestamp as YYYY-MM-DD in the entity's own time zone. */
export function entityDay(d: Date | null | undefined, entityId: string) {
  if (!d) return null;
  return d.toLocaleDateString("en-CA", { timeZone: entityId === "AUS" ? "Australia/Sydney" : "Pacific/Auckland" });
}
