import clsx from "clsx";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db, t } from "@/db";
import { getEntityContext, requireAdmin } from "@/lib/dal";
import { entityXeroSettings } from "@/lib/queries/xero-settings";
import { xeroCodingOptions } from "@/lib/xero/coding";
import { XeroCodingForm } from "./coding-form";
import { xeroConfig } from "@/lib/xero/client";
import { XeroButtons } from "./buttons";

export const metadata: Metadata = { title: "Xero · saveBOARD ERP" };

const ERRORS: Record<string, string> = {
  "not-configured": "Xero isn't set up yet: the app's Xero client ID and secret haven't been added (see the steps below).",
  state: "The Xero sign-in didn't match this browser session. Try Connect again.",
  access_denied: "Access wasn't approved in Xero.",
  "pick-one": "More than one organisation was ticked. Connect again and tick only this entity's organisation.",
  "no-org": "No organisation was chosen in Xero.",
};

export default async function XeroSettingsPage(props: PageProps<"/settings/xero">) {
  await requireAdmin();
  const { entity } = await getEntityContext();
  const sp = await props.searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const [[conn], logRows] = await Promise.all([
    db.select().from(t.xeroConnections).where(eq(t.xeroConnections.entityId, entity.id)),
    db
      .select({ at: t.xeroSyncLog.at, kind: t.xeroSyncLog.kind, doc: t.xeroSyncLog.docNumber, ok: t.xeroSyncLog.ok, message: t.xeroSyncLog.message })
      .from(t.xeroSyncLog)
      .where(eq(t.xeroSyncLog.entityId, entity.id))
      .orderBy(desc(t.xeroSyncLog.at))
      .limit(40),
  ]);
  const configured = !!xeroConfig();
  const error = str(sp.error);
  const tz = entity.id === "AUS" ? "Australia/Sydney" : "Pacific/Auckland";
  const when = (d: Date) => d.toLocaleString("en-NZ", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  const x = await entityXeroSettings(entity.id);
  // The organisation's own accounts and tax rates, for Invoice coding (only when connected).
  let coding: Awaited<ReturnType<typeof xeroCodingOptions>> | null = null;
  let codingError: string | null = null;
  if (conn) {
    try {
      coding = await xeroCodingOptions(entity.id);
    } catch (e) {
      codingError = e instanceof Error ? e.message : "Couldn't read the accounts from Xero.";
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <h1 className="text-xl font-medium">Xero — {entity.name}</h1>
      {str(sp.connected) && <p className="rounded bg-ok/15 px-3 py-2 text-sm text-ok">Connected to {str(sp.connected)}. Click Check settings to confirm the account code and tax rates.</p>}
      {error && (
        <p className="rounded bg-bad/10 px-3 py-2 text-sm text-bad">
          {error === "other-entity" ? `${str(sp.org)} is already connected to ${str(sp.entity)}. Each entity must use its own Xero organisation.` : (ERRORS[error] ?? error)}
        </p>
      )}

      <section className="grid gap-3 rounded border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={clsx("rounded px-3 py-1 text-sm", conn ? "bg-ok text-white" : "bg-pending")}>{conn ? "Connected" : "Not connected"}</span>
          {conn && (
            <span className="text-sm">
              <b>{conn.tenantName}</b> <span className="text-muted">· since {when(conn.connectedAt)}</span>
            </span>
          )}
        </div>
        {configured ? (
          <XeroButtons connected={!!conn} orgName={conn?.tenantName ?? null} />
        ) : (
          <p className="text-sm text-warn">The app&apos;s Xero keys aren&apos;t set yet, so Connect isn&apos;t available. See the one-off set-up below.</p>
        )}
        <ul className="ml-5 list-disc text-sm text-muted">
          <li>
            When connected, Sell → Invoicing sends invoices and credit notes straight to <b>{conn?.tenantName ?? `the ${entity.id} Xero organisation`}</b> as{" "}
            <b>drafts</b> (numbered SO-… / RET-…, account {x.accountCode}, &ldquo;{x.taxOnIncome}&rdquo; or &ldquo;{x.taxZeroRated}&rdquo;). Approve them in Xero as
            usual.
          </li>
          <li>Customers are matched to Xero contacts by exact name; a customer Xero doesn&apos;t have is created as a new contact.</li>
          <li>Every morning (and on Refresh payments now) the app reads back each invoice&apos;s status and amount due. A paid invoice closes its order.</li>
          <li>The download-a-file option stays available on the Invoicing page as a fallback.</li>
        </ul>
      </section>

      {conn && (
        <section className="grid gap-3 rounded border border-line bg-surface p-5">
          <div>
            <h2 className="font-medium">Invoice coding</h2>
            <p className="text-sm text-muted">
              The sales account and tax rates used on {entity.id} invoices and credit notes in {conn.tenantName}, chosen from its own chart of accounts. Also
              used in the import file.
            </p>
          </div>
          {coding ? (
            <XeroCodingForm accounts={coding.accounts} taxRates={coding.taxRates} current={x} />
          ) : (
            <p className="text-sm text-bad">{codingError}</p>
          )}
        </section>
      )}

      {!conn && (
        <section className="grid gap-2 rounded border border-line bg-surface p-5 text-sm">
          <h2 className="font-medium">One-off set-up (done once, for both entities)</h2>
          <ol className="ml-5 grid list-decimal gap-1">
            <li>
              Sign in at <b>developer.xero.com</b> with your Xero login → <b>My Apps</b> → <b>New app</b>. Choose <b>Web app</b>, name it &ldquo;saveBOARD ERP&rdquo;, company
              URL <code>https://saveboard-erp.vercel.app</code>.
            </li>
            <li>
              Redirect URI: <code>https://saveboard-erp.vercel.app/api/xero/callback</code> (add <code>http://localhost:3000/api/xero/callback</code> too, for testing).
            </li>
            <li>
              Under <b>Configuration</b>, copy the <b>Client id</b> and generate a <b>Client secret</b>. In Vercel → project → Settings → Environment Variables add{" "}
              <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code>, plus <code>CRON_SECRET</code> (any long random text, for the morning payment check). Redeploy.
            </li>
            <li>
              Come back here, switch to each entity in turn (top right) and click <b>Connect to Xero</b>. In Xero, tick <b>only</b> that entity&apos;s organisation.
            </li>
          </ol>
          <p className="text-muted">The app uses Xero&apos;s free Starter tier (up to 5 organisations, 1,000 requests a day); we need two.</p>
        </section>
      )}

      <section className="overflow-x-auto rounded border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 font-medium">Recent Xero activity</div>
        <table className="w-full text-sm">
          <tbody>
            {logRows.map((l, i) => (
              <tr key={i} className={l.ok ? "" : "bg-bad/5"}>
                <td className="border-b border-line px-3 py-1.5 whitespace-nowrap text-muted">{when(l.at)}</td>
                <td className="border-b border-line px-3 py-1.5">{l.kind.replace("_", " ")}</td>
                <td className="border-b border-line px-3 py-1.5 font-mono text-xs">{l.doc}</td>
                <td className={clsx("border-b border-line px-3 py-1.5", !l.ok && "text-bad")}>{l.message}</td>
              </tr>
            ))}
            {!logRows.length && (
              <tr>
                <td className="px-3 py-3 text-muted">Nothing yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
