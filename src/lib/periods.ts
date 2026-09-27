/** Report date ranges. Financial years: NZ 1 April – 31 March, AUS 1 July – 30 June. All dates are YYYY-MM-DD. */

export type PeriodKey = "this_month" | "last_month" | "this_fy" | "last_fy" | "last_12" | "all";
export type Period = { key: PeriodKey | "custom"; from: string; to: string; label: string };

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_fy", label: "This financial year" },
  { key: "last_fy", label: "Last financial year" },
  { key: "last_12", label: "Last 12 months" },
  { key: "all", label: "All history" },
];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
export const fyStartMonth = (entityId: string) => (entityId === "AUS" ? 6 : 3); // 0-based: July / April

/** First day of the financial year containing `today`. */
export function fyStart(entityId: string, today: string) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const sm = fyStartMonth(entityId);
  return iso(m >= sm ? y : y - 1, sm, 1);
}

export function resolvePeriod(entityId: string, today: string, key?: string, from?: string, to?: string): Period {
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (valid(from) || valid(to)) return { key: "custom", from: valid(from) ? from! : "2000-01-01", to: valid(to) ? to! : today, label: `${valid(from) ? from : "start"} to ${valid(to) ? to : today}` };
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const k = (PERIODS.find((p) => p.key === key)?.key ?? "this_fy") as PeriodKey;
  const label = PERIODS.find((p) => p.key === k)!.label;
  switch (k) {
    case "this_month":
      return { key: k, from: iso(y, m, 1), to: today, label };
    case "last_month":
      return { key: k, from: iso(y, m - 1, 1), to: iso(y, m, 0), label };
    case "this_fy":
      return { key: k, from: fyStart(entityId, today), to: today, label };
    case "last_fy": {
      const start = fyStart(entityId, today);
      const sy = Number(start.slice(0, 4));
      const sm = fyStartMonth(entityId);
      return { key: k, from: iso(sy - 1, sm, 1), to: iso(sy, sm, 0), label };
    }
    case "last_12":
      return { key: k, from: iso(y, m - 11, 1), to: today, label };
    case "all":
      return { key: k, from: "2000-01-01", to: today, label };
  }
}
