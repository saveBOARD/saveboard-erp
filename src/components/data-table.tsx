"use client";

import {
  type ColumnDef,
  type FilterFn,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Download, Printer, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Tone = "ok" | "bad" | "pending";

export type Column = {
  key: string;
  label: string;
  kind?: "text" | "number" | "money" | "date" | "bool";
  /** Sum this column in the Total row. */
  total?: boolean;
  /** Link the cell, e.g. "/sell/customers/{id}". */
  href?: string;
  /** For numbers: a row field holding the unit (e.g. "uom"), shown after the value. */
  unitKey?: string;
  /** Highlight negative numbers in red, like Katana's negative stock. */
  negativeAlert?: boolean;
  /** Status cells: value -> colour. */
  tones?: Record<string, Tone>;
  hidden?: boolean;
  width?: number;
};

const fmt = new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 2 });
const fmtMoney = new Intl.NumberFormat("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function display(col: Column, v: Cell, currency: string, row: Row) {
  if (v === null || v === "") return "";
  switch (col.kind) {
    case "money":
      return `${fmtMoney.format(Number(v))} ${currency}`;
    case "number": {
      const unit = col.unitKey ? row[col.unitKey] : null;
      return unit ? `${fmt.format(Number(v))} ${unit}` : fmt.format(Number(v));
    }
    case "bool":
      return v ? "Yes" : "No";
    default:
      return String(v);
  }
}

/** Text: contains (case-insensitive). Numbers: "5", ">5", "<0", ">=10". */
const smartFilter: FilterFn<Row> = (row, columnId, filterValue: string) => {
  const raw = row.getValue(columnId) as Cell;
  const f = filterValue.trim();
  if (!f) return true;
  const m = f.match(/^(>=|<=|>|<|=)\s*(-?[\d.]+)$/);
  if (m && raw !== null && raw !== "" && !isNaN(Number(raw))) {
    const a = Number(raw);
    const b = Number(m[2]);
    return m[1] === ">" ? a > b : m[1] === "<" ? a < b : m[1] === ">=" ? a >= b : m[1] === "<=" ? a <= b : a === b;
  }
  const text = typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw ?? "");
  return text.toLowerCase().includes(f.toLowerCase());
};

