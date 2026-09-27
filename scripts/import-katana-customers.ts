/**
 * Fills in missing customer details from a Katana customer export (Sell > Customers > export for editing,
 * "katana_customers_edit_<date>.xlsx": one row per address, customer details on the customer's first row).
 *
 *   npm run db:import-customers -- NZ "../NZ katana_customers_edit_2026-09-27.xlsx"            # preview only
 *   npm run db:import-customers -- NZ "../NZ katana_customers_edit_2026-09-27.xlsx" --apply    # write
 *   npm run db:import-customers:prod -- NZ "<file>" [--apply]                                  # Supabase
 *
 * Only fills gaps; never overwrites or deletes anything already in the app:
 * - Customers are matched on name (ignoring case, spacing and punctuation, and a trailing Ltd/Limited).
 * - Contact name, email, phone and billing address (Katana's "Default Billing" address) fill empty fields only;
 *   the billing address is only filled when the app has no billing address at all (never mixed).
 * - Katana's comment is added to the notes if it isn't there already.
 * - Delivery addresses (Default/Other Shipping) are added as delivery sites unless the customer already has a site
 *   at that street address. A site is made the default only when the customer has no default site yet.
 * - Katana customers not in the app are created, unless their name is nearly the same as an app customer's
 *   (a typo either side): those are skipped and listed, so the name can be corrected and the import re-run.
 * Every run writes a report next to the input file listing each customer and what was (or would be) changed.
 */
import "./env";
import { fixMojibake } from "./text-fix";
import path from "node:path";
import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { customerSites, customers, entities } from "../src/db/schema";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const [entityId, file] = args;
if (!entityId || !file) {
  console.error('Usage: npm run db:import-customers -- <NZ|AUS> "<path to katana_customers_edit.xlsx>" [--apply]');
  process.exit(1);
}

const text = (v: ExcelJS.CellValue): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return text(v.result as ExcelJS.CellValue);
    if ("richText" in v) return text(v.richText.map((r) => r.text).join(""));
    if ("text" in v) return text(String(v.text));
    return null;
  }
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : fixMojibake(s);
};
/** Name key for matching: lower case, letters and digits only, without a trailing "ltd"/"limited". */
const nameKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(ltd|limited)$/, "");
/** Edit distance, for spotting near-identical names (typos) that shouldn't become a second customer. */
function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" ") || null;
const streetKey = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

type Address = {
  type: string | null;
  company: string | null;
  contact: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};
type KatanaCustomer = {
  katanaIds: string[];
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  comment: string | null;
  addresses: Address[];
};

async function readKatana(): Promise<KatanaCustomer[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Customers");
  if (!ws) throw new Error(`${file}: sheet "Customers" not found — is this a Katana customer export?`);
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => header.set(String(c.value).trim(), col));
  for (const h of ["Display Name", "Customer ID", "Address Type", "Address Line 1"])
    if (!header.has(h)) throw new Error(`${file}: column "${h}" not found — is this a Katana customer export?`);
  const byId = new Map<string, KatanaCustomer>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (h: string) => text(row.getCell(header.get(h) ?? 0).value);
    const id = get("Customer ID");
    if (!id) continue;
    let c = byId.get(id);
    const name = get("Display Name");
    if (!c) {
      if (!name) continue;
      c = {
        katanaIds: [id],
        name,
        contactName: join(get("First Name"), get("Last Name")),
        email: get("Email"),
        phone: get("Phone"),
        comment: get("Comment"),
        addresses: [],
      };
      byId.set(id, c);
    }
    const address: Address = {
      type: get("Address Type"),
      company: get("Address Company"),
      contact: join(get("Address First Name"), get("Address Last Name")),
      phone: get("Address Phone"),
      line1: get("Address Line 1"),
      line2: get("Address Line 2"),
      city: get("Address City"),
      region: get("Address State"),
      postcode: get("Address Zip"),
      country: get("Address Country"),
    };
    if (address.line1 || address.city) c.addresses.push(address);
  }
  // Katana allows two customers with the same name; the app doesn't, so merge them (first one wins a field).
  const byName = new Map<string, KatanaCustomer>();
  for (const c of byId.values()) {
    const k = nameKey(c.name);
    const prev = byName.get(k);
    if (!prev) byName.set(k, c);
    else {
      prev.katanaIds.push(...c.katanaIds);
      prev.contactName ??= c.contactName;
      prev.email ??= c.email;
      prev.phone ??= c.phone;
      prev.comment ??= c.comment;
      prev.addresses.push(...c.addresses);
    }
  }
  return [...byName.values()];
}

