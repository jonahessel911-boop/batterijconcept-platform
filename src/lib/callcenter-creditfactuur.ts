/**
 * Client-safe detectors voor bel-/opscommissie-creditfacturen.
 * Geen Node/PDF-imports — veilig vanuit CreditfacturenPanel.
 */

/** Belcommissie-CF (Simon e.d.): niet filteren uit Uitbetalingen als “geen sales”. */
export function isBelcommissieCreditfactuur(f: {
  notities?: string | null;
  factuur_nummer?: string | null;
}): boolean {
  const notes = String(f.notities || "");
  if (/Belcommissie/i.test(notes)) return true;
  // Oude rijen: weeknummer + €10-tekst zonder “Belcommissie”
  return (
    /^CF-\d{4}-W\d{2}-/i.test(String(f.factuur_nummer || "")) &&
    /netto ingepland/i.test(notes)
  );
}

/** Opscommissie-CF: niet filteren uit Uitbetalingen als “geen sales”. */
export function isOpsCommissieCreditfactuur(f: {
  notities?: string | null;
  factuur_nummer?: string | null;
}): boolean {
  const notes = String(f.notities || "");
  return (
    /Opscommissie/i.test(notes) ||
    /Weekvergoeding ops/i.test(notes) ||
    /ops-manager/i.test(notes)
  );
}
