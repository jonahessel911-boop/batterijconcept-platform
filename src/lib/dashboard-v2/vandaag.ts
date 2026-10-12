/**
 * Dagelijkse “Vandaag”-snapshot voor het stuurdashboard.
 */

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  afspraakBlokkeertAgenda,
  afspraakIsAfgelopen,
  isAfgeboekteFysiekeAfspraak,
  needsVervolgPunt,
} from "@/lib/afspraak-soort";
import { inIsoRange, round2 } from "@/lib/management-dashboard/periods";
import type { DashboardV2Raw } from "./build";

const TZ = "Europe/Amsterdam";

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
  status: string;
  /** gelopen | te_lopen | niet_afgeboekt */
  bucket: "gelopen" | "te_lopen" | "niet_afgeboekt";
};

export type VandaagVerkoperRow = {
  id: string;
  naam: string;
  sales: number;
  omzet: number;
  afsprakenGelopen: number;
  afsprakenTeLopen: number;
  afsprakenNietAfgeboekt: number;
};

export type DashboardV2Vandaag = {
  dateLabel: string;
  /** YYYY-MM-DD Amsterdam */
  dateKey: string;
  offertesVerstuurd: number;
  orders: number;
  orderwaarde: number;
  leads: number;
  leadsIngepland: number;
  afsprakenGelopen: number;
  afsprakenTeLopen: number;
  afsprakenNietAfgeboekt: number;
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
  /** Verzonden offertes (status=verzonden) met updated_at */
  offertesVerzonden: {
    id: string;
    adviseur_id: string | null;
    updated_at: string;
    created_at: string;
  }[];
  adviseurs: DashboardV2Raw["adviseurs"];
};

function amsStartOfDay(d: Date): Date {
  const z = toZonedTime(d, TZ);
  return fromZonedTime(
    new Date(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0),
    TZ
  );
}

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

function actieveAfspraak(status: string): boolean {
  return (
    status === "gepland" ||
    status === "bevestigd" ||
    status === "verzet" ||
    status === "voltooid"
  );
}

/**
 * Bouwt het vandaag-overzicht (Amsterdam-kalenderdag).
 */
export function buildDashboardV2Vandaag(
  raw: VandaagRaw,
  now = new Date(),
  personId?: string | null
): DashboardV2Vandaag {
  const start = amsStartOfDay(now);
  const end = amsEndOfDay(now);
  const dateKey = dayKey(now);

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

  const verstuurdIds = new Set<string>();
  for (const o of offertesVerzonden) {
    if (inIsoRange(o.updated_at || o.created_at, start, end)) {
      verstuurdIds.add(o.id);
    }
  }
  for (const o of offertes) {
    if (o.geannuleerd) continue;
    const at = o.ondertekend_op;
    if (at && inIsoRange(at, start, end)) verstuurdIds.add(o.id);
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
      status: a.status,
      bucket,
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
      return {
        id,
        naam: naamById.get(id) || "Onbekend",
        sales: sales.sales,
        omzet: round2(sales.omzet),
        afsprakenGelopen: af.gelopen,
        afsprakenTeLopen: af.te_lopen,
        afsprakenNietAfgeboekt: af.niet_afgeboekt,
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
    dateLabel: dateLabelNl(now),
    dateKey,
    offertesVerstuurd: verstuurdIds.size,
    orders,
    orderwaarde: round2(orderwaarde),
    leads: leads.length,
    leadsIngepland,
    afsprakenGelopen,
    afsprakenTeLopen,
    afsprakenNietAfgeboekt,
    verkopers,
    afspraken: afspraakRows,
  };
}
