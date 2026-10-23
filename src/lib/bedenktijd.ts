import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Wettelijke herroepingstermijn (dagen) na ondertekening. */
export const BEDENKTIJD_DAGEN = 14;

export type BedenktijdInfo = {
  start: Date;
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

/** Bedenktijd vanaf ondertekenmoment: eind = start + 14 dagen. */
export function bedenktijdVanOndertekening(
  ondertekendOp: string | null | undefined,
  now = new Date()
): BedenktijdInfo | null {
  if (!ondertekendOp) return null;
  const start = new Date(ondertekendOp);
  if (Number.isNaN(start.getTime())) return null;
  const eind = new Date(
    start.getTime() + BEDENKTIJD_DAGEN * 24 * 60 * 60 * 1000
  );
  const span = eind.getTime() - start.getTime();
  const pct = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
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