type ReportRow = { katanaName: string; appName: string; outcome: string; filled: string; sitesAdded: number; katanaIds: string };

async function main() {
  const katana = await readKatana();
  const db = createDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) throw new Error(`Entity ${entityId} not found.`);

  const existing = await db.select().from(customers).where(eq(customers.entityId, entityId));
  const byKey = new Map<string, typeof existing>();
  for (const c of existing) byKey.set(nameKey(c.name), [...(byKey.get(nameKey(c.name)) ?? []), c]);
  const sites = existing.length
    ? await db.select().from(customerSites).where(inArray(customerSites.customerId, existing.map((c) => c.id)))
    : [];

  const report: ReportRow[] = [];
  const counts = { updated: 0, unchanged: 0, created: 0, ambiguous: 0, similar: 0, sites: 0 };

  await db.transaction(async (tx) => {
    for (const k of katana) {
      const matches = byKey.get(nameKey(k.name)) ?? [];
      const exact = matches.filter((m) => m.name.toLowerCase() === k.name.toLowerCase());
      const match = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
      const row: ReportRow = {
        katanaName: k.name,
        appName: match?.name ?? "",
        outcome: "",
        filled: "",
        sitesAdded: 0,
        katanaIds: k.katanaIds.join(", "),
      };
      report.push(row);
      if (matches.length > 1 && !match) {
        row.outcome = `Skipped: matches ${matches.length} app customers (${matches.map((m) => m.name).join(" / ")})`;
        counts.ambiguous++;
        continue;
      }

      if (!match) {
        const key = nameKey(k.name);
        const similar = existing.filter((c) => {
          const ck = nameKey(c.name);
          return distance(ck, key) <= Math.max(1, Math.floor(Math.min(ck.length, key.length) / 10));
        });
        if (similar.length) {
          row.outcome = `Skipped: name close to ${similar.map((c) => `"${c.name}"`).join(" / ")} — correct the name and re-run`;
          counts.similar++;
          continue;
        }
      }

      const billing = k.addresses.find((a) => a.type === "Default Billing");
      const deliveries = k.addresses.filter((a) => a.type !== "Default Billing");
      // A customer with only one, untyped address: use it for both.
      if (!billing && k.addresses.length === 1 && !k.addresses[0].type) deliveries.length = 0;
      const billingAddress = billing ?? (k.addresses.length === 1 && !k.addresses[0].type ? k.addresses[0] : undefined);

      const changes: Partial<typeof customers.$inferInsert> = {};
      const filled: string[] = [];
      const fill = <K extends "contactName" | "email" | "phone">(field: K, value: string | null, label: string) => {
        if (value && !match?.[field]) {
          changes[field] = value;
          filled.push(label);
        }
      };
      fill("contactName", k.contactName ?? billingAddress?.contact ?? null, "contact");
      fill("email", k.email, "email");
      fill("phone", k.phone ?? billingAddress?.phone ?? null, "phone");
      const hasBilling = match && (match.billingLine1 || match.billingLine2 || match.billingCity || match.billingPostcode);
      if (billingAddress && !hasBilling) {
        Object.assign(changes, {
          billingLine1: billingAddress.line1,
          billingLine2: billingAddress.line2,
          billingCity: billingAddress.city,
          billingRegion: billingAddress.region,
          billingPostcode: billingAddress.postcode,
          billingCountry: billingAddress.country,
        });
        filled.push("billing address");
      }
      if (k.comment && !(match?.notes ?? "").includes(k.comment)) {
        changes.notes = match?.notes ? `${match.notes}\n${k.comment}` : k.comment;
        filled.push("notes");
      }

      let customerId = match?.id;
      if (!match) {
        row.outcome = "Created (not in the app)";
        row.appName = k.name;
        counts.created++;
        if (apply) {
          const [c] = await tx
            .insert(customers)
            .values({ entityId, name: k.name, ...changes })
            .returning({ id: customers.id });
          customerId = c.id;
        }
      } else if (filled.length) {
        if (apply) await tx.update(customers).set({ ...changes, updatedAt: new Date() }).where(eq(customers.id, match.id));
      }

      // delivery sites (for a new customer with only a billing address, that becomes its default site,
      // as the workbook import does)
      const own = sites.filter((s) => s.customerId === match?.id);
      const siteAddresses = deliveries.length ? deliveries : !own.length && billingAddress ? [billingAddress] : [];
      let hasDefault = own.some((s) => s.isDefault);
      const seen = new Set(own.map((s) => streetKey(s.line1)));
      const ordered = [...siteAddresses].sort((a, b) => Number(b.type === "Default Shipping") - Number(a.type === "Default Shipping"));
      for (const a of ordered) {
        if (seen.has(streetKey(a.line1))) continue;
        seen.add(streetKey(a.line1));
        const isDefault = !hasDefault;
        hasDefault = true;
        row.sitesAdded++;
        counts.sites++;
        if (apply && customerId)
          await tx.insert(customerSites).values({
            customerId,
            name: a.company ?? ([a.line1, a.city].filter(Boolean).join(", ") || k.name),
            line1: a.line1,
            line2: a.line2,
            city: a.city,
            region: a.region,
            postcode: a.postcode,
            country: a.country,
            contactName: a.contact,
            contactPhone: a.phone,
            isDefault,
          });
      }

      row.filled = filled.join(", ");
      if (match) {
        if (filled.length || row.sitesAdded) {
          row.outcome = "Filled in";
          counts.updated++;
        } else {
          row.outcome = "Nothing missing";
          counts.unchanged++;
        }
      }
    }
  });

  // App customers Katana doesn't know about (left alone; listed so they can be checked).
  const katanaKeys = new Set(katana.map((k) => nameKey(k.name)));
  const appOnly = existing.filter((c) => !katanaKeys.has(nameKey(c.name)));
  for (const c of appOnly)
    report.push({ katanaName: "", appName: c.name, outcome: "In the app only (left alone)", filled: "", sitesAdded: 0, katanaIds: "" });

  const out = path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))} - ${apply ? "import result" : "import preview"}.xlsx`,
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Customers");
  ws.columns = [
    { header: "Katana name", key: "katanaName", width: 40 },
    { header: "App customer", key: "appName", width: 40 },
    { header: "Outcome", key: "outcome", width: 45 },
    { header: "Fields filled", key: "filled", width: 45 },
    { header: "Delivery sites added", key: "sitesAdded", width: 12 },
    { header: "Katana customer ID", key: "katanaIds", width: 20 },
  ];
  ws.addRows(report);
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: "A1", to: "F1" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(out);

  console.log(
    `${entityId}: ${katana.length} Katana customers · ${counts.updated} filled in · ${counts.unchanged} nothing missing · ` +
      `${counts.created} new · ${counts.ambiguous + counts.similar} skipped (name unclear — see report) · ${counts.sites} delivery sites · ` +
      `${appOnly.length} app customers not in Katana (left alone)`,
  );
  console.log(apply ? `Written to the database. Report: ${out}` : `PREVIEW ONLY — nothing written. Report: ${out}\nRun again with --apply to write.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
