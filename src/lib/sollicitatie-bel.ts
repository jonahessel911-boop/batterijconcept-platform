import { formatInTimeZone } from "date-fns-tz";
import type { Sollicitatie, SollicitatieStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeSollicitatieStatus } from "@/lib/sollicitatie";

export const SOLLICITATIE_MAX_BELPOGINGEN = 3;

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

/** In bel-queue zolang status nieuw/geen_contact en < 3 pogingen. */
export function isSollicitatieBelbaar(s: Sollicitatie): boolean {
  const st = normalizeSollicitatieStatus(s.status);
  if (!QUEUE_STATUSES.has(st)) return false;
  if (sollicitatieBelpogingenOf(s) >= SOLLICITATIE_MAX_BELPOGINGEN) return false;
  const tel = (s.telefoon || "").replace(/\D/g, "");
  return tel.length >= 8;
}

export function buildSollicitatieGeenContactPatch(
  s: Pick<Sollicitatie, "belpogingen" | "belpogingen_vandaag" | "laatst_gebeld_at">
): {
  patch: {
    status: "geen_contact" | "definitief_geen_contact";
    belpogingen: number;
    belpogingen_vandaag: number;
    laatst_gebeld_at: string;
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
    },
    pogingen,
    definitief,
    sendGeenContactMail: pogingen === 1 || pogingen === 3,
  };
}

/** Sortering: nieuwste aanmeldingen eerst (niet oudste). */
export function sortSollicitatieBelQueue(list: Sollicitatie[]): Sollicitatie[] {
  return [...list].filter(isSollicitatieBelbaar).sort((a, b) => {
    const ca = new Date(a.created_at).getTime();
    const cb = new Date(b.created_at).getTime();
    if (ca !== cb) return cb - ca; // nieuwste vooraan
    const pa = sollicitatieBelpogingenOf(a);
    const pb = sollicitatieBelpogingenOf(b);
    if (pa !== pb) return pa - pb;
    const sa = normalizeSollicitatieStatus(a.status);
    const sb = normalizeSollicitatieStatus(b.status);
    if (sa !== sb) return sa === "nieuw" ? -1 : 1;
    return 0;
  });
}
