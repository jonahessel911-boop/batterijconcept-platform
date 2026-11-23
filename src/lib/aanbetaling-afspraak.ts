import { formatDateShort } from "@/lib/format";
import type { MateriaalChecks } from "@/lib/project-inkoop-checklist";

/** Betaalafspraak op de BTW-/aanbetalingsstap (niet in Acties). */
export const AANBETALING_AFSPRAAK_KEY = "__aanbetaling_afspraak";

export type AanbetalingAfspraakSoort = "edwin_wf" | "datum";

export type AanbetalingAfspraak = {
  soort: AanbetalingAfspraakSoort;
  /** yyyy-MM-dd, alleen bij `datum`. */
  datum?: string | null;
  notitie?: string | null;
  at: string;
};

export function parseAanbetalingAfspraak(
  checks: MateriaalChecks | Record<string, unknown> | null | undefined
): AanbetalingAfspraak | null {
  const raw = checks?.[AANBETALING_AFSPRAAK_KEY];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AanbetalingAfspraak>;
    if (parsed.soort !== "edwin_wf" && parsed.soort !== "datum") return null;
    const datum =
      typeof parsed.datum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.datum)
        ? parsed.datum
        : null;
    if (parsed.soort === "datum" && !datum) return null;
    return {
      soort: parsed.soort,
      datum,
      notitie:
        typeof parsed.notitie === "string" && parsed.notitie.trim()
          ? parsed.notitie.trim()
          : null,
      at:
        typeof parsed.at === "string" && parsed.at
          ? parsed.at
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function serializeAanbetalingAfspraak(
  afspraak: AanbetalingAfspraak
): string {
  return JSON.stringify({
    soort: afspraak.soort,
    datum: afspraak.soort === "datum" ? afspraak.datum || null : null,
    notitie: afspraak.notitie?.trim() || null,
    at: afspraak.at,
  });
}

export function aanbetalingAfspraakLabel(
  afspraak: AanbetalingAfspraak
): string {
  if (afspraak.soort === "edwin_wf") {
    return afspraak.notitie
      ? `Betaalt bij Edwin (WF) · ${afspraak.notitie}`
      : "Betaalt bij Edwin als Warmtefonds rond is";
  }
  const wanneer = afspraak.datum
    ? formatDateShort(`${afspraak.datum}T12:00:00`)
    : "afgesproken datum";
  return afspraak.notitie
    ? `Betaalt ${wanneer} · ${afspraak.notitie}`
    : `Betaalt ${wanneer}`;
}
