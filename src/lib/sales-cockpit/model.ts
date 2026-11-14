import { aanbetalingVanOrder, isAanbetalingFactuurOmschrijving, isRestantFactuurOmschrijving } from "@/lib/aanbetaling";
import {
  afblokKey,
  calendarDaysInclusive,
  isSlotGeblokkeerd,
} from "@/lib/adviseur-beschikbaarheid";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { ADVISEUR_SLOT_HOURS } from "@/lib/slots";
import { normalizeProjectStatus } from "@/lib/labels";
import type { CockpitSettings } from "@/lib/sales-cockpit/settings";
import {
  addYmd,
  weekBounds,
  weekKeyOfInstant,
  weeksBetween,
  ymdOfInstant,
} from "@/lib/sales-cockpit/weeks";

export type RawAdviseur = {
  id: string;
  naam: string;
  actief: boolean;
  rol: string | null;
  email?: string | null;
  startdatum: string | null;
  commissie_pct: number | null;
};

export type RawAfspraak = {
  id: string;
  lead_id: string;
  adviseur_id: string | null;
  start_at: string;
  status: string;
  soort: string | null;
  ingepland_door_id: string | null;
};

export type RawOfferte = {
  id: string;
  lead_id: string;
  status: string;
  ondertekend_op: string | null;
  subtotaal_ex_btw: number | null;
  btw_bedrag: number | null;
  totaal_inc_btw: number | null;
  financiering_voorbehoud: boolean | null;
  aanbetaling_modus: string | null;
  aanbetaling_bedrag_inc: number | null;
  aanbetaling_te_innen_inc: number | null;
};

export type RawProject = {
  id: string;
  lead_id: string;
  offerte_id: string | null;
  status: string | null;
  installatie_voltooid_at: string | null;
  projectkosten: number | null;
};

export type RawFactuur = {
  id: string;
  lead_id: string | null;
  status: string;
  bedrag_inc_btw: number | null;
  omschrijving: string | null;
  betaald_op: string | null;
  credit_van_factuur_id: string | null;
};

export type RawBlok = { adviseur_id: string; dag: string; slot_hour: number };

export type PogingKlasse = "gepland" | "geannuleerd" | "onbekend" | "gesprek" | "deur_dicht" | "afgezegd";

export type AfboekInfo = {
  at: string;
  ymd: string;
  status: string;
  opTijd: boolean | null;
  openTraject: boolean;
};

export type Poging = {
  id: string;
  leadId: string;
  adviseurId: string | null;
  startAt: string;
  weekKey: string | null;
  soort: "nieuw" | "vervolg_fysiek";
  klasse: PogingKlasse;
  afboek: AfboekInfo | null;
};

export type Toerekening = "helder" | "onduidelijk" | "geen_bezoek";

export type Order = {
  leadId: string;
  offerteId: string;
  ondertekendOp: string;
  signYmd: string;
  weekKey: string | null;
  exBtw: number;
  incBtw: number;
  vereistInc: number;
  geenAanbetaling: boolean;
  financiering: boolean;
  geannuleerd: boolean;
  annuleringOnduidelijk: boolean;
  nettoAfgerond: boolean;
  betaaldInc: number;
  onduidelijkeOntvangstInc: number;
  drempelYmd: string | null;
  datumOntbreekt: boolean;
  aanbetaald: boolean;
  gedeeltelijk: boolean;
  tijdig: boolean | null;
  achterstallig: boolean;
  toerekening: Toerekening;
  verkoperId: string | null;
  extraOndertekeningen: number;
};

export type Kans = {
  leadId: string;
  weekKey: string | null;
  gesprekWeekKey: string | null;
  toegewezenAan: string | null;
  pogingen: Poging[];
  order: Order | null;
  gelopen: boolean;
  nogOpen: boolean;
  bucket: "gesprek" | "nog_gepland" | "niet_uitgevoerd" | "onbekend";
};

export type AdviseurKaart = {
  id: string;
  naam: string;
  actief: boolean;
  planbaar: boolean;
  commissiePct: number | null;
  fase: string;
  faseWeken: number | null;
  faseBasis: string;
};

export function isFysiekSoort(soort: string | null | undefined): "nieuw" | "vervolg_fysiek" | null {
  const s = normalizeAfspraakSoort(soort);
  if (s === "nieuw" || s === "vervolg_fysiek") return s;
  return null;
}

export function pogingKlasse(status: string, startAt: string, now: Date): PogingKlasse {
  if (status === "geannuleerd") return "geannuleerd";
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start) || start > now.getTime()) return "gepland";
  return "onbekend";
}

