/**
 * Prints the dashboard's sales figures straight from the database, to check them against Katana.
 *   npx tsx --conditions=react-server scripts/check-sales.ts [--prod]
 */
import "./env";
import { fyStart } from "../src/lib/periods";
import { salesByCustomer, salesByMonth, salesByProduct, salesTotal } from "../src/lib/queries/sales";

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  for (const [e, cur] of [
    ["NZ", "NZD"],
    ["AUS", "AUD"],
  ]) {
    const fy = fyStart(e, today);
    const all = await salesTotal(e, cur, { from: "2000-01-01", to: today });
    const thisFy = await salesTotal(e, cur, { from: fy, to: today });
    console.log(`${e}: all history ${all.amount.toFixed(2)} ${cur} (${all.orders} orders) · this FY from ${fy}: ${thisFy.amount.toFixed(2)} (${thisFy.orders} orders)`);
    console.log("  months:", (await salesByMonth(e, cur, { from: "2025-09-01", to: today })).map((m) => `${m.month} ${Math.round(m.amount)}`).join(" · "));
    console.log("  top customers FY:", (await salesByCustomer(e, cur, { from: fy, to: today }, 3)).map((c) => `${c.customer} ${Math.round(c.amount)}`).join(" · "));
    console.log("  top products FY:", (await salesByProduct(e, cur, { from: fy, to: today }, 3)).map((p) => `${p.sku} ${Math.round(p.amount)}`).join(" · "));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
