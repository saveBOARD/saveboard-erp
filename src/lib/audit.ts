/** { field: { from, to } } for every field whose value changed — what gets stored in audit_log.changes. */
export function diff<T extends Record<string, unknown>>(before: Partial<T>, after: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    const norm = (v: unknown) => (v === null ? null : typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));
    if (norm(a) !== norm(b)) out[k] = { from: a, to: b };
  }
  return out;
}

/** Trimmed text from a form field, or null when empty. */
export function formText(fd: FormData, key: string, max = 2000) {
  const v = String(fd.get(key) ?? "").trim();
  return v ? v.slice(0, max) : null;
}

/** Number from a form field, or null when empty. Throws on garbage so the user sees a clear message. */
export function formNumber(fd: FormData, key: string, label: string) {
  const raw = String(fd.get(key) ?? "").trim().replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}