export function DataTable({
  columns,
  rows,
  currency = "",
  exportName,
  noun = "items",
}: {
  columns: Column[];
  rows: Row[];
  currency?: string;
  /** Used for the Excel file name and to remember column choices. */
  exportName: string;
  noun?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.key, false])),
  );
  const storageKey = `cols:${exportName}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setVisibility(JSON.parse(saved));
    } catch {}
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibility));
    } catch {}
  }, [storageKey, visibility]);

  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((col) => ({
        id: col.key,
        accessorFn: (r) => r[col.key],
        header: col.label,
        filterFn: smartFilter,
        sortingFn: col.kind === "money" || col.kind === "number" ? "basic" : "alphanumeric",
        sortUndefined: "last",
        meta: col,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visible = table.getVisibleLeafColumns().map((c) => c.columnDef.meta as Column);
  const shown = table.getRowModel().rows;
  const totals = Object.fromEntries(
    visible.filter((c) => c.total).map((c) => [c.key, shown.reduce((s, r) => s + (Number(r.original[c.key]) || 0), 0)]),
  );
  const filtered = shown.length !== rows.length;

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(exportName.slice(0, 31));
    ws.columns = visible.map((c) => ({
      header: c.kind === "money" && currency ? `${c.label} (${currency})` : c.label,
      key: c.key,
      width: Math.max(12, Math.min(50, c.label.length + 4)),
    }));
    ws.getRow(1).font = { bold: true };
    for (const r of shown) {
      ws.addRow(
        Object.fromEntries(
          visible.map((c) => {
            const v = r.original[c.key];
            if ((c.kind === "money" || c.kind === "number") && v !== null && v !== "") return [c.key, Number(v)];
            if (c.kind === "bool") return [c.key, v ? "Yes" : "No"];
            return [c.key, v];
          }),
        ),
      );
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: visible.length } };
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-2">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink">
          {filtered ? (
            <>
              <b>{shown.length.toLocaleString()}</b>/{rows.length.toLocaleString()} {noun} filtered
            </>
          ) : (
            <>
              <b>{rows.length.toLocaleString()}</b> {noun}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={exportExcel} className="icon-btn" title="Export to Excel" aria-label="Export to Excel">
            <Download className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => window.print()} className="icon-btn" title="Print" aria-label="Print">
            <Printer className="h-5 w-5" />
          </button>
          {sorting.length > 0 && (
            <button type="button" onClick={() => setSorting([])} className="btn-secondary ml-1 text-xs">
              Sorted by {columns.find((c) => c.key === sorting[0].id)?.label} ✕
            </button>
          )}
          <details className="relative">
            <summary className="icon-btn cursor-pointer list-none" title="Choose columns" aria-label="Choose columns">
              <Settings2 className="h-5 w-5" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 grid max-h-80 w-60 gap-1 overflow-auto rounded-md bg-surface p-3 text-sm shadow-lg ring-1 ring-line">
              {table.getAllLeafColumns().map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                  {(c.columnDef.meta as Column).label}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {table.getHeaderGroups()[0].headers.map((h) => {
                const col = h.column.columnDef.meta as Column;
                const dir = h.column.getIsSorted();
                const numeric = col.kind === "money" || col.kind === "number";
                return (
                  <th
                    key={h.id}
                    style={col.width ? { minWidth: col.width } : undefined}
                    className={clsx("border-b border-line px-3 pt-2 pb-1 font-normal text-muted", numeric ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={h.column.getToggleSortingHandler()}
                      className={clsx("inline-flex items-center gap-1 whitespace-nowrap hover:text-ink", numeric && "flex-row-reverse")}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : dir === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
            <tr className="no-print">
              {table.getHeaderGroups()[0].headers.map((h) => (
                <th key={h.id} className="border-b border-line px-2 pb-2 font-normal">
                  <input
                    id={`filter-${exportName}-${h.id}`}
                    aria-label={`Filter ${(h.column.columnDef.meta as Column).label}`}
                    placeholder="Filter"
                    value={(h.column.getFilterValue() as string) ?? ""}
                    onChange={(e) => h.column.setFilterValue(e.target.value)}
                    className="w-full min-w-16 rounded border border-line px-2 py-1 text-xs font-normal outline-none focus:border-primary"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.some((c) => c.total) && (
              <tr className="bg-[#eef3f8] font-bold">
                {visible.map((c, i) => (
                  <td key={c.key} className={clsx("border-b border-line px-3 py-2", (c.kind === "money" || c.kind === "number") && "text-right tabular-nums")}>
                    {c.total ? display(c, totals[c.key], currency, {}) : i === 0 ? "Total:" : ""}
                  </td>
                ))}
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-[#f7f9fb]">
                {r.getVisibleCells().map((cell) => {
                  const col = cell.column.columnDef.meta as Column;
                  const v = cell.getValue() as Cell;
                  const numeric = col.kind === "money" || col.kind === "number";
                  const text = display(col, v, currency, r.original);
                  const tone = col.tones && v !== null ? col.tones[String(v)] : undefined;
                  const negative = col.negativeAlert && numeric && Number(v) < 0;
                  const href = col.href?.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(r.original[k] ?? "")));
                  return (
                    <td
                      key={cell.id}
                      className={clsx(
                        "border-b border-line px-3 py-2 align-middle whitespace-nowrap",
                        numeric && "text-right tabular-nums whitespace-nowrap",
                        tone === "ok" && "bg-ok text-center text-white",
                        tone === "bad" && "bg-bad text-center text-white",
                        tone === "pending" && "bg-pending text-center",
                        negative && "bg-bad text-white",
                      )}
                    >
                      {href && text ? (
                        <Link href={href} className={clsx("underline-offset-2 hover:underline", negative ? "text-white" : "text-link")}>
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={visible.length} className="px-3 py-16 text-center text-muted">
                  {rows.length === 0 ? "No rows to show" : "No rows match your filters"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
