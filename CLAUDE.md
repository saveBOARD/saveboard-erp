@AGENTS.md

# saveBOARD ERP

Web ERP replacing Katana MRP (and the interim Excel workbooks) for saveBOARD. Owner: Paul Charteris.
Plan: https://claude.ai/artifact/PajkmQrsqUGB1LWHsidWKn · Specs: `../saveBOARD_ERP_Requirements_Synthesis_2.docx`,
`../saveBOARD_NZ_ERP_MVP.xlsx`, `../saveBOARD_AUS_ERP_MVP_3.xlsx` (the workbooks are the functional spec and the import source).
Katana UI screenshots (look-and-feel reference) are the `../*Screen.png` files.

## Stack
Next.js 16 (App Router, TypeScript, Tailwind v4) on Vercel · Postgres (+ Storage later) on Supabase (Sydney) · code on GitHub.
Drizzle ORM (`src/db/schema.ts`); migrations in `drizzle/`. All database access is server-side (server components /
server actions); the browser never queries tables directly.
- **Auth is our own** (not Supabase Auth), so the app stays portable to any host: bcrypt password hashes in `users`,
  signed JWT session cookie (`src/lib/session.ts`), checks in `src/lib/dal.ts` (`requireUser`, `getEntityContext`,
  `assertEntityAccess`). `src/proxy.ts` only does the optimistic redirect to /login.
- **Every new table must `ENABLE ROW LEVEL SECURITY` in its migration** (see `drizzle/0001_enable_rls.sql`): this
  closes Supabase's public Data API; the app connects as the owner and is unaffected.
- Supabase `DATABASE_URL` must be the **Transaction pooler** (`aws-0-ap-southeast-2.pooler.supabase.com:6543`,
  user `postgres.<ref>`), not the IPv6-only direct host `db.<ref>.supabase.co`.
- Local dev needs no accounts: without `DATABASE_URL` the app uses PGlite (embedded Postgres) in `.data/pglite`.
  PGlite is single-process: **stop `npm run dev` before running any local `db:*` script**, or the running app
  won't see (and may overwrite) the changes. If PGlite fails with "Aborted()" (it doesn't survive the dev server
  being killed mid-write), rebuild it: `npm run db:rebuild-local` (≈1 min, recreates everything from the Katana files).
- Katana exports double-encode some characters (Whangārei → "WhangÄrei"); every importer runs `fixMojibake`.
- Sales order stock flow: shipments (`shipments`, `shipment_lines`) are the only way stock leaves for a sale; an order
  becomes `shipped` when every line is fully shipped. Committed stock = ordered − shipped on open/picked orders.
  Reversing a shipment adds opposite movements (never deletes).
- Lists use the shared `src/components/data-table.tsx` (filters, sort, totals, Excel export, column picker).

## Commands
- `npm run dev` · `npm run typecheck` · `npm run lint` · `npm run build`
- `npm run db:generate` (after editing schema.ts) → `npm run db:migrate`
- `npm run db:seed` (entities + first admin from .env.local) · `npm run db:import` (both Excel workbooks)
- `npm run db:import-customers -- NZ "<katana_customers_edit.xlsx>"` previews filling customer gaps from a Katana
  customer export; add `--apply` to write. Customer imports only ever fill empty fields (app edits win).
- Add `:prod` (e.g. `db:migrate:prod`) to run against Supabase using `.env.production.local`.
- Switchover from Katana: `docs/switchover.md`; `scripts/switchover.ps1` (local rehearsal) / `-Target prod` (live).

## Business rules (do not break)
- **Two entities, fully separate**: NZ = Upcycled Building Materials Ltd (NZD, 15% GST, location "New Zealand");
  AUS = Upcycled Building Materials Australian Pty Ltd (AUD, 10% GST, location "saveBOARD NSW").
  Every business table has `entity_id`; every query filters by the user's current entity. Customers, SKUs, stock,
  number sequences and Xero orgs never cross entities.
- **Numbering**: a quote *is* a sales order in `quote` status and keeps its number when converted (Katana style).
  Per-entity sequences continue from Katana (NZ last used SO-1585). PO-, MO-, SA-, STK- sequences per entity.
- **Stock is a ledger**: every change is a row in `stock_movements`. On hand = sum of movements.
  Committed = confirmed, unshipped order lines. Expected = open PO lines + planned MO output. ATP = on hand − committed.
  Never store a mutable "stock on hand" number as the source of truth.
- Completing an MO consumes its materials AND adds finished goods. Receiving a PO adds stock. Items with
  Track Stock = No (freight, Hiab, picking fee, …) never create movements or SHORT/REORDER flags.
- Batch numbers are recorded on MO output and on shipment lines (traceability).
- **Cost and margin never appear** on picking slips, packing slips or work orders.
- **Exports are zero-rated**: goods on export orders carry 0% GST; only freight is charged GST (Paul, 27/9/26).
- One sales order = one invoice (no split/progress invoicing). Invoicing is manual, not automatic on Shipped.
- Sales order status: Open → Picked → Shipped → Invoiced → Closed; partial shipments allowed; orders editable after
  confirmation with an audit trail. Stock shortfalls are flagged for a person — never auto-create POs/MOs.
- Credit limit / credit hold is checked when an order is confirmed.
- Xero: one-way push (contacts, invoices, credit notes) to the entity's own Xero org; payment status reads back.
- Every list screen exports to Excel.

## Users & UI
- Sign-in with **username + password** (admin creates users; no self sign-up). Desktop-first; picking, goods
  receipt and stocktake screens must also work on a tablet.
- Mirror Katana's look: dark top nav (Sell · Make · Buy · Stock · Items · Insights), sub-tabs, Open/Done status
  tabs, a filter on every column, a Total row, coloured status cells (red = not available, green = in stock/done,
  grey dropdowns = not invoiced/not shipped), entity switcher top-right, blue "+ New" button.

## Working agreements
- Paul is the product owner, not a developer: explain changes in plain language, keep decisions visible.
- One phase at a time; each ends with Paul testing on real data. New ideas go to `docs/backlog.md`.
- Never commit secrets; `.env*` files stay out of git.
