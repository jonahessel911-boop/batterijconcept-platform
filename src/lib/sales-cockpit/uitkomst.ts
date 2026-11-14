import { afspraakVereistAfboeking } from "@/lib/afspraak-soort";
import { leadStatusLabel } from "@/lib/labels";
import type { LeadStatus } from "@/types/database";
import type { AfboekInfo, PogingKlasse, RawAfspraak } from "@/lib/sales-cockpit/model";
import { ymdOfInstant } from "@/lib/sales-cockpit/weeks";

export type RawStatusEvent = {
  id: string;
  lead_id: string;
  titel: string;
  detail: string | null;
  created_at: string;
};

const LABEL_NAAR_STATUS = new Map<string, LeadStatus>(
  (Object.entries(leadStatusLabel) as [LeadStatus, string][]).map(([status, label]) => [label, status])
);

const GELOPEN = new Set<LeadStatus>([
  "vervolg_fysiek",
  "vervolg_tel",
  "vervolg_geen_contact",
  "offerte_afgewezen",
  "geen_interesse",
  "geen_interesse_al_batterij",
  "geen_interesse_plugin",
  "geen_interesse_alleen_info",
  "geen_interesse_vertrouwt_niet",
  "niet_gekwalificeerd",
  "huurwoning",
  "sale_financiering",
  "sale_eigen_middelen",
  "deal",
]);

export function isAfboekDetail(detail: string | null | undefined): boolean {
  const text = detail || "";
  return text.startsWith("Via afboek") || text.startsWith("Via actiepunten na afspraak");
}

export function statusUitTitel(titel: string): LeadStatus | null {
  if (!titel.startsWith("Status → ")) return null;
  return LABEL_NAAR_STATUS.get(titel.slice("Status → ".length)) || null;
}

export function klasseVanUitkomst(status: LeadStatus): PogingKlasse {
  if (status === "deur_niet_open") return "deur_dicht";
  if (status === "afspraak_afgezegd_klant") return "afgezegd";
  if (GELOPEN.has(status)) return "gesprek";
  return "onbekend";
}

function openTraject(status: LeadStatus): boolean {
  return status === "vervolg_fysiek" || status === "vervolg_tel";
}

/** Koppel een afboekregel aan de vroegste nog open afspraak van die lead vóór dat tijdstip. */
export function koppelAfboekingen(
  afspraken: RawAfspraak[],
  events: RawStatusEvent[]
): Map<string, AfboekInfo> {
  const out = new Map<string, AfboekInfo>();
  const byLead = new Map<string, RawAfspraak[]>();
  for (const a of afspraken) {
    if (!a.lead_id || a.status === "geannuleerd" || !afspraakVereistAfboeking(a.soort)) continue;
    const list = byLead.get(a.lead_id) || [];
    list.push(a);
    byLead.set(a.lead_id, list);
  }
  for (const list of byLead.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));

  const gebruikt = new Set<string>();
  const afboek = events
    .filter((e) => e.lead_id && isAfboekDetail(e.detail) && statusUitTitel(e.titel))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const event of afboek) {
    const status = statusUitTitel(event.titel)!;
    const at = new Date(event.created_at).getTime();
    if (Number.isNaN(at)) continue;
    const kandidaat = (byLead.get(event.lead_id) || []).find((a) => {
      if (gebruikt.has(a.id)) return false;
      const start = new Date(a.start_at).getTime();
      return !Number.isNaN(start) && at + 2 * 60 * 60 * 1000 >= start;
    });
    if (!kandidaat) continue;
    gebruikt.add(kandidaat.id);
    const dag = ymdOfInstant(kandidaat.start_at);
    const ymd = ymdOfInstant(event.created_at);
    out.set(kandidaat.id, {
      at: event.created_at,
      ymd: ymd || "",
      status,
      opTijd: dag && ymd ? ymd <= dag : null,
      openTraject: openTraject(status),
    });
  }
  return out;
}

export type AfboekRegel = {
  afspraakId: string;
  leadId: string;
  adviseurId: string | null;
  dag: string;
  tijdBekend: boolean;
  opTijd: boolean;
  teLaat: boolean;
  zonderTijd: boolean;
  vandaagOpen: boolean;
  nogNietAfgeboekt: boolean;
};

export function bouwAfboekRegels(
  afspraken: RawAfspraak[],
  koppeling: Map<string, AfboekInfo>,
  today: string
): AfboekRegel[] {
  const regels: AfboekRegel[] = [];
  for (const a of afspraken) {
    if (!a.lead_id || a.status === "geannuleerd" || !afspraakVereistAfboeking(a.soort)) continue;
    const dag = ymdOfInstant(a.start_at);
    if (!dag) continue;
    const info = koppeling.get(a.id) || null;
    const toekomst = dag > today;
    if (toekomst && !info) continue;
    const vandaag = dag === today;
    regels.push({
      afspraakId: a.id,
      leadId: a.lead_id,
      adviseurId: a.adviseur_id,
      dag,
      tijdBekend: Boolean(info),
      opTijd: Boolean(info?.opTijd),
      teLaat: Boolean(info && info.opTijd === false),
      zonderTijd: !info && dag < today,
      vandaagOpen: !info && vandaag,
      nogNietAfgeboekt: !info && dag <= today,
    });
  }
  return regels;
}
