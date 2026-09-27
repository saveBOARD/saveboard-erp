"use client";

import clsx from "clsx";
import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { savePrices } from "@/app/(app)/sell/price-lists/actions";
import { listPrice, type PriceListData } from "@/lib/pricing";

export type GridItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  uom: string | null;
  type: "product" | "material" | "service";
  cost: number;
  lastPrice: number | null;
  price: number | null; // this list's own price
};

const fmt = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const same = (a: string, b: number | null) => (a.trim() === "" ? b === null : b !== null && Math.abs(Number(a) - b) < 1e-9);

export function PriceGrid({ list, defaultList, items, currency }: { list: PriceListData; defaultList: PriceListData | null; items: GridItem[]; currency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.price === null ? "" : String(i.price)])));
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"sellable" | "all" | GridItem["type"]>("sellable");
  const [show, setShow] = useState<"all" | "priced" | "unpriced">("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const changed = items.filter((i) => !same(edits[i.id] ?? "", i.price));
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  /** The price a customer on this list would get if this row had no own price. */
  const inherited = (id: string) => {
    if (list.isDefault) return null;
    const viaAdjust = listPrice({ ...list, prices: {} }, defaultList ?? undefined, id);
    return viaAdjust?.price ?? defaultList?.prices[id] ?? null;
  };

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      items.filter((i) => {
        if (type === "sellable" ? i.type === "material" : type !== "all" && i.type !== type) return false;
        const has = (edits[i.id] ?? "").trim() !== "";
        if (show === "priced" && !has) return false;
        if (show === "unpriced" && has) return false;
        return !q || `${i.sku} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(q);
      }),
    [items, type, show, q, edits],
  );

  function fillFromLast() {
    const blanks = visible.filter((i) => (edits[i.id] ?? "").trim() === "" && i.lastPrice !== null);
    if (!blanks.length) return setMessage({ ok: false, text: "No blank prices with a last price charged among the rows shown." });
    setEdits((e) => ({ ...e, ...Object.fromEntries(blanks.map((i) => [i.id, String(i.lastPrice)])) }));
    setMessage({ ok: true, text: `${blanks.length} blank prices filled from the last price charged. Check them, then Save.` });
  }

  function save() {
    setMessage(null);
    const bad = changed.find((i) => (edits[i.id] ?? "").trim() !== "" && !(Number(edits[i.id]) >= 0));
    if (bad) return setMessage({ ok: false, text: `${bad.sku}: "${edits[bad.id]}" isn't a valid price.` });
    startTransition(async () => {
      const res = await savePrices({
        listId: list.id,
        changes: changed.map((i) => ({ productId: i.id, price: (edits[i.id] ?? "").trim() === "" ? null : Number(edits[i.id]) })),
      });
      if (res.error) return setMessage({ ok: false, text: res.error });
      setMessage({ ok: true, text: `${res.saved} price${res.saved === 1 ? "" : "s"} saved.` });
      router.refresh();
    });
  }

  async function download() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(list.name.slice(0, 31));
    ws.columns = [
      { header: "SKU", key: "sku", width: 28 },
      { header: "Name", key: "name", width: 50 },
      { header: "Category", key: "category", width: 24 },
      { header: "UoM", key: "uom", width: 8 },
      { header: `Cost (${currency})`, key: "cost", width: 12 },
      { header: `Price (${currency}, ex GST)`, key: "price", width: 16 },
    ];
    ws.addRows(visible.map((i) => ({ sku: i.sku, name: i.name, category: i.category, uom: i.uom, cost: i.cost, price: (edits[i.id] ?? "").trim() === "" ? null : Number(edits[i.id]) })));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `price-list-${list.name.replace(/[^\w-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Reads SKU + Price columns from an Excel file into the grid (not saved until Save). Blank prices are ignored. */
  async function upload(file: File) {
    setMessage(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const cellText = (v: unknown): string => {
        if (v && typeof v === "object" && "result" in v) return cellText((v as { result: unknown }).result);
        if (v && typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
        return v == null ? "" : String(v).trim();
      };
      const header = (ws.getRow(1).values as unknown[]).map((v) => cellText(v).toLowerCase());
      const skuCol = header.findIndex((h) => h === "sku" || h.includes("sku"));
      const priceCol = header.findIndex((h) => h.startsWith("price"));
      if (skuCol < 1 || priceCol < 1) throw new Error('The first row needs a "SKU" column and a "Price" column.');
      const bySku = new Map(items.map((i) => [i.sku.toLowerCase(), i]));
      const next: Record<string, string> = {};
      const unknown: string[] = [];
      ws.eachRow((row, n) => {
        if (n === 1) return;
        const sku = cellText(row.getCell(skuCol).value);
        const price = cellText(row.getCell(priceCol).value).replace(/[$,\s]/g, "");
        if (!sku || price === "") return;
        const item = bySku.get(sku.toLowerCase());
        if (!item) return void unknown.push(sku);
        if (!(Number(price) >= 0)) throw new Error(`Row ${n} (${sku}): "${price}" isn't a price.`);
        next[item.id] = String(Number(price));
      });
      setEdits((e) => ({ ...e, ...next }));
      setMessage({
        ok: true,
        text: `${Object.keys(next).length} prices read from ${file.name}${unknown.length ? `; ${unknown.length} SKUs not found (${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""})` : ""}. Check them, then Save.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Couldn't read that file." });
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-4 py-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU, name or category…" className="input w-64" aria-label="Search" />
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="input" aria-label="Item type">
          <option value="sellable">Products & services</option>
          <option value="product">Products</option>
          <option value="service">Services</option>
          <option value="material">Materials</option>
          <option value="all">Everything</option>
        </select>
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="input" aria-label="Priced">
          <option value="all">Priced and not</option>
          <option value="priced">With a price on this list</option>
          <option value="unpriced">Without a price</option>
        </select>
        <button type="button" onClick={fillFromLast} className="btn-secondary" title="Fill empty prices (in the rows shown) with the last price charged to any customer">
          Fill blanks from last charged
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={download} className="icon-btn" title="Download to Excel" aria-label="Download to Excel">
            <Download className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="icon-btn" title="Upload prices from Excel (SKU and Price columns)" aria-label="Upload from Excel">
            <Upload className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-line px-3 py-2 font-normal">SKU</th>
              <th className="border-b border-line px-3 py-2 font-normal">Name</th>
              <th className="border-b border-line px-3 py-2 font-normal">Category</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Cost</th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Last charged</th>
              {!list.isDefault && <th className="border-b border-line px-3 py-2 text-right font-normal">{list.adjustPct !== null ? "From default list" : defaultList?.name ?? "Default"}</th>}
              <th className="w-36 border-b border-line px-3 py-2 text-right font-normal">
                {list.name} price ({currency})
              </th>
              <th className="border-b border-line px-3 py-2 text-right font-normal">Margin</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => {
              const text = edits[i.id] ?? "";
              const inh = inherited(i.id);
              const effective = text.trim() !== "" ? Number(text) : inh;
              const margin = effective && effective > 0 ? (effective - i.cost) / effective : null;
              const dirty = !same(text, i.price);
              return (
                <tr key={i.id} className={dirty ? "bg-[#fff8e1]" : "hover:bg-[#f7f9fb]"}>
                  <td className="border-b border-line px-3 py-1.5 font-mono text-xs">{i.sku}</td>
                  <td className="border-b border-line px-3 py-1.5">
                    {i.name}
                    {i.uom && <span className="text-xs text-muted"> / {i.uom}</span>}
                  </td>
                  <td className="border-b border-line px-3 py-1.5 text-muted">{i.category}</td>
                  <td className="border-b border-line px-3 py-1.5 text-right tabular-nums">{fmt(i.cost)}</td>
                  <td className="border-b border-line px-3 py-1.5 text-right tabular-nums text-muted">{fmt(i.lastPrice)}</td>
                  {!list.isDefault && <td className="border-b border-line px-3 py-1.5 text-right tabular-nums text-muted">{fmt(inh)}</td>}
                  <td className="border-b border-line px-3 py-1">
                    <input
                      aria-label={`${i.sku} price`}
                      type="number"
                      min="0"
                      step="any"
                      value={text}
                      placeholder={inh !== null ? fmt(inh) : ""}
                      onChange={(e) => setEdits((ed) => ({ ...ed, [i.id]: e.target.value }))}
                      className="input w-full text-right"
                    />
                  </td>
                  <td className={clsx("border-b border-line px-3 py-1.5 text-right tabular-nums", margin !== null && margin < 0 && "text-bad", margin !== null && margin >= 0 && margin < 0.15 && "text-warn")}>
                    {margin === null ? "" : `${Math.round(margin * 1000) / 10}%`}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-muted">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-page/95 py-3">
        <p className={clsx("mr-auto text-sm", message ? (message.ok ? "text-ok" : "text-bad") : "text-muted")}>
          {message?.text ??
            `${visible.length} shown. Prices ex GST.${list.isDefault ? "" : " Leave a price blank to use the grey figure from the default list."} Margin = (price − cost) ÷ price; shown here only.`}
        </p>
        {changed.length > 0 && (
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => setEdits(Object.fromEntries(items.map((i) => [i.id, i.price === null ? "" : String(i.price)])))}>
            Discard changes
          </button>
        )}
        <button type="button" onClick={save} disabled={pending || !changed.length} className="btn-primary">
          {pending ? "Saving…" : `Save ${changed.length || ""} change${changed.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
