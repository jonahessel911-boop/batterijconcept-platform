/**
 * Dagelijkse “Vandaag”-snapshot voor het stuurdashboard.
 */

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  afspraakBlokkeertAgenda,
  afspraakIsAfgelopen,
  isAfgeboekteFysiekeAfspraak,
  isSaleUitkomst,
  needsVervolgPunt,
} from "@/lib/afspraak-soort";
import { inIsoRange, round2 } from "@/lib/management-dashboard/periods";
import type { DashboardV2Raw } from "./build";

const TZ = "Europe/Amsterdam";

export type VandaagSaleRoute = "warmtefonds" | "buijv";

function saleRouteFor(
  leadStatus: string | null,
  financieringVoorbehoud: boolean | null | undefined
): VandaagSaleRoute {
  if (leadStatus === "sale_eigen_middelen") return "buijv";
  if (leadStatus === "sale_financiering") return "warmtefonds";
  return financieringVoorbehoud ? "warmtefonds" : "buijv";
}

export type VandaagAfspraakRow = {
  id: string;
  start_at: string;
  end_at: string | null;
  adviseur_id: string | null;
  adviseur_naam: string;
  lead_id: string;
  lead_naam: string | null;
  lead_number: string | null;
  lead_plaats: string | null;
  /** Lead-status = afboekuitkomst na checkout */
  lead_status: string | null;
  status: string;
  /** gelopen | te_lopen | niet_afgeboekt */
  bucket: "gelopen" | "te_lopen" | "niet_afgeboekt";
  /** Warmtefonds vs Buijv (eigen middelen), alleen bij sale/deal */
  sale_route: VandaagSaleRoute | null;
  /** Getekende orderwaarde ex btw, indien offerte bekend */
  orderwaarde_ex_btw: number | null;
};

export type VandaagVerkoperRow = {
  id: string;
  naam: string;
  sales: number;
  omzet: number;
  afsprakenGelopen: number;
  afsprakenTeLopen: number;
  afsprakenNietAfgeboekt: number;
  /** Sales / gelopen afspraken (incl. niet afgeboekt). Procent, 1 decimaal. */
  salesConversiePct: number | null;
};

/** Rollende dagen óf kalendermaand-presets */
export type VandaagPeriode =
  | 1
  | 3
  | 7
  | 14
  | "this_month"
  | "prev_month";

/** @deprecated gebruik VandaagPeriode */
export type VandaagDagen = VandaagPeriode;

export type DashboardV2Vandaag = {
  dateLabel: string;
  /** YYYY-MM-DD Amsterdam (einddatum van bereik) */
  dateKey: string;
  /** Gekozen periode-preset */
  periode: VandaagPeriode;
  /** Aantal kalenderdagen in het bereik */
  days: number;
  /** YYYY-MM-DD Amsterdam startdatum van het bereik */
  fromKey: string;
  offertesVerstuurd: number;
  orders: number;
  orderwaarde: number;
  leads: number;
  leadsIngepland: number;
  afsprakenGelopen: number;
  afsprakenTeLopen: number;
  afsprakenNietAfgeboekt: number;
  /**
   * Sales-conversie van gelopen afspraken =
   * sales-uitkomst / (gelopen + niet afgeboekt). Procent, 1 decimaal.
   */
  salesConversiePct: number | null;
  verkopers: VandaagVerkoperRow[];
  afspraken: VandaagAfspraakRow[];
};

export type VandaagRaw = {
  leads: DashboardV2Raw["leads"];
  afspraken: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    start_at: string;
    end_at?: string | null;
    created_at: string | null;
    status: string;
    soort: string | null;
    lead_naam?: string | null;
    lead_number?: string | null;
    lead_plaats?: string | null;
    lead_status?: string | null;
  }[];
  /** Getekende (en evt. geannuleerde) offertes */
  offertes: DashboardV2Raw["offertes"];
  /** Verzonden/ondertekende offertes voor “offertes verstuurd” */
  offertesVerzonden: {
    id: string;
    adviseur_id: string | null;
    /** Echte verstuurdatum; anders created_at als legacy-proxy */
    verzonden_op: string | null;
    created_at: string;
  }[];
  adviseurs: DashboardV2Raw["adviseurs"];
};

function amsEndOfDay(d: Date): Date {
  const z = toZonedTime(d, TZ);
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate(), 23, 59, 59, 999),
    TZ
  );
}

