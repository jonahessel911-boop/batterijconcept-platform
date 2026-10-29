import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Wettelijke herroepingstermijn (kalenderdagen) na ondertekening. */
export const BEDENKTIJD_DAGEN = 14;

/**
 * Eerste dag waarop de annuleringskosten-actie open mag (na bedenktijd).
 * Dag 1 = ondertekeningsdag → dag 15 = ondertekening + 14 kalenderdagen.
 */
export const ANNULERING_ACTIE_DAG = BEDENKTIJD_DAGEN + 1;

export type BedenktijdInfo = {
  start: Date;
  /** Moment waarop bedenktijd voorbij is (= start dag 15, 00:00 Amsterdam). */
  eind: Date;
  klaar: boolean;
  startLabel: string;
  eindLabel: string;
  dagenOver: number;
  pct: number;
};

function formatShort(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "d MMMM yyyy", { locale: nl });
}

function amsterdamYmd(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** 00:00 Amsterdam op die ymd. */
function amsterdamStartOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ);
}

/**
 * Kalenderdag-nummer na ondertekening (dag 1 = ondertekeningsdag),
 * als 00:00 Amsterdam op die dag.
 */
export function dagNaOndertekeningAmsterdam(
  ondertekendOp: string | Date,
  dagNummer: number
): Date | null {
  const start = typeof ondertekendOp === "string" ? new Date(ondertekendOp) : ondertekendOp;
  if (Number.isNaN(start.getTime())) return null;
  const n = Math.max(1, Math.round(dagNummer));
  const signLocal = toZonedTime(start, AMSTERDAM_TZ);
  const signNoon = fromZonedTime(
    new Date(
      signLocal.getFullYear(),
      signLocal.getMonth(),
      signLocal.getDate(),
      12,
      0,
      0,
      0
    ),
    AMSTERDAM_TZ
  );
  const target = addDays(signNoon, n - 1);
  return amsterdamStartOfDay(amsterdamYmd(target));
}

/**
 * Vanaf wanneer de actie «annuleringskosten / installatie doorzetten» open mag:
 * start van dag 15 (Amsterdam), dus ná 14 volle kalenderdagen bedenktijd.
 */
export function annuleringsActieVanaf(
  ondertekendOp: string | null | undefined
): Date | null {
  if (!ondertekendOp) return null;
  return dagNaOndertekeningAmsterdam(ondertekendOp, ANNULERING_ACTIE_DAG);
}

/**
 * Reactietermijn na mail «Keuze: annulering of installatie» (kalenderdagen).
 * Mail belooft: reageer binnen 5 dagen; op dag 6 volgt de annuleringsfactuur.
 */
export const ANNULERING_KEUZE_REACTIE_DAGEN = 5;

/** Dagnummer (dag 1 = verzenddag) waarop BO de keuze controleert / factuur stuurt. */
export const ANNULERING_KEUZE_CONTROLE_DAG =
  ANNULERING_KEUZE_REACTIE_DAGEN + 1;

/**
 * Vanaf wanneer de actie «controleer keuze / annuleringsfactuur» open mag:
 * start van dag 6 na verzending van de keuze-mail (Amsterdam 00:00).
 */
export function annuleringKeuzeControleVanaf(
  mailVerstuurdAt: string | null | undefined
): Date | null {
  if (!mailVerstuurdAt) return null;
  return dagNaOndertekeningAmsterdam(
    mailVerstuurdAt,
    ANNULERING_KEUZE_CONTROLE_DAG
  );
}

/**
 * Bedenktijd vanaf ondertekening.
 * Eind = start van dag 15 (00:00 Amsterdam) = bedenktijd voorbij, actie mag open.
 */
export function bedenktijdVanOndertekening(
  ondertekendOp: string | null | undefined,
  now = new Date()
): BedenktijdInfo | null {
  if (!ondertekendOp) return null;
  const start = new Date(ondertekendOp);
  if (Number.isNaN(start.getTime())) return null;
  const eind = dagNaOndertekeningAmsterdam(start, ANNULERING_ACTIE_DAG);
  if (!eind) return null;
  const span = eind.getTime() - start.getTime();
  const pct =
    span > 0
      ? Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span))
      : 1;
  const klaar = now.getTime() >= eind.getTime();
  const dagenOver = klaar
    ? 0
    : Math.max(
        1,
        Math.ceil((eind.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      );
  return {
    start,
    eind,
    klaar,
    startLabel: formatShort(start),
    eindLabel: formatShort(eind),
    dagenOver,
    pct,
  };
}

export function ondertekendOpVanProject(project: {
  offertes?:
    | { ondertekend_op?: string | null }
    | { ondertekend_op?: string | null }[]
    | null;
}): string | null {
  const raw = project.offertes;
  if (!raw) return null;
  const off = Array.isArray(raw) ? raw[0] : raw;
  return off?.ondertekend_op?.trim() || null;
}
