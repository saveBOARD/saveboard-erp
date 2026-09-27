/**
 * Katana exports some non-English characters double-encoded ("ManawatÅ«" for "Manawatū", "Ã©" for "é",
 * a stray "Â" before a non-breaking space). This turns them back into the real characters.
 * Text that is already correct is returned unchanged.
 */
export function fixMojibake(s: string): string {
  if (!/[ÃÂÅÄâ]/.test(s)) return s;
  // only attempt the byte-level repair when every character fits in one byte (true for mojibake)
  if ([...s].every((ch) => ch.charCodeAt(0) <= 0xff)) {
    const repaired = Buffer.from(s, "latin1").toString("utf8");
    if (!repaired.includes("�")) return repaired.replace(/ /g, " ").trim();
  }
  // leftover lone "Â" (from a non-breaking space whose second byte was lost)
  return s.replace(/Â(?=\s|$)/g, "").replace(/ /g, " ").trim();
}
