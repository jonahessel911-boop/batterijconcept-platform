import { formatInTimeZone } from "date-fns-tz";
import type { Sollicitatie, SollicitatieStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeSollicitatieStatus } from "@/lib/sollicitatie";

export const SOLLICITATIE_MAX_BELPOGINGEN = 3;

/** Alleen recruitment-belqueue — nooit sales/callcenter (die werkt op leads). */
const QUEUE_STATUSES = new Set<SollicitatieStatus>(["nieuw", "geen_contact"]);

export function sollicitatieBelpogingenOf(
  s: Pick<Sollicitatie, "belpogingen">
): number {
  return Math.max(0, Number(s.belpogingen) || 0);
}

function amsterdamDayKey(d: Date | string): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

export function sollicitatieBelpogingenVandaagOf(
  s: Pick<Sollicitatie, "laatst_gebeld_at" | "belpogingen_vandaag">
): number {
  if (!s.laatst_gebeld_at) return 0;
  if (amsterdamDayKey(s.laatst_gebeld_at) !== amsterdamDayKey(new Date())) {
    return 0;
  }
  const n = Number(s.belpogingen_vandaag);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

export function sollicitatieGeenContactLabel(pogingen: number): string {
  const n = Math.min(
    Math.max(pogingen, 0),
    SOLLICITATIE_MAX_BELPOGINGEN
  );
  return `Geen contact ${n}/${SOLLICITATIE_MAX_BELPOGINGEN}`;
}

export function sollicitatieTerugbelAt(
  s: Pick<Sollicitatie, "terugbel_at">
): Date | null {
  if (!s.terugbel_at) return null;
  const d = new Date(s.terugbel_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Terugbel is aan de beurt (nu of eerder). */
export function isSollicitatieTerugbelDue(
  s: Pick<Sollicitatie, "status" | "terugbel_at">,
  now = new Date()
): boolean {
  if (normalizeSollicitatieStatus(s.status) !== "terugbelafspraak") return false;
  const at = sollicitatieTerugbelAt(s);
  if (!at) return true;
  return at.getTime() <= now.getTime();
}

/** In bel-queue: nieuw of geen_contact (< 3 pogingen). Geen terugbelafspraken. */
export function isSollicitatieBelbaar(s: Sollicitatie): boolean {
  const st = normalizeSollicitatieStatus(s.status);
  if (!QUEUE_STATUSES.has(st)) return false;
  const tel = (s.telefoon || "").replace(/\D/g, "");
  if (tel.length < 8) return false;
  if (sollicitatieBelpogingenOf(s) >= SOLLICITATIE_MAX_BELPOGINGEN) return false;
  return true;
}

export function buildSollicitatieGeenContactPatch(
  s: Pick<Sollicitatie, "belpogingen" | "belpogingen_vandaag" | "laatst_gebeld_at">
): {
  patch: {
    status: "geen_contact" | "definitief_geen_contact";
    belpogingen: number;
    belpogingen_vandaag: number;
    laatst_gebeld_at: string;
    terugbel_at: null;
    terugbel_notitie: null;
  };
  pogingen: number;
  definitief: boolean;
  /** Mail bij poging 1 en 3. */
  sendGeenContactMail: boolean;
} {
  const pogingen = Math.min(
    sollicitatieBelpogingenOf(s) + 1,
    SOLLICITATIE_MAX_BELPOGINGEN
  );
  const vandaag = Math.min(sollicitatieBelpogingenVandaagOf(s) + 1, 1);
  const definitief = pogingen >= SOLLICITATIE_MAX_BELPOGINGEN;
  return {
    patch: {
      status: definitief ? "definitief_geen_contact" : "geen_contact",
      belpogingen: pogingen,
      belpogingen_vandaag: vandaag,
      laatst_gebeld_at: new Date().toISOString(),
      terugbel_at: null,
      terugbel_notitie: null,
    },
    pogingen,
    definitief,
    sendGeenContactMail: pogingen === 1 || pogingen === 3,
  };
}

/**
 * Sortering recruitment-belqueue:
 * 1) nog niet gebeld (0 pogingen) — nieuwste eerst
 * 2) daarna geen-contact retries (1, dan 2) — nieuwste eerst
 * Terugbelafspraken komen hier niet in.
 */
export function sortSollicitatieBelQueue(list: Sollicitatie[]): Sollicitatie[] {
  return [...list].filter(isSollicitatieBelbaar).sort((a, b) => {
    const pa = sollicitatieBelpogingenOf(a);
    const pb = sollicitatieBelpogingenOf(b);
    if (pa !== pb) return pa - pb;

    const ca = new Date(a.created_at).getTime();
    const cb = new Date(b.created_at).getTime();
    if (ca !== cb) return cb - ca;

    const sa = normalizeSollicitatieStatus(a.status);
    const sb = normalizeSollicitatieStatus(b.status);
    if (sa !== sb) return sa === "nieuw" ? -1 : 1;
    return 0;
  });
}