function dayKey(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

function dateLabelNl(d: Date): string {
  return formatInTimeZone(d, TZ, "EEEE d MMMM yyyy");
}

function rangeLabelNl(
  start: Date,
  end: Date,
  periode: VandaagPeriode
): string {
  if (periode === 1) return dateLabelNl(end);
  if (periode === "this_month" || periode === "prev_month") {
    return formatInTimeZone(start, TZ, "MMMM yyyy");
  }
  const startDay = formatInTimeZone(start, TZ, "d");
  const endFull = formatInTimeZone(end, TZ, "d MMMM yyyy");
  const startMonth = formatInTimeZone(start, TZ, "MMMM");
  const endMonth = formatInTimeZone(end, TZ, "MMMM");
  const startYear = formatInTimeZone(start, TZ, "yyyy");
  const endYear = formatInTimeZone(end, TZ, "yyyy");
  if (startMonth === endMonth && startYear === endYear) {
    return `${startDay} – ${endFull}`;
  }
  if (startYear === endYear) {
    return `${formatInTimeZone(start, TZ, "d MMMM")} – ${endFull}`;
  }
  return `${formatInTimeZone(start, TZ, "d MMMM yyyy")} – ${endFull}`;
}

function actieveAfspraak(status: string): boolean {
  return (
    status === "gepland" ||
    status === "bevestigd" ||
    status === "verzet" ||
    status === "voltooid"
  );
}

export function parseVandaagDagen(raw: string | null): VandaagPeriode {
  const key = (raw || "").trim().toLowerCase();
  if (key === "this_month" || key === "deze_maand") return "this_month";
  if (key === "prev_month" || key === "vorige_maand" || key === "last_month")
    return "prev_month";
  const n = Number(raw);
  if (n === 3 || n === 7 || n === 14) return n;
  return 1;
}

/** @deprecated alias */
export const parseVandaagPeriode = parseVandaagDagen;

export function resolveVandaagRange(
  now: Date,
  periode: VandaagPeriode
): {
  start: Date;
  end: Date;
  dateKey: string;
  fromKey: string;
  days: number;
} {
  const zNow = toZonedTime(now, TZ);
  if (periode === "this_month") {
    const startLocal = new Date(zNow.getFullYear(), zNow.getMonth(), 1, 0, 0, 0, 0);
    const start = fromZonedTime(startLocal, TZ);
    const end = amsEndOfDay(now);
    return {
      start,
      end,
      dateKey: dayKey(end),
      fromKey: dayKey(start),
      days: zNow.getDate(),
    };
  }
  if (periode === "prev_month") {
    const startLocal = new Date(
      zNow.getFullYear(),
      zNow.getMonth() - 1,
      1,
      0,
      0,
      0,
      0
    );
    const endLocal = new Date(
      zNow.getFullYear(),
      zNow.getMonth(),
      0,
      23,
      59,
      59,
      999
    );
    const start = fromZonedTime(startLocal, TZ);
    const end = fromZonedTime(endLocal, TZ);
    return {
      start,
      end,
      dateKey: dayKey(end),
      fromKey: dayKey(start),
      days: endLocal.getDate(),
    };
  }
  const days = periode;
  const startLocal = new Date(
    zNow.getFullYear(),
    zNow.getMonth(),
    zNow.getDate() - (days - 1),
    0,
    0,
    0,
    0
  );
  const start = fromZonedTime(startLocal, TZ);
  const end = amsEndOfDay(now);
  return {
    start,
    end,
    dateKey: dayKey(end),
    fromKey: dayKey(start),
    days,
  };
}

/**
 * Bouwt het vandaag-overzicht (Amsterdam-kalenderdag of rollend bereik / maand).
 */
export function buildDashboardV2Vandaag(
  raw: VandaagRaw,
  now = new Date(),
  personId?: string | null,
  periode: VandaagPeriode = 1
): DashboardV2Vandaag {
  const { start, end, dateKey, fromKey, days } = resolveVandaagRange(
    now,
    periode
  );

  const naamById = new Map(raw.adviseurs.map((a) => [a.id, a.naam]));
  const leadStatusById = new Map(
    raw.leads.map((l) => [l.id, l.status ?? null])
  );

  let leads = raw.leads.filter((l) =>
    inIsoRange(l.created_at, start, end)
  );
  let afsprakenAll = raw.afspraken;
  let offertes = raw.offertes;
  let offertesVerzonden = raw.offertesVerzonden;

  if (personId) {
    leads = leads.filter((l) => l.adviseur_id === personId);
    afsprakenAll = afsprakenAll.filter((a) => a.adviseur_id === personId);
    offertes = offertes.filter((o) => o.adviseur_id === personId);
    offertesVerzonden = offertesVerzonden.filter(
      (o) => o.adviseur_id === personId
    );
  }

  const leadsIngepland = afsprakenAll.filter((a) => {
    if (!afspraakBlokkeertAgenda(a.soort)) return false;
    if (a.status === "geannuleerd") return false;
    const at = a.created_at || a.start_at;
    return inIsoRange(at, start, end);
  }).length;

  // Alleen echt verstuurde offertes vandaag — niet updated_at, niet onderteken-datum
  const verstuurdIds = new Set<string>();
  for (const o of offertesVerzonden) {
    const at = o.verzonden_op || o.created_at;
    if (inIsoRange(at, start, end)) verstuurdIds.add(o.id);
  }

  let orders = 0;
  let orderwaarde = 0;
  const salesByAdv = new Map<string, { sales: number; omzet: number }>();

  for (const o of offertes) {
    const at = o.ondertekend_op;
    if (!at || !inIsoRange(at, start, end)) continue;
    if (o.geannuleerd) continue;
    orders += 1;
    const bedrag = Number(o.subtotaal_ex_btw) || 0;
    orderwaarde += bedrag;
    const aid = o.adviseur_id || "__geen__";
    const cur = salesByAdv.get(aid) || { sales: 0, omzet: 0 };
    cur.sales += 1;
    cur.omzet += bedrag;
    salesByAdv.set(aid, cur);
  }

  const vandaagAfspraken = afsprakenAll.filter((a) => {
    if (!afspraakBlokkeertAgenda(a.soort)) return false;
    if (a.status === "geannuleerd") return false;
    if (!actieveAfspraak(a.status) && a.status !== "voltooid") return false;
    return inIsoRange(a.start_at, start, end);
  });

  /** Per lead: meest recente niet-geannuleerde getekende offerte */
  const offerteByLead = new Map<
    string,
    {
      subtotaal_ex_btw: number;
      financiering_voorbehoud: boolean | null;
      at: number;
    }
  >();
  for (const o of offertes) {
    if (o.geannuleerd || !o.ondertekend_op) continue;
    const at = new Date(o.ondertekend_op).getTime();
    if (!Number.isFinite(at)) continue;
    const prev = offerteByLead.get(o.lead_id);
    if (prev && at < prev.at) continue;
    offerteByLead.set(o.lead_id, {
      subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
      financiering_voorbehoud: o.financiering_voorbehoud ?? null,
      at,
    });
  }

  const afspraakRows: VandaagAfspraakRow[] = [];
  const afspraakCountsByAdv = new Map<
    string,
    { gelopen: number; te_lopen: number; niet_afgeboekt: number }
  >();

  for (const a of vandaagAfspraken) {
    const leadStatus =
      a.lead_status ?? leadStatusById.get(a.lead_id) ?? null;
    const endAt = a.end_at || a.start_at;
    const afspraakShape = {
      id: a.id,
      lead_id: a.lead_id,
      status: a.status,
      soort: a.soort,
      start_at: a.start_at,
      end_at: endAt,
    };
    const gelopen = afspraakIsAfgelopen(
      {
        status: a.status as "gepland" | "bevestigd" | "verzet" | "geannuleerd" | "voltooid",
        start_at: a.start_at,
        end_at: endAt,
      },
      now
    );
    const nietAfgeboekt =
      gelopen &&
      needsVervolgPunt(
        afspraakShape as Parameters<typeof needsVervolgPunt>[0],
        afsprakenAll as Parameters<typeof needsVervolgPunt>[1],
        now,
        leadStatus
      );
    const afgeboekt =
      gelopen &&
      isAfgeboekteFysiekeAfspraak(
        afspraakShape,
        afsprakenAll,
        leadStatus,
        now
      );

    let bucket: VandaagAfspraakRow["bucket"];
    if (!gelopen) bucket = "te_lopen";
    else if (nietAfgeboekt || !afgeboekt) bucket = "niet_afgeboekt";
    else bucket = "gelopen";

    const aid = a.adviseur_id || "__geen__";
    const cnt = afspraakCountsByAdv.get(aid) || {
      gelopen: 0,
      te_lopen: 0,
      niet_afgeboekt: 0,
    };
    if (bucket === "te_lopen") cnt.te_lopen += 1;
    else if (bucket === "niet_afgeboekt") cnt.niet_afgeboekt += 1;
    else cnt.gelopen += 1;
    afspraakCountsByAdv.set(aid, cnt);

    const offerte = offerteByLead.get(a.lead_id) ?? null;
    const isSale =
      isSaleUitkomst(
        leadStatus as
          | "sale_financiering"
          | "sale_eigen_middelen"
          | ""
          | null
          | undefined
      ) || leadStatus === "deal";
    let sale_route: VandaagSaleRoute | null = null;
    let orderwaarde_ex_btw: number | null = null;
    if (isSale) {
      sale_route = saleRouteFor(
        leadStatus,
        offerte?.financiering_voorbehoud ?? null
      );
      if (offerte) orderwaarde_ex_btw = round2(offerte.subtotaal_ex_btw);
    }

    afspraakRows.push({
      id: a.id,
      start_at: a.start_at,
      end_at: a.end_at ?? null,
      adviseur_id: a.adviseur_id,
      adviseur_naam: a.adviseur_id
        ? naamById.get(a.adviseur_id) || "Onbekend"
        : "—",
      lead_id: a.lead_id,
      lead_naam: a.lead_naam ?? null,
      lead_number: a.lead_number ?? null,
      lead_plaats: a.lead_plaats ?? null,
      lead_status: leadStatus,
      status: a.status,
      bucket,
      sale_route,
      orderwaarde_ex_btw,
    });
  }

  afspraakRows.sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  );

  const afsprakenGelopen = afspraakRows.filter(
    (a) => a.bucket === "gelopen"
  ).length;
  const afsprakenTeLopen = afspraakRows.filter(
    (a) => a.bucket === "te_lopen"
  ).length;
  const afsprakenNietAfgeboekt = afspraakRows.filter(
    (a) => a.bucket === "niet_afgeboekt"
  ).length;

  /** Gelopen = afgelopen huisbezoek (afgeboekt of nog open). */
  const gelopenTotaal = afsprakenGelopen + afsprakenNietAfgeboekt;
  const salesVanGelopen = afspraakRows.filter(
    (a) => a.bucket !== "te_lopen" && a.sale_route != null
  ).length;
  const salesConversiePct =
    gelopenTotaal > 0
      ? Math.round((salesVanGelopen / gelopenTotaal) * 1000) / 10
      : null;

  const salesVanGelopenByAdv = new Map<string, number>();
  for (const a of afspraakRows) {
    if (a.bucket === "te_lopen" || a.sale_route == null) continue;
    const aid = a.adviseur_id || "__geen__";
    salesVanGelopenByAdv.set(aid, (salesVanGelopenByAdv.get(aid) || 0) + 1);
  }

  const verkoperIds = new Set<string>();
  for (const id of salesByAdv.keys()) {
    if (id !== "__geen__") verkoperIds.add(id);
  }
  for (const id of afspraakCountsByAdv.keys()) {
    if (id !== "__geen__") verkoperIds.add(id);
  }
  for (const a of raw.adviseurs) {
    if (!a.actief) continue;
    const rol = (a.rol || "adviseur").toLowerCase();
    if (rol === "adviseur" || rol === "admin") verkoperIds.add(a.id);
  }

  const verkopers: VandaagVerkoperRow[] = [...verkoperIds]
    .map((id) => {
      const sales = salesByAdv.get(id) || { sales: 0, omzet: 0 };
      const af = afspraakCountsByAdv.get(id) || {
        gelopen: 0,
        te_lopen: 0,
        niet_afgeboekt: 0,
      };
      const gelopenAdv = af.gelopen + af.niet_afgeboekt;
      const salesAdv = salesVanGelopenByAdv.get(id) || 0;
      return {
        id,
        naam: naamById.get(id) || "Onbekend",
        sales: sales.sales,
        omzet: round2(sales.omzet),
        afsprakenGelopen: af.gelopen,
        afsprakenTeLopen: af.te_lopen,
        afsprakenNietAfgeboekt: af.niet_afgeboekt,
        salesConversiePct:
          gelopenAdv > 0
            ? Math.round((salesAdv / gelopenAdv) * 1000) / 10
            : null,
      };
    })
    .filter(
      (v) =>
        v.sales > 0 ||
        v.omzet > 0 ||
        v.afsprakenGelopen > 0 ||
        v.afsprakenTeLopen > 0 ||
        v.afsprakenNietAfgeboekt > 0
    )
    .sort((a, b) => b.omzet - a.omzet || b.sales - a.sales);

  return {
    dateLabel: rangeLabelNl(start, end, periode),
    dateKey,
    periode,
    days,
    fromKey,
    offertesVerstuurd: verstuurdIds.size,
    orders,
    orderwaarde: round2(orderwaarde),
    leads: leads.length,
    leadsIngepland,
    afsprakenGelopen,
    afsprakenTeLopen,
    afsprakenNietAfgeboekt,
    salesConversiePct,
    verkopers,
    afspraken: afspraakRows,
  };
}