function vereistBedrag(o: RawOfferte): number {
  if (o.aanbetaling_te_innen_inc != null && Number.isFinite(Number(o.aanbetaling_te_innen_inc))) {
    return Math.max(0, Math.round(Number(o.aanbetaling_te_innen_inc) * 100) / 100);
  }
  const calc = aanbetalingVanOrder({
    subtotaalExBtw: Number(o.subtotaal_ex_btw) || 0,
    btwBedrag: Number(o.btw_bedrag) || 0,
    totaalIncBtw: Number(o.totaal_inc_btw) || 0,
    modus: o.aanbetaling_modus,
    handmatigIncBtw: o.aanbetaling_bedrag_inc,
    financieringVoorbehoud: o.financiering_voorbehoud,
  });
  return calc.bedragIncBtw;
}

function betaalYmd(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return ymdOfInstant(s);
}

const NETTO_STATUSSEN = new Set([
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

export function buildOrders(opts: {
  offertes: RawOfferte[];
  projecten: RawProject[];
  facturen: RawFactuur[];
  afspraken: RawAfspraak[];
  now: Date;
  settings: CockpitSettings;
}): { orders: Order[]; extraOfferteIds: string[] } {
  const signed = opts.offertes
    .filter((o) => o.status === "ondertekend" && o.ondertekend_op && o.lead_id)
    .sort((a, b) => String(a.ondertekend_op).localeCompare(String(b.ondertekend_op)));

  const byLead = new Map<string, RawOfferte[]>();
  for (const o of signed) {
    const list = byLead.get(o.lead_id) || [];
    list.push(o);
    byLead.set(o.lead_id, list);
  }

  const projectsByOfferte = new Map<string, RawProject[]>();
  const projectsByLead = new Map<string, RawProject[]>();
  for (const p of opts.projecten) {
    if (p.offerte_id) {
      const list = projectsByOfferte.get(p.offerte_id) || [];
      list.push(p);
      projectsByOfferte.set(p.offerte_id, list);
    }
    const ll = projectsByLead.get(p.lead_id) || [];
    ll.push(p);
    projectsByLead.set(p.lead_id, ll);
  }

  const facturenByLead = new Map<string, RawFactuur[]>();
  for (const f of opts.facturen) {
    if (!f.lead_id) continue;
    const list = facturenByLead.get(f.lead_id) || [];
    list.push(f);
    facturenByLead.set(f.lead_id, list);
  }

  const fysiek = opts.afspraken.filter((a) => isFysiekSoort(a.soort) && a.status !== "geannuleerd");

  const today = ymdOfInstant(opts.now.toISOString()) || "";
  const orders: Order[] = [];
  const extraOfferteIds: string[] = [];

  for (const [leadId, list] of byLead) {
    const primary = list[0]!;
    for (const extra of list.slice(1)) extraOfferteIds.push(extra.id);
    const signYmd = ymdOfInstant(primary.ondertekend_op!) || betaalYmd(primary.ondertekend_op);
    if (!signYmd) continue;
    const vereistInc = vereistBedrag(primary);
    const linked = projectsByOfferte.get(primary.id) || [];
    const leadProjects = projectsByLead.get(leadId) || [];
    let geannuleerd = linked.some((p) => normalizeProjectStatus(p.status) === "annulering");
    let annuleringOnduidelijk = false;
    if (!geannuleerd && linked.length === 0) {
      const leadAnn = leadProjects.filter((p) => normalizeProjectStatus(p.status) === "annulering");
      if (leadAnn.length && list.length === 1 && leadProjects.length === 1) {
        geannuleerd = true;
      } else if (leadAnn.length > 0) {
        annuleringOnduidelijk = true;
      }
    }
    const nettoProject = [...linked, ...leadProjects].find(
      (p) =>
        Boolean(p.installatie_voltooid_at) ||
        NETTO_STATUSSEN.has(normalizeProjectStatus(p.status))
    );
    const nettoAfgerond = Boolean(nettoProject) && !geannuleerd;

    const receipts = (facturenByLead.get(leadId) || []).filter(
      (f) => !f.credit_van_factuur_id && f.status !== "vervallen" && f.status !== "concept"
    );
    let betaaldInc = 0;
    let onduidelijk = 0;
    let datumOntbreekt = false;
    const dated: { ymd: string; inc: number }[] = [];
    for (const f of receipts) {
      if (f.status !== "betaald" && f.status !== "deels_betaald") continue;
      const inc = Number(f.bedrag_inc_btw) || 0;
      if (isRestantFactuurOmschrijving(f.omschrijving)) continue;
      if (f.status === "deels_betaald") {
        onduidelijk += inc;
        continue;
      }
      if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) {
        onduidelijk += inc;
        continue;
      }
      betaaldInc += inc;
      const ymd = betaalYmd(f.betaald_op);
      if (!ymd) datumOntbreekt = true;
      else dated.push({ ymd, inc });
    }
    betaaldInc = Math.round(betaaldInc * 100) / 100;
    const geenAanbetaling = vereistInc <= 0.01;
    const aanbetaald = !geenAanbetaling && betaaldInc + 0.5 >= vereistInc;
    const gedeeltelijk = !geenAanbetaling && betaaldInc > 0.5 && !aanbetaald;
    dated.sort((a, b) => a.ymd.localeCompare(b.ymd));
    let run = 0;
    let drempelYmd: string | null = null;
    for (const row of dated) {
      run = Math.round((run + row.inc) * 100) / 100;
      if (drempelYmd == null && run + 0.5 >= vereistInc) drempelYmd = row.ymd;
    }
    const deadline = addYmd(signYmd, opts.settings.aanbetalingDagen);
    let tijdig: boolean | null = null;
    if (geenAanbetaling) tijdig = null;
    else if (aanbetaald && drempelYmd) tijdig = drempelYmd <= deadline;
    else if (aanbetaald && datumOntbreekt) tijdig = null;
    const achterstallig =
      !geenAanbetaling && !aanbetaald && !geannuleerd && today > deadline;

    const before = fysiek.filter((a) => {
      if (a.lead_id !== leadId) return false;
      const ymd = ymdOfInstant(a.start_at);
      return Boolean(ymd && ymd <= signYmd);
    });
    const sellers = [...new Set(before.map((a) => a.adviseur_id).filter(Boolean))] as string[];
    let toerekening: Toerekening = "geen_bezoek";
    let verkoperId: string | null = null;
    if (sellers.length === 1) {
      toerekening = "helder";
      verkoperId = sellers[0]!;
    } else if (sellers.length > 1) {
      toerekening = "onduidelijk";
    }

    orders.push({
      leadId,
      offerteId: primary.id,
      ondertekendOp: primary.ondertekend_op!,
      signYmd,
      weekKey: weekKeyOfInstant(primary.ondertekend_op!),
      exBtw: Number(primary.subtotaal_ex_btw) || 0,
      incBtw: Number(primary.totaal_inc_btw) || 0,
      vereistInc,
      geenAanbetaling,
      financiering: Boolean(primary.financiering_voorbehoud),
      geannuleerd,
      annuleringOnduidelijk,
      nettoAfgerond,
      betaaldInc,
      onduidelijkeOntvangstInc: Math.round(onduidelijk * 100) / 100,
      drempelYmd,
      datumOntbreekt,
      aanbetaald,
      gedeeltelijk,
      tijdig,
      achterstallig,
      toerekening,
      verkoperId,
      extraOndertekeningen: list.length - 1,
    });
  }
  return { orders, extraOfferteIds };
}

export function buildKansen(opts: {
  afspraken: RawAfspraak[];
  orders: Order[];
  now: Date;
  koppeling?: Map<string, AfboekInfo>;
}): Kans[] {
  const orderByLead = new Map(opts.orders.map((o) => [o.leadId, o]));
  const byLead = new Map<string, RawAfspraak[]>();
  for (const a of opts.afspraken) {
    if (!isFysiekSoort(a.soort) || !a.lead_id) continue;
    const list = byLead.get(a.lead_id) || [];
    list.push(a);
    byLead.set(a.lead_id, list);
  }
  const kansen: Kans[] = [];
  for (const [leadId, list] of byLead) {
    const nieuw = list
      .filter((a) => isFysiekSoort(a.soort) === "nieuw")
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    if (nieuw.length === 0) continue;
    const pogingen: Poging[] = list
      .map((a) => {
        const soort = isFysiekSoort(a.soort)!;
        const info = opts.koppeling?.get(a.id) || null;
        let klasse = pogingKlasse(a.status, a.start_at, opts.now);
        if (klasse !== "geannuleerd" && info) {
          if (info.status === "deur_niet_open") klasse = "deur_dicht";
          else if (info.status === "afspraak_afgezegd_klant") klasse = "afgezegd";
          else if (
            info.status === "vervolg_fysiek" ||
            info.status === "vervolg_tel" ||
            info.status === "vervolg_geen_contact" ||
            info.status === "offerte_afgewezen" ||
            info.status.startsWith("geen_interesse") ||
            info.status === "niet_gekwalificeerd" ||
            info.status === "huurwoning" ||
            info.status === "sale_financiering" ||
            info.status === "sale_eigen_middelen" ||
            info.status === "deal"
          ) {
            klasse = "gesprek";
          }
        }
        return {
          id: a.id,
          leadId,
          adviseurId: a.adviseur_id,
          startAt: a.start_at,
          weekKey: weekKeyOfInstant(a.start_at),
          soort,
          klasse,
          afboek: info,
        };
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const eerste = nieuw[0]!;
    const open = pogingen.filter((p) => p.klasse !== "geannuleerd");
    const gesprekken = open.filter((p) => p.klasse === "gesprek");
    let bucket: Kans["bucket"] = "onbekend";
    if (gesprekken.length > 0) bucket = "gesprek";
    else if (open.length === 0) bucket = "niet_uitgevoerd";
    else if (open.every((p) => p.klasse === "deur_dicht" || p.klasse === "afgezegd")) bucket = "niet_uitgevoerd";
    else if (open.every((p) => p.klasse === "gepland")) bucket = "nog_gepland";
    else bucket = "onbekend";
    const eersteGesprek = gesprekken[0] || null;
    kansen.push({
      leadId,
      weekKey: weekKeyOfInstant(eerste.start_at),
      gesprekWeekKey: eersteGesprek?.weekKey || null,
      toegewezenAan: eerste.adviseur_id,
      pogingen,
      order: orderByLead.get(leadId) || null,
      gelopen: bucket === "gesprek",
      nogOpen: [...pogingen].reverse().find((p) => p.afboek)?.afboek?.openTraject === true,
      bucket,
    });
  }
  return kansen;
}

export function advisorCards(
  adviseurs: RawAdviseur[],
  kansen: Kans[],
  asOfKey: string
): AdviseurKaart[] {
  const firstByAdv = new Map<string, string>();
  for (const k of kansen) {
    const id = k.toegewezenAan;
    if (!id || !k.weekKey) continue;
    const cur = firstByAdv.get(id);
    if (!cur || k.weekKey < cur) firstByAdv.set(id, k.weekKey);
  }
  return adviseurs.map((a) => {
    const planbaar = isPlanbaarAdviseur({
      naam: a.naam,
      email: a.email,
      actief: a.actief,
      rol: a.rol,
    });
    const first = firstByAdv.get(a.id) || null;
    const faseWeken =
      first && asOfKey ? (weeksBetween(first, asOfKey) ?? 0) + 1 : null;
    let fase = "Onbekend";
    if (faseWeken == null) fase = "Geen toegewezen bezoek";
    else if (faseWeken <= 1) fase = "Starterweek";
    else if (faseWeken === 2) fase = "Week 2";
    else if (faseWeken <= 6) fase = `Opbouw, week ${faseWeken}`;
    else fase = "Ingewerkt";
    return {
      id: a.id,
      naam: a.naam,
      actief: a.actief,
      planbaar,
      commissiePct: a.commissie_pct,
      fase,
      faseWeken,
      faseBasis: "Benadering: week van het eerste toegewezen huisbezoek, niet van een bewezen gesprek",
    };
  });
}

export function capacityForWeek(opts: {
  adviseur: RawAdviseur;
  startYmd: string;
  endYmd: string;
  afblok: Set<string>;
  vrijgave: Set<string>;
  weekUnavailable: boolean;
}): number | null {
  if (!opts.adviseur.actief) return null;
  if (
    !isPlanbaarAdviseur({
      naam: opts.adviseur.naam,
      email: opts.adviseur.email,
      actief: opts.adviseur.actief,
      rol: opts.adviseur.rol,
    })
  ) {
    return null;
  }
  if (opts.weekUnavailable) return 0;
  const days = calendarDaysInclusive(opts.startYmd, opts.endYmd);
  let n = 0;
  const startGrens = (opts.adviseur.startdatum || "").slice(0, 10);
  for (const dag of days) {
    if (startGrens && dag < startGrens) continue;
    for (const hour of ADVISEUR_SLOT_HOURS) {
      if (isSlotGeblokkeerd(opts.adviseur.id, dag, hour, opts.afblok, opts.vrijgave)) {
        continue;
      }
      n += 1;
    }
  }
  return n;
}

export function blockSets(rows: RawBlok[]): Set<string> {
  const set = new Set<string>();
  for (const r of rows) set.add(afblokKey(r.adviseur_id, r.dag.slice(0, 10), r.slot_hour));
  return set;
}

export function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export function inWeeks<T extends { weekKey: string | null }>(rows: T[], keys: string[]): T[] {
  const set = new Set(keys);
  return rows.filter((r) => r.weekKey && set.has(r.weekKey));
}

export function sampleBasis(n: number, indicatie: number, stevig: number): "geen" | "beperkt" | "stevig" {
  if (n < indicatie) return "geen";
  if (n < stevig) return "beperkt";
  return "stevig";
}

export function weekLabel(key: string): string {
  return weekBounds(key)?.label || key;
}
