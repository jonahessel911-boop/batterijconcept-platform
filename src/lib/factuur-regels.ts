/** Optionele multi-regel factuurregels in notities (niet zichtbaar voor klant). */

export type FactuurPdfRegel = {
  omschrijving: string;
  /** Excl. btw (mag negatief voor verrekening). */
  bedrag_ex_btw: number;
  btw_percentage?: number;
};

const FACTUUR_REGELS_START = "[[FACTUUR_REGELS]]";
const FACTUUR_REGELS_END = "[[/FACTUUR_REGELS]]";

export function encodeFactuurRegels(regels: FactuurPdfRegel[]): string {
  return `${FACTUUR_REGELS_START}${JSON.stringify(regels)}${FACTUUR_REGELS_END}`;
}

export function parseFactuurRegels(
  notities?: string | null
): FactuurPdfRegel[] {
  if (!notities) return [];
  const start = notities.indexOf(FACTUUR_REGELS_START);
  const end = notities.indexOf(FACTUUR_REGELS_END);
  if (start < 0 || end < 0 || end <= start) return [];
  const raw = notities
    .slice(start + FACTUUR_REGELS_START.length, end)
    .trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: FactuurPdfRegel[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      const oms =
        typeof row.omschrijving === "string" ? row.omschrijving.trim() : "";
      const bedrag = Number(row.bedrag_ex_btw);
      if (!oms || !Number.isFinite(bedrag)) continue;
      const pct = Number(row.btw_percentage);
      out.push({
        omschrijving: oms,
        bedrag_ex_btw: Math.round(bedrag * 100) / 100,
        btw_percentage: Number.isFinite(pct) ? pct : 21,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function stripFactuurRegelsBlock(notities?: string | null): string {
  if (!notities) return "";
  return notities
    .replace(
      /\[\[FACTUUR_REGELS\]\][\s\S]*?\[\[\/FACTUUR_REGELS\]\]/g,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
