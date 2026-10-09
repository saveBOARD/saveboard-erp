import "server-only";
import { xeroApi } from "./client";

/** The Xero organisation's revenue accounts and sales tax rates, for the Invoice coding choices. */
export async function xeroCodingOptions(entityId: string) {
  const [{ Accounts }, { TaxRates }] = await Promise.all([
    xeroApi<{ Accounts: { Code?: string; Name: string; Status: string }[] }>(entityId, "GET", `/Accounts?where=${encodeURIComponent('Class=="REVENUE"')}`),
    xeroApi<{ TaxRates: { Name: string; Status: string; EffectiveRate: number; CanApplyToRevenue: boolean }[] }>(entityId, "GET", "/TaxRates"),
  ]);
  return {
    accounts: Accounts.filter((a) => a.Status === "ACTIVE" && a.Code).map((a) => ({ code: a.Code!, name: a.Name })),
    taxRates: TaxRates.filter((r) => r.Status === "ACTIVE" && r.CanApplyToRevenue).map((r) => ({ name: r.Name, rate: r.EffectiveRate })),
  };
}
