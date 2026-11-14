import {
  isGeenInteresseStatus,
  isNietGelopenUitkomst,
  leadStatusLabel,
} from "@/lib/labels";
import {
  isSaleUitkomst,
  VERVOLG_PUNT_VRIJGESTELD,
} from "@/lib/afspraak-soort";
import {
  isAttributed,
  type Dossier,
  type RawAppt,
  type RawOffer,
} from "@/lib/sales-cockpit/classify";
import { AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";
import type { LeadStatus } from "@/types/database";
import {
  addYmd,
  bucketKey,
  dateOnlyYmd,
  formatRangeLabel,
  isoToYmd,
  listBuckets,
  ymdInRange,
  type DateRange,
  type GroupBy,
} from "@/lib/sales-cockpit/range";

export type VisitKlasse = "gelopen" | "niet_gelopen" | "open";

export type CockpitVisitOutcome = {
  label: string;
  n: number;
};

export type CockpitVisitSlice = {
  key: VisitKlasse;
  label: string;
  n: number;
  pct: number;
  color: string;
  outcomes: CockpitVisitOutcome[];
};

export type CockpitTrendPoint = {
  key: string;
  label: string;
  deals: number;
  ingepland: number;
  gelopen: number;
  blokken: number;
  convIngeplandGelopen: number | null;
  convGelopenDeal: number | null;
};

/** Datapunt voor de trendchart onder het weekoverzicht. */
export type TrendPoint = {
  key: string;
  label: string;
  from: string;
  to: string;
  isSelected: boolean;
  deals: number;
  aanbetalingenInc: number;
  orderwaardeEx: number;
  orderwaardeInc: number;
  ingepland: number;
  gelopen: number;
  advisorsActive: number;
  availableBlocks: number;
  /** Fysieke afspraken / beschikbare blokken (%), null als geen capaciteit. */
  capacityFillPct: number | null;
  /** Conversie gelopen nieuwe huisbezoeken → deal (%), null als geen gelopen. */
  conversionGelopenSalePct: number | null;
};

/** @deprecated gebruik TrendPoint */
export type WeekTrendPoint = TrendPoint;

export type CockpitOverview = {
  advisorsActive: number;
  avgAdvisorConversionPct: number | null;
  deals: number;
  dealsWithDepositDue: number;
  dealsDeposited: number;
  depositPct: number | null;
  omzetEx: number;
  winstEx: number | null;
  visits: {
    ingepland: number;
    gelopen: number;
    nietGelopen: number;
    open: number;
    slices: CockpitVisitSlice[];
  };
  volumeTrend: CockpitTrendPoint[];
  conversionTrend: CockpitTrendPoint[];
};

/**
 * KPI’s voor een schouwweek bovenaan de cockpit.
 * Alle bezoek-tellingen zijn unieke leads met een eerste huisbezoek
 * (soort = nieuw) gepland in die week.
 */
export type WeekOverview = {
  from: string;
  to: string;
  label: string;
  weekKey: string;
  isCurrent: boolean;
  /** Unieke leads met eerste huisbezoek gepland in de week. */
  ingepland: number;
  gelopen: number;
  nogTeLopen: number;
  nietGelopen: number;
  deals: number;
  dealsWithDepositDue: number;
  dealsDeposited: number;
  depositPct: number | null;
  /** Som getekende orderwaarde ex btw (niet-geannuleerd). */
  orderwaardeEx: number;
  /** Som getekende orderwaarde inc btw (niet-geannuleerd). */
  orderwaardeInc: number;
  /** Som vereiste aanbetalingen die als binnengekomen herkend zijn (inc btw). */
  aanbetalingenInc: number;
  /**
   * Adviseurs met minstens één fysieke afspraak (nieuw of vervolg_fysiek)
   * in de week.
   */
  advisorsWithAppointments: number;
  /** Fysieke afspraken (nieuw + vervolg_fysiek) nog te lopen. */
  physicalOpen: number;
  /** Fysieke afspraken (nieuw + vervolg_fysiek) gelopen. */
  physicalGelopen: number;
  /** physicalOpen + physicalGelopen. */
  physicalBooked: number;
  /**
   * Gemiddeld aantal fysieke afspraken (open + gelopen) per adviseur
   * met minstens één afspraak in de week (zelfde noemer als capaciteit).
   */
  avgPhysicalBookedPerAdvisor: number | null;
  /**
   * Planbare adviseurs mét minstens één afspraak in de week
   * (noemer voor capaciteitsgemiddelden).
   */
  planbaarAdvisors: number;
  /** Som niet-geblokkeerde tijdblokken over die adviseurs. */
  availableBlocksTotal: number;
  /** Gemiddeld niet-geblokkeerde tijdblokken per adviseur met afspraken. */
  avgAvailableBlocksPerAdvisor: number | null;
  /** Aandeel van capaciteit dat met fysieke afspraken is gevuld. */
  capacityFillPct: number | null;
  /** Unieke gelopen nieuwe huisbezoeken die een deal werden. */
  salesFromGelopen: number;
  /** Conversie: gelopen nieuwe afspraken → deal. */
  conversionNieuwGelopenSalePct: number | null;
  /**
   * Unieke vervolgafspraken in de week van leads waarvan het eerste
   * huisbezoek in een eerdere week lag.
   */
  vervolgIngepland: number;
  vervolgGelopen: number;
  vervolgNogTeLopen: number;
  vervolgNietGelopen: number;
  /** Unieke gelopen vervolgafspraken die een deal werden. */
  vervolgSalesFromGelopen: number;
  /** Conversie: gelopen oude vervolgafspraken → deal. */
  conversionVervolgGelopenSalePct: number | null;
};

/** Per-adviseur KPI’s voor de geselecteerde schouwweek (zelfde definities als WeekOverview). */
export type WeekLeaderboardRow = {
  id: string;
  naam: string;
  actief: boolean;
  nieuwIngepland: number;
  nieuwGelopen: number;
  salesFromGelopen: number;
  conversionNieuwGelopenSalePct: number | null;
  vervolgIngepland: number;
  vervolgGelopen: number;
  vervolgSalesFromGelopen: number;
  conversionVervolgGelopenSalePct: number | null;
  deals: number;
  orderwaardeEx: number;
};

export type DayAdvisorLiveStatus =
  | "in_afspraak"
  | "volgende"
  | "vrij"
  | "klaar";

export type DayAdvisorOfferFlags = {
  created: boolean;
  sent: boolean;
  signed: boolean;
};

export type DayAdvisorAppt = {
  id: string;
  leadId: string;
  leadNumber: string;
  leadNaam: string;
  soort: string;
  startAt: string;
  endAt: string;
  offer: DayAdvisorOfferFlags | null;
  /** Of deze afspraak al is afgeboekt / getekend (niet meer “live”). */
  settled: boolean;
  settledLabel: string | null;
};

export type DayAdvisorRow = {
  id: string;
  naam: string;
  actief: boolean;
  /** Unieke nieuwe huisbezoeken vandaag. */
  nieuw: number;
  vervolgFysiek: number;
  vervolgTel: number;
  vervolgPunt: number;
  /** Totaal actieve afspraken vandaag (niet geannuleerd/verzet). */
  apptTotal: number;
  /** Afspraken vandaag die nog geen uitkomst hebben. */
  openAppts: number;
  /** Alle offertes die deze adviseur die dag heeft laten tekenen. */
  deals: number;
  orderwaardeEx: number;
  liveStatus: DayAdvisorLiveStatus;
  current: DayAdvisorAppt | null;
  next: DayAdvisorAppt | null;
  /** Laatste afgeboekte afspraak in het huidige tijdblok (ter context). */
  justFinished: DayAdvisorAppt | null;
  /** Laatste afgeronde/afgeboekte afspraak vóór of in het huidige moment. */
  previous: DayAdvisorAppt | null;
};

/** Offertestatus per lead met afspraak die dag — voor live notificaties. */
export type DayOfferSignal = {
  leadId: string;
  leadNumber: string;
  leadNaam: string;
  adviseurId: string | null;
  adviseurNaam: string | null;
  created: boolean;
  sent: boolean;
  signed: boolean;
};

/** Live dagoverzicht (vandaag of gekozen dag). */
export type DayOverview = {
  ymd: string;
  label: string;
  isToday: boolean;
  apptTotal: number;
  nieuw: number;
  vervolgFysiek: number;
  vervolgTel: number;
  vervolgPunt: number;
  deals: number;
  orderwaardeEx: number;
  orderwaardeInc: number;
  advisorsActive: number;
  advisors: DayAdvisorRow[];
  offerSignals: DayOfferSignal[];
};

const GELOPEN_STATUS = new Set([
  "vervolg_fysiek",
  "vervolg_tel",
  "offerte_afgewezen",
  "deal",
  "sale_financiering",
  "sale_eigen_middelen",
]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return round1((num / den) * 100);
}

function soortOf(soort: string | null | undefined): string {
  return (soort || "").trim();
}

/** Alleen expliciete eerste huisbezoeken — nooit vervolg/bel/lege soort. */
export function isNieuwHuisbezoek(soort: string | null | undefined): boolean {
  return soortOf(soort) === "nieuw";
}

/** Fysiek huisbezoek: nieuw of fysiek vervolg (geen bel/punt). */
export function isFysiekHuisbezoek(soort: string | null | undefined): boolean {
  const s = soortOf(soort);
  return s === "nieuw" || s === "vervolg_fysiek";
}

function isVervolgSoort(soort: string | null | undefined): boolean {
  const s = soortOf(soort);
  return s === "vervolg_fysiek" || s === "vervolg_tel" || s === "vervolg_punt";
}

function isActiefIngepland(status: string): boolean {
  return status !== "geannuleerd" && status !== "verzet";
}

/**
 * Eén representatieve nieuw-afspraak per lead in de periode.
 * Voorkeur: eerst actief ingepland (niet geannuleerd/verzet), dan vroegste start.
 */
function pickRepresentativeNieuw(appts: RawAppt[]): RawAppt {
  const sorted = [...appts].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return sorted.find((a) => isActiefIngepland(a.status)) ?? sorted[0]!;
}

/**
 * Unieke leads met een eerste huisbezoek (soort = "nieuw") in de periode.
 * Elke lead telt één keer — meerdere nieuw-afspraken in dezelfde week
 * (verzet/herpland) worden samengevoegd tot één bezoek.
 * Vervolg, bel en lege/onbekende soort tellen nooit mee.
 */
export function huisbezoekenInRange(
  appointments: RawAppt[],
  range: DateRange
): RawAppt[] {
  const byLead = new Map<string, RawAppt[]>();
  for (const a of appointments) {
    if (!isNieuwHuisbezoek(a.soort)) continue;
    if (isVervolgSoort(a.soort)) continue;
    const ymd = isoToYmd(a.startAt);
    if (ymd == null || !ymdInRange(ymd, range)) continue;
    const list = byLead.get(a.leadId);
    if (list) list.push(a);
    else byLead.set(a.leadId, [a]);
  }
  return [...byLead.values()].map(pickRepresentativeNieuw);
}

function leadHadNieuwBefore(appts: RawAppt[], beforeYmd: string): boolean {
  return appts.some((a) => {
    if (!isNieuwHuisbezoek(a.soort)) return false;
    const ymd = isoToYmd(a.startAt);
    return ymd != null && ymd < beforeYmd;
  });
}

/**
 * Unieke vervolgafspraken in de periode van leads die al eerder
 * (vóór `range.from`) een eerste huisbezoek hadden.
 * Eén afspraak per lead — voorkeur actief, dan vroegste start.
 */
export function vervolgAfsprakenInRange(
  appointments: RawAppt[],
  appointmentsByLead: Map<string, RawAppt[]>,
  range: DateRange
): RawAppt[] {
  const byLead = new Map<string, RawAppt[]>();
  for (const a of appointments) {
    if (!isVervolgSoort(a.soort)) continue;
    const ymd = isoToYmd(a.startAt);
    if (ymd == null || !ymdInRange(ymd, range)) continue;
    const leadAppts = appointmentsByLead.get(a.leadId) ?? [];
    if (!leadHadNieuwBefore(leadAppts, range.from)) continue;
    const list = byLead.get(a.leadId);
    if (list) list.push(a);
    else byLead.set(a.leadId, [a]);
  }
  return [...byLead.values()].map(pickRepresentativeNieuw);
}

function leadHasFollowUp(appts: RawAppt[], afterStart: string): boolean {
  return appts.some((a) => {
    if (a.status === "geannuleerd") return false;
    if (a.startAt <= afterStart) return false;
    return isVervolgSoort(a.soort);
  });
}

function statusLabel(status: string): string {
  return leadStatusLabel[status as LeadStatus] || status || "Onbekend";
}

/**
 * Gelopen = sale / geen interesse / offerte afgewezen / vervolg gepland /
 * of verstreken zonder afboekuitkomst (niet afgeboekt).
 * Niet gelopen = deur niet open, afgezegd, verzet, geannuleerd.
 * Open = nog in de toekomst binnen de periode.
 */
export function classifyVisit(
  appt: RawAppt,
  leadStatus: string,
  leadAppts: RawAppt[],
  todayYmd: string
): { klasse: VisitKlasse; outcome: string } {
  const ymd = isoToYmd(appt.startAt) || "";
  if (appt.status === "geannuleerd") {
    return { klasse: "niet_gelopen", outcome: "Geannuleerd" };
  }
  if (appt.status === "verzet") {
    return { klasse: "niet_gelopen", outcome: "Verplaatst" };
  }
  if (ymd > todayYmd) {
    return { klasse: "open", outcome: "Nog te lopen" };
  }
  if (isNietGelopenUitkomst(leadStatus)) {
    return { klasse: "niet_gelopen", outcome: statusLabel(leadStatus) };
  }

  if (isSaleUitkomst(leadStatus as LeadStatus) || leadStatus === "deal") {
    return { klasse: "gelopen", outcome: statusLabel(leadStatus || "deal") };
  }
  if (isGeenInteresseStatus(leadStatus) || GELOPEN_STATUS.has(leadStatus)) {
    return { klasse: "gelopen", outcome: statusLabel(leadStatus) };
  }
  if (leadHasFollowUp(leadAppts, appt.startAt)) {
    return { klasse: "gelopen", outcome: "Vervolg gepland" };
  }

  return { klasse: "gelopen", outcome: "Niet afgeboekt" };
}

function bumpOutcome(map: Map<string, number>, outcome: string) {
  map.set(outcome, (map.get(outcome) || 0) + 1);
}

function outcomeList(map: Map<string, number>): CockpitVisitOutcome[] {
  return [...map.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "nl"));
}

export function buildWeekOverview(input: {
  dossiers: Dossier[];
  appointments: RawAppt[];
  leadStatusById: Map<string, string>;
  appointmentsByLead: Map<string, RawAppt[]>;
  week: DateRange & { key?: string };
  todayYmd: string;
  label: string;
  isCurrent?: boolean;
  /** Capaciteit: niet-geblokkeerde tijdblokken over adviseurs met afspraken. */
  availableBlocksTotal?: number;
  /** Noemer: planbare adviseurs met minstens één afspraak in de week. */
  planbaarAdvisors?: number;
}): WeekOverview {
  const {
    dossiers,
    appointments,
    leadStatusById,
    appointmentsByLead,
    week,
    todayYmd,
    label,
    isCurrent = false,
    availableBlocksTotal = 0,
    planbaarAdvisors = 0,
  } = input;

  const visits = huisbezoekenInRange(appointments, week);
  let gelopen = 0;
  let nietGelopen = 0;
  let nogTeLopen = 0;
  let salesFromGelopen = 0;

  const dossierByLead = new Map(dossiers.map((d) => [d.leadId, d]));

  function isClosed(leadId: string): boolean {
    const dossier = dossierByLead.get(leadId);
    return dossier?.stand === "sale" || Boolean(dossier?.signedYmd);
  }

  for (const appt of visits) {
    const { klasse } = classifyVisit(
      appt,
      leadStatusById.get(appt.leadId) || "",
      appointmentsByLead.get(appt.leadId) ?? [],
      todayYmd
    );
    if (klasse === "gelopen") {
      gelopen += 1;
      if (isClosed(appt.leadId)) salesFromGelopen += 1;
    } else if (klasse === "niet_gelopen") {
      nietGelopen += 1;
    } else {
      nogTeLopen += 1;
    }
  }

  const vervolgVisits = vervolgAfsprakenInRange(
    appointments,
    appointmentsByLead,
    week
  );
  let vervolgGelopen = 0;
  let vervolgNietGelopen = 0;
  let vervolgNogTeLopen = 0;
  let vervolgSalesFromGelopen = 0;

  for (const appt of vervolgVisits) {
    const { klasse } = classifyVisit(
      appt,
      leadStatusById.get(appt.leadId) || "",
      appointmentsByLead.get(appt.leadId) ?? [],
      todayYmd
    );
    if (klasse === "gelopen") {
      vervolgGelopen += 1;
      if (isClosed(appt.leadId)) vervolgSalesFromGelopen += 1;
    } else if (klasse === "niet_gelopen") {
      vervolgNietGelopen += 1;
    } else {
      vervolgNogTeLopen += 1;
    }
  }

  let physicalOpen = 0;
  let physicalGelopen = 0;
  const physicalAdvisors = new Set<string>();
  for (const appt of appointments) {
    if (!isFysiekHuisbezoek(appt.soort)) continue;
    if (!appt.adviseurId) continue;
    const ymd = isoToYmd(appt.startAt);
    if (ymd == null || !ymdInRange(ymd, week)) continue;
    physicalAdvisors.add(appt.adviseurId);
    const { klasse } = classifyVisit(
      appt,
      leadStatusById.get(appt.leadId) || "",
      appointmentsByLead.get(appt.leadId) ?? [],
      todayYmd
    );
    if (klasse === "open") physicalOpen += 1;
    else if (klasse === "gelopen") physicalGelopen += 1;
  }
  const physicalAdvisorN = physicalAdvisors.size;
  const physicalBooked = physicalOpen + physicalGelopen;
  const capacityN = planbaarAdvisors > 0 ? planbaarAdvisors : physicalAdvisorN;
  const avgPhysicalBookedPerAdvisor =
    capacityN > 0 ? round1(physicalBooked / capacityN) : null;
  const avgAvailableBlocksPerAdvisor =
    planbaarAdvisors > 0 ? round1(availableBlocksTotal / planbaarAdvisors) : null;
  const capacityFillPct =
    avgAvailableBlocksPerAdvisor != null &&
    avgAvailableBlocksPerAdvisor > 0 &&
    avgPhysicalBookedPerAdvisor != null
      ? round1((avgPhysicalBookedPerAdvisor / avgAvailableBlocksPerAdvisor) * 100)
      : null;

  let deals = 0;
  let dealsWithDepositDue = 0;
  let dealsDeposited = 0;
  let orderwaardeEx = 0;
  let orderwaardeInc = 0;
  let aanbetalingenInc = 0;
  for (const row of dossiers) {
    if (!ymdInRange(row.signedYmd, week)) continue;
    if (row.cancelled) continue;
    deals += 1;
    orderwaardeEx = round2(orderwaardeEx + row.signedEx);
    orderwaardeInc = round2(orderwaardeInc + row.signedInc);
    if (!row.depositNone) {
      dealsWithDepositDue += 1;
      if (row.depositMet) {
        dealsDeposited += 1;
        aanbetalingenInc = round2(aanbetalingenInc + row.depositRequiredInc);
      }
    }
  }

  return {
    from: week.from,
    to: week.to,
    label,
    weekKey: week.key || `${week.from}_${week.to}`,
    isCurrent,
    ingepland: visits.length,
    gelopen,
    nogTeLopen,
    nietGelopen,
    deals,
    dealsWithDepositDue,
    dealsDeposited,
    depositPct: pct(dealsDeposited, dealsWithDepositDue),
    orderwaardeEx,
    orderwaardeInc,
    aanbetalingenInc,
    advisorsWithAppointments: physicalAdvisorN,
    physicalOpen,
    physicalGelopen,
    physicalBooked,
    avgPhysicalBookedPerAdvisor,
    planbaarAdvisors,
    availableBlocksTotal,
    avgAvailableBlocksPerAdvisor,
    capacityFillPct,
    salesFromGelopen,
    conversionNieuwGelopenSalePct: pct(salesFromGelopen, gelopen),
    vervolgIngepland: vervolgVisits.length,
    vervolgGelopen,
    vervolgNogTeLopen,
    vervolgNietGelopen,
    vervolgSalesFromGelopen,
    conversionVervolgGelopenSalePct: pct(
      vervolgSalesFromGelopen,
      vervolgGelopen
    ),
  };
}

function emptyLeaderboardRow(
  advisor: { id: string; naam: string; actief: boolean }
): WeekLeaderboardRow {
  return {
    id: advisor.id,
    naam: advisor.naam,
    actief: advisor.actief,
    nieuwIngepland: 0,
    nieuwGelopen: 0,
    salesFromGelopen: 0,
    conversionNieuwGelopenSalePct: null,
    vervolgIngepland: 0,
    vervolgGelopen: 0,
    vervolgSalesFromGelopen: 0,
    conversionVervolgGelopenSalePct: null,
    deals: 0,
    orderwaardeEx: 0,
  };
}

/**
 * Leaderboard voor actieve adviseurs in de geselecteerde schouwweek.
 * Bezoeken op `appt.adviseurId`, deals op `dossier.adviseurId`.
 */
export function buildWeekLeaderboard(input: {
  advisors: { id: string; naam: string; actief: boolean }[];
  dossiers: Dossier[];
  appointments: RawAppt[];
  leadStatusById: Map<string, string>;
  appointmentsByLead: Map<string, RawAppt[]>;
  week: DateRange;
  todayYmd: string;
}): WeekLeaderboardRow[] {
  const {
    advisors,
    dossiers,
    appointments,
    leadStatusById,
    appointmentsByLead,
    week,
    todayYmd,
  } = input;

  const rows = new Map<string, WeekLeaderboardRow>();
  for (const advisor of advisors) {
    if (!advisor.actief) continue;
    rows.set(advisor.id, emptyLeaderboardRow(advisor));
  }

  const dossierByLead = new Map(dossiers.map((d) => [d.leadId, d]));
  function isClosed(leadId: string): boolean {
    const dossier = dossierByLead.get(leadId);
    return dossier?.stand === "sale" || Boolean(dossier?.signedYmd);
  }

  const visits = huisbezoekenInRange(appointments, week);
  for (const appt of visits) {
    if (!appt.adviseurId) continue;
    const row = rows.get(appt.adviseurId);
    if (!row) continue;
    row.nieuwIngepland += 1;
    const { klasse } = classifyVisit(
      appt,
      leadStatusById.get(appt.leadId) || "",
      appointmentsByLead.get(appt.leadId) ?? [],
      todayYmd
    );
    if (klasse === "gelopen") {
      row.nieuwGelopen += 1;
      if (isClosed(appt.leadId)) row.salesFromGelopen += 1;
    }
  }

  const vervolgVisits = vervolgAfsprakenInRange(
    appointments,
    appointmentsByLead,
    week
  );
  for (const appt of vervolgVisits) {
    if (!appt.adviseurId) continue;
    const row = rows.get(appt.adviseurId);
    if (!row) continue;
    row.vervolgIngepland += 1;
    const { klasse } = classifyVisit(
      appt,
      leadStatusById.get(appt.leadId) || "",
      appointmentsByLead.get(appt.leadId) ?? [],
      todayYmd
    );
    if (klasse === "gelopen") {
      row.vervolgGelopen += 1;
      if (isClosed(appt.leadId)) row.vervolgSalesFromGelopen += 1;
    }
  }

  for (const dossier of dossiers) {
    if (!dossier.adviseurId) continue;
    if (!ymdInRange(dossier.signedYmd, week)) continue;
    if (dossier.cancelled) continue;
    const row = rows.get(dossier.adviseurId);
    if (!row) continue;
    row.deals += 1;
    row.orderwaardeEx = round2(row.orderwaardeEx + dossier.signedEx);
  }

  const list = [...rows.values()].map((row) => ({
    ...row,
    conversionNieuwGelopenSalePct: pct(row.salesFromGelopen, row.nieuwGelopen),
    conversionVervolgGelopenSalePct: pct(
      row.vervolgSalesFromGelopen,
      row.vervolgGelopen
    ),
  }));

  list.sort(
    (a, b) =>
      b.deals - a.deals ||
      b.orderwaardeEx - a.orderwaardeEx ||
      b.nieuwGelopen - a.nieuwGelopen ||
      b.vervolgGelopen - a.vervolgGelopen ||
      a.naam.localeCompare(b.naam, "nl")
  );
  return list;
}

function apptEndIso(appt: RawAppt): string {
  if (appt.endAt) return appt.endAt;
  const start = Date.parse(appt.startAt);
  if (!Number.isFinite(start)) return appt.startAt;
  return new Date(start + AFSPRAAK_DUUR_MINUTEN * 60_000).toISOString();
}

function isActiveApptStatus(status: string): boolean {
  return status !== "geannuleerd" && status !== "verzet";
}

/**
 * Afspraak telt niet meer als “nu bezig”: sale/afboekuitkomst, of er is al
 * een vervolg na deze start gepland. Cron-`voltooid` zonder uitkomst telt niet.
 */
export function isLiveApptSettled(
  appt: RawAppt,
  dossier: Dossier | undefined,
  leadAppts: RawAppt[],
  offerFlags?: DayAdvisorOfferFlags | null
): { settled: boolean; label: string | null } {
  const status = (dossier?.status || "").trim();
  const soort = (appt.soort || "").trim() || "nieuw";

  if (dossier?.stand === "sale" || dossier?.signedYmd || offerFlags?.signed) {
    return { settled: true, label: "Getekend" };
  }
  if (isSaleUitkomst(status as LeadStatus) || status === "deal") {
    return { settled: true, label: statusLabel(status || "deal") };
  }
  if (dossier?.stand === "afgeboekt") {
    return { settled: true, label: statusLabel(status || "Afgeboekt") };
  }
  if (status && VERVOLG_PUNT_VRIJGESTELD.has(status as LeadStatus)) {
    return { settled: true, label: statusLabel(status) };
  }
  if (leadHasFollowUp(leadAppts, appt.startAt)) {
    return { settled: true, label: "Vervolg gepland" };
  }
  if (
    (status === "vervolg_fysiek" ||
      status === "vervolg_tel" ||
      status === "vervolg_geen_contact") &&
    soort === "nieuw"
  ) {
    return { settled: true, label: statusLabel(status) };
  }
  return { settled: false, label: null };
}

/**
 * Live dagoverzicht: aantallen + per actieve adviseur huidige/volgende afspraak
 * en of er voor de huidige lead een offerte is aangemaakt/verstuurd.
 */
function offerSignedYmd(offer: RawOffer): string | null {
  return dateOnlyYmd(offer.ondertekendOp) ?? isoToYmd(offer.ondertekendOp);
}

/** Adviseur die de ondertekening toegekend krijgt. */
function advisorForSignedOffer(
  offer: RawOffer,
  dossierByLead: Map<string, Dossier>,
  appointments: RawAppt[]
): string | null {
  const dossier = dossierByLead.get(offer.leadId);
  if (dossier?.adviseurId) return dossier.adviseurId;
  if (offer.aangemaaktDoorId) return offer.aangemaaktDoorId;

  const signedYmd = offerSignedYmd(offer);
  const leadAppts = appointments
    .filter(
      (a) =>
        a.leadId === offer.leadId &&
        a.adviseurId &&
        a.status !== "geannuleerd" &&
        a.status !== "verzet"
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  if (signedYmd) {
    const onDay = leadAppts.filter((a) => isoToYmd(a.startAt) === signedYmd);
    if (onDay.length > 0) return onDay[onDay.length - 1]!.adviseurId;
  }

  const prior = leadAppts.filter((a) => a.startAt <= offer.ondertekendOp);
  if (prior.length > 0) return prior[prior.length - 1]!.adviseurId;
  return leadAppts[leadAppts.length - 1]?.adviseurId ?? null;
}

export function buildDayOverview(input: {
  advisors: { id: string; naam: string; actief: boolean }[];
  dossiers: Dossier[];
  appointments: RawAppt[];
  /** Alle ondertekende offertes (niet alleen primaire deal per lead). */
  offers: RawOffer[];
  leadMetaById: Map<string, { leadNumber: string; naam: string }>;
  offerFlagsByLead: Map<string, DayAdvisorOfferFlags>;
  dayYmd: string;
  todayYmd: string;
  nowIso?: string;
}): DayOverview {
  const {
    advisors,
    dossiers,
    appointments,
    offers,
    leadMetaById,
    offerFlagsByLead,
    dayYmd,
    todayYmd,
    nowIso,
  } = input;
  const nowMs = Date.parse(nowIso || new Date().toISOString());
  const dayRange: DateRange = { from: dayYmd, to: dayYmd };

  const dayAppts = appointments
    .filter((a) => {
      if (!isActiveApptStatus(a.status)) return false;
      const ymd = isoToYmd(a.startAt);
      return ymd != null && ymdInRange(ymd, dayRange);
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const nieuwVisits = huisbezoekenInRange(appointments, dayRange);
  let vervolgFysiek = 0;
  let vervolgTel = 0;
  let vervolgPunt = 0;
  const vervolgLeadSeen = {
    fysiek: new Set<string>(),
    tel: new Set<string>(),
    punt: new Set<string>(),
  };
  for (const a of dayAppts) {
    const s = (a.soort || "").trim();
    if (s === "vervolg_fysiek" && !vervolgLeadSeen.fysiek.has(a.leadId)) {
      vervolgLeadSeen.fysiek.add(a.leadId);
      vervolgFysiek += 1;
    } else if (s === "vervolg_tel" && !vervolgLeadSeen.tel.has(a.leadId)) {
      vervolgLeadSeen.tel.add(a.leadId);
      vervolgTel += 1;
    } else if (s === "vervolg_punt" && !vervolgLeadSeen.punt.has(a.leadId)) {
      vervolgLeadSeen.punt.add(a.leadId);
      vervolgPunt += 1;
    }
  }

  const dossierByLead = new Map(dossiers.map((d) => [d.leadId, d] as const));
  let deals = 0;
  let orderwaardeEx = 0;
  let orderwaardeInc = 0;
  const dealsByAdvisor = new Map<
    string,
    { deals: number; orderwaardeEx: number }
  >();
  for (const offer of offers) {
    const signedYmd = offerSignedYmd(offer);
    if (!signedYmd || !ymdInRange(signedYmd, dayRange)) continue;
    const dossier = dossierByLead.get(offer.leadId);
    if (dossier?.cancelled) continue;
    deals += 1;
    orderwaardeEx = round2(orderwaardeEx + (Number(offer.ex) || 0));
    orderwaardeInc = round2(orderwaardeInc + (Number(offer.inc) || 0));
    const adviseurId = advisorForSignedOffer(
      offer,
      dossierByLead,
      appointments
    );
    if (!adviseurId) continue;
    const prev = dealsByAdvisor.get(adviseurId) || {
      deals: 0,
      orderwaardeEx: 0,
    };
    prev.deals += 1;
    prev.orderwaardeEx = round2(prev.orderwaardeEx + (Number(offer.ex) || 0));
    dealsByAdvisor.set(adviseurId, prev);
  }

  const apptsByLead = new Map<string, RawAppt[]>();
  for (const a of appointments) {
    const list = apptsByLead.get(a.leadId);
    if (list) list.push(a);
    else apptsByLead.set(a.leadId, [a]);
  }

  function toDayAppt(appt: RawAppt): DayAdvisorAppt {
    const meta = leadMetaById.get(appt.leadId);
    const soort = (appt.soort || "").trim() || "nieuw";
    const settledInfo = isLiveApptSettled(
      appt,
      dossierByLead.get(appt.leadId),
      apptsByLead.get(appt.leadId) ?? [],
      offerFlagsByLead.get(appt.leadId) ?? null
    );
    return {
      id: appt.id,
      leadId: appt.leadId,
      leadNumber: meta?.leadNumber || appt.leadId,
      leadNaam: meta?.naam || "Lead",
      soort,
      startAt: appt.startAt,
      endAt: apptEndIso(appt),
      offer: offerFlagsByLead.get(appt.leadId) ?? null,
      settled: settledInfo.settled,
      settledLabel: settledInfo.label,
    };
  }

  const byAdvisor = new Map<string, RawAppt[]>();
  for (const a of dayAppts) {
    if (!a.adviseurId) continue;
    const list = byAdvisor.get(a.adviseurId);
    if (list) list.push(a);
    else byAdvisor.set(a.adviseurId, [a]);
  }

  const advisorRows: DayAdvisorRow[] = [];
  for (const advisor of advisors) {
    const list = byAdvisor.get(advisor.id) ?? [];
    const dealStats = dealsByAdvisor.get(advisor.id) || {
      deals: 0,
      orderwaardeEx: 0,
    };
    // Alleen adviseurs uit de meegegeven agenda-scope met afspraken/deals.
    if (list.length === 0 && dealStats.deals === 0) continue;

    let nieuw = 0;
    let vFysiek = 0;
    let vTel = 0;
    let vPunt = 0;
    const seenNieuw = new Set<string>();
    const seenF = new Set<string>();
    const seenT = new Set<string>();
    const seenP = new Set<string>();
    for (const a of list) {
      const s = (a.soort || "").trim();
      if (s === "nieuw" && !seenNieuw.has(a.leadId)) {
        seenNieuw.add(a.leadId);
        nieuw += 1;
      } else if (s === "vervolg_fysiek" && !seenF.has(a.leadId)) {
        seenF.add(a.leadId);
        vFysiek += 1;
      } else if (s === "vervolg_tel" && !seenT.has(a.leadId)) {
        seenT.add(a.leadId);
        vTel += 1;
      } else if (s === "vervolg_punt" && !seenP.has(a.leadId)) {
        seenP.add(a.leadId);
        vPunt += 1;
      }
    }

    let current: DayAdvisorAppt | null = null;
    let justFinished: DayAdvisorAppt | null = null;
    let next: DayAdvisorAppt | null = null;
    let previous: DayAdvisorAppt | null = null;
    let openAppts = 0;

    // list is gesorteerd op startAt.
    // “In afspraak” alleen binnen het geplande tijdblok (start ≤ nu < eind).
    // Zodra een later blok start, vervalt een eerdere current altijd.
    for (const a of list) {
      const dayAppt = toDayAppt(a);
      if (!dayAppt.settled) openAppts += 1;

      const start = Date.parse(a.startAt);
      const end = Date.parse(apptEndIso(a));
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      const started = start <= nowMs;
      const inSlot = started && nowMs < end;

      if (!started) {
        if (!dayAppt.settled && !next) next = dayAppt;
        continue;
      }

      // Later gestart blok → eerdere “current” vervalt altijd.
      const supersedeEarlierCurrent = () => {
        if (!current) return;
        if (Date.parse(current.startAt) >= start) return;
        justFinished = current;
        previous = current;
        current = null;
      };

      if (dayAppt.settled) {
        supersedeEarlierCurrent();
        if (inSlot || started) justFinished = dayAppt;
        if (!previous || a.startAt >= previous.startAt) previous = dayAppt;
        continue;
      }

      // Na eindtijd: niet meer “in afspraak” (fysiek én telefonisch).
      if (!inSlot) {
        supersedeEarlierCurrent();
        justFinished = dayAppt;
        if (!previous || a.startAt >= previous.startAt) previous = dayAppt;
        continue;
      }

      // Binnen het tijdblok + nog open → current.
      if (current) {
        justFinished = current;
        previous = current;
      }
      current = dayAppt;
    }

    const liveStatus: DayAdvisorLiveStatus = current
      ? "in_afspraak"
      : next
        ? justFinished
          ? "vrij"
          : "volgende"
        : "klaar";

    advisorRows.push({
      id: advisor.id,
      naam: advisor.naam,
      actief: advisor.actief,
      nieuw,
      vervolgFysiek: vFysiek,
      vervolgTel: vTel,
      vervolgPunt: vPunt,
      apptTotal: list.length,
      openAppts,
      deals: dealStats.deals,
      orderwaardeEx: dealStats.orderwaardeEx,
      liveStatus,
      current,
      next,
      justFinished,
      previous,
    });
  }

  advisorRows.sort((a, b) => {
    const rank = (s: DayAdvisorLiveStatus) =>
      s === "in_afspraak" ? 0 : s === "vrij" ? 1 : s === "volgende" ? 2 : 3;
    const ra = rank(a.liveStatus);
    const rb = rank(b.liveStatus);
    if (ra !== rb) return ra - rb;
    if (b.deals !== a.deals) return b.deals - a.deals;
    const aTime = a.current?.startAt || a.next?.startAt || "";
    const bTime = b.current?.startAt || b.next?.startAt || "";
    return aTime.localeCompare(bTime) || a.naam.localeCompare(b.naam, "nl");
  });

  const advisorNameById = new Map(advisors.map((a) => [a.id, a.naam] as const));
  const offerSignals: DayOfferSignal[] = [];
  const seenOfferLeads = new Set<string>();
  for (const a of dayAppts) {
    if (seenOfferLeads.has(a.leadId)) continue;
    seenOfferLeads.add(a.leadId);
    const flags = offerFlagsByLead.get(a.leadId) || {
      created: false,
      sent: false,
      signed: false,
    };
    const meta = leadMetaById.get(a.leadId);
    offerSignals.push({
      leadId: a.leadId,
      leadNumber: meta?.leadNumber || a.leadId,
      leadNaam: meta?.naam || "Lead",
      adviseurId: a.adviseurId,
      adviseurNaam: a.adviseurId
        ? advisorNameById.get(a.adviseurId) || null
        : null,
      created: flags.created,
      sent: flags.sent,
      signed: flags.signed,
    });
  }

  return {
    ymd: dayYmd,
    label: formatRangeLabel(dayRange),
    isToday: dayYmd === todayYmd,
    apptTotal: dayAppts.length,
    nieuw: nieuwVisits.length,
    vervolgFysiek,
    vervolgTel,
    vervolgPunt,
    deals,
    orderwaardeEx,
    orderwaardeInc,
    advisorsActive: advisorRows.length,
    advisors: advisorRows,
    offerSignals,
  };
}

function bucketRange(
  range: DateRange,
  group: GroupBy,
  key: string
): DateRange {
  let from = range.to;
  let to = range.from;
  let day = range.from;
  let guard = 0;
  while (day <= range.to && guard < 4000) {
    if (bucketKey(day, group) === key) {
      if (day < from) from = day;
      if (day > to) to = day;
    }
    day = addYmd(day, 1);
    guard += 1;
  }
  if (from > to) return { from: range.from, to: range.from };
  return { from, to };
}

/**
 * Trendreeks voor de cockpit-chart (dag / week / maand).
 * `blocksByYmd` = beschikbare blokken per kalenderdag.
 */
export function buildTrendSeries(input: {
  dossiers: Dossier[];
  appointments: RawAppt[];
  leadStatusById: Map<string, string>;
  appointmentsByLead: Map<string, RawAppt[]>;
  range: DateRange;
  group: GroupBy;
  selectedWeekKey?: string;
  todayYmd: string;
  blocksByYmd: Map<string, number>;
}): TrendPoint[] {
  const buckets = listBuckets(input.range, input.group);
  return buckets.map((b) => {
    const span = bucketRange(input.range, input.group, b.key);
    const overview = buildWeekOverview({
      dossiers: input.dossiers,
      appointments: input.appointments,
      leadStatusById: input.leadStatusById,
      appointmentsByLead: input.appointmentsByLead,
      week: { ...span, key: b.key },
      todayYmd: input.todayYmd,
      label: b.label,
      isCurrent: false,
      availableBlocksTotal: 0,
      planbaarAdvisors: 0,
    });

    let availableBlocks = 0;
    let day = span.from;
    let guard = 0;
    while (day <= span.to && guard < 4000) {
      availableBlocks += input.blocksByYmd.get(day) || 0;
      day = addYmd(day, 1);
      guard += 1;
    }
    const capacityFillPct =
      availableBlocks > 0
        ? round1((overview.physicalBooked / availableBlocks) * 100)
        : null;

    return {
      key: b.key,
      label: b.label,
      from: span.from,
      to: span.to,
      isSelected: Boolean(
        input.selectedWeekKey && b.key === input.selectedWeekKey
      ),
      deals: overview.deals,
      aanbetalingenInc: overview.aanbetalingenInc,
      orderwaardeEx: overview.orderwaardeEx,
      orderwaardeInc: overview.orderwaardeInc,
      ingepland: overview.ingepland,
      gelopen: overview.gelopen,
      advisorsActive: overview.advisorsWithAppointments,
      availableBlocks,
      capacityFillPct,
      conversionGelopenSalePct: overview.conversionNieuwGelopenSalePct,
    };
  });
}

/** @deprecated gebruik buildTrendSeries */
export function buildWeekTrend(input: {
  dossiers: Dossier[];
  appointments: RawAppt[];
  leadStatusById: Map<string, string>;
  appointmentsByLead: Map<string, RawAppt[]>;
  weeks: { key: string; from: string; to: string; label: string }[];
  selectedWeekKey: string;
  todayYmd: string;
  blocksByWeekKey: Map<string, number>;
  planbaarAdvisorsByWeekKey?: Map<string, number>;
}): TrendPoint[] {
  if (input.weeks.length === 0) return [];
  const range = {
    from: input.weeks[0]!.from,
    to: input.weeks[input.weeks.length - 1]!.to,
  };
  const blocksByYmd = new Map<string, number>();
  for (const w of input.weeks) {
    const total = input.blocksByWeekKey.get(w.key) || 0;
    const days = Math.max(1, Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1);
    // Benadering: gelijk verdelen over dagen in de week (legacy helper).
    const perDay = total / days;
    let day = w.from;
    while (day <= w.to) {
      blocksByYmd.set(day, (blocksByYmd.get(day) || 0) + perDay);
      day = addYmd(day, 1);
    }
  }
  return buildTrendSeries({
    dossiers: input.dossiers,
    appointments: input.appointments,
    leadStatusById: input.leadStatusById,
    appointmentsByLead: input.appointmentsByLead,
    range,
    group: "week",
    selectedWeekKey: input.selectedWeekKey,
    todayYmd: input.todayYmd,
    blocksByYmd,
  });
}

export function buildCockpitOverview(input: {
  dossiers: Dossier[];
  appointments: RawAppt[];
  leadStatusById: Map<string, string>;
  appointmentsByLead: Map<string, RawAppt[]>;
  range: DateRange;
  group: GroupBy;
  todayYmd: string;
  activeAdvisorIds: string[];
  /** Beschikbare tijdblokken per ymd over de periode (som over planbare adviseurs). */
  blocksByYmd: Map<string, number>;
}): CockpitOverview {
  const {
    dossiers,
    appointments,
    leadStatusById,
    appointmentsByLead,
    range,
    group,
    todayYmd,
    activeAdvisorIds,
    blocksByYmd,
  } = input;

  const activeSet = new Set(activeAdvisorIds);
  const advisorsActive = activeAdvisorIds.length;

  const conversionRates: number[] = [];
  for (const id of activeSet) {
    const mine = dossiers.filter(
      (d) => d.adviseurId === id && isAttributed(d)
    );
    let gelopen = 0;
    let sold = 0;
    for (const row of mine) {
      if (row.gelopen && ymdInRange(row.conversationYmd, range)) {
        gelopen += 1;
        if (row.stand === "sale") sold += 1;
      }
    }
    if (gelopen > 0) conversionRates.push((sold / gelopen) * 100);
  }
  const avgAdvisorConversionPct =
    conversionRates.length > 0
      ? round1(
          conversionRates.reduce((s, n) => s + n, 0) / conversionRates.length
        )
      : null;

  let deals = 0;
  let dealsWithDepositDue = 0;
  let dealsDeposited = 0;
  let omzetEx = 0;
  let winstEx = 0;
  let winstN = 0;
  for (const row of dossiers) {
    if (!ymdInRange(row.signedYmd, range)) continue;
    if (row.cancelled) continue;
    deals += 1;
    omzetEx = round2(omzetEx + row.signedEx);
    if (row.marginEx != null) {
      winstEx = round2(winstEx + row.marginEx);
      winstN += 1;
    }
    if (!row.depositNone) {
      dealsWithDepositDue += 1;
      if (row.depositMet) dealsDeposited += 1;
    }
  }

  const visitsInPeriod = huisbezoekenInRange(appointments, range);
  let gelopen = 0;
  let nietGelopen = 0;
  let open = 0;
  const gelopenOutcomes = new Map<string, number>();
  const nietGelopenOutcomes = new Map<string, number>();
  const openOutcomes = new Map<string, number>();
  for (const appt of visitsInPeriod) {
    const { klasse, outcome } = classifyVisit(
      appt,
      leadStatusById.get(appt.leadId) || "",
      appointmentsByLead.get(appt.leadId) ?? [],
      todayYmd
    );
    if (klasse === "gelopen") {
      gelopen += 1;
      bumpOutcome(gelopenOutcomes, outcome);
    } else if (klasse === "niet_gelopen") {
      nietGelopen += 1;
      bumpOutcome(nietGelopenOutcomes, outcome);
    } else {
      open += 1;
      bumpOutcome(openOutcomes, outcome);
    }
  }
  const ingepland = visitsInPeriod.length;
  const allSlices: CockpitVisitSlice[] = [
    {
      key: "gelopen",
      label: "Gelopen",
      n: gelopen,
      pct: pct(gelopen, ingepland) ?? 0,
      color: "#0d5c32",
      outcomes: outcomeList(gelopenOutcomes),
    },
    {
      key: "niet_gelopen",
      label: "Niet gelopen",
      n: nietGelopen,
      pct: pct(nietGelopen, ingepland) ?? 0,
      color: "#e65100",
      outcomes: outcomeList(nietGelopenOutcomes),
    },
    {
      key: "open",
      label: "Nog open",
      n: open,
      pct: pct(open, ingepland) ?? 0,
      color: "#64748b",
      outcomes: outcomeList(openOutcomes),
    },
  ];
  const slices = allSlices.filter((s) => s.n > 0);

  const buckets = listBuckets(range, group);
  const volumeTrend: CockpitTrendPoint[] = buckets.map((b) => {
    let bucketDeals = 0;
    let bucketIngepland = 0;
    let bucketGelopen = 0;
    let dossierGelopen = 0;
    let dossierSold = 0;
    let bucketBlocks = 0;

    for (const row of dossiers) {
      if (
        row.signedYmd &&
        !row.cancelled &&
        ymdInRange(row.signedYmd, range) &&
        bucketKey(row.signedYmd, group) === b.key
      ) {
        bucketDeals += 1;
      }
      if (
        row.gelopen &&
        row.conversationYmd &&
        ymdInRange(row.conversationYmd, range) &&
        bucketKey(row.conversationYmd, group) === b.key
      ) {
        dossierGelopen += 1;
        if (row.stand === "sale") dossierSold += 1;
      }
    }

    for (const appt of visitsInPeriod) {
      const ymd = isoToYmd(appt.startAt);
      if (!ymd || bucketKey(ymd, group) !== b.key) continue;
      bucketIngepland += 1;
      const { klasse } = classifyVisit(
        appt,
        leadStatusById.get(appt.leadId) || "",
        appointmentsByLead.get(appt.leadId) ?? [],
        todayYmd
      );
      if (klasse === "gelopen") bucketGelopen += 1;
    }

    let day = range.from;
    let guard = 0;
    while (day <= range.to && guard < 4000) {
      if (bucketKey(day, group) === b.key) {
        bucketBlocks += blocksByYmd.get(day) || 0;
      }
      day = addYmd(day, 1);
      guard += 1;
    }

    return {
      key: b.key,
      label: b.label,
      deals: bucketDeals,
      ingepland: bucketIngepland,
      gelopen: bucketGelopen,
      blokken: bucketBlocks,
      convIngeplandGelopen: pct(bucketGelopen, bucketIngepland),
      convGelopenDeal: pct(dossierSold, dossierGelopen),
    };
  });

  return {
    advisorsActive,
    avgAdvisorConversionPct,
    deals,
    dealsWithDepositDue,
    dealsDeposited,
    depositPct: pct(dealsDeposited, dealsWithDepositDue),
    omzetEx,
    winstEx: winstN > 0 ? winstEx : null,
    visits: {
      ingepland,
      gelopen,
      nietGelopen,
      open,
      slices,
    },
    volumeTrend,
    conversionTrend: volumeTrend,
  };
}

/** Kwaliteit van getekende sales per adviseur (aanbetaling + hold + tijdig). */
export type SalesQualityAdvisorRow = {
  id: string;
  naam: string;
  actief: boolean;
  deals: number;
  /** Deals met vereiste aanbetaling die volledig zijn ontvangen. */
  aanbetaald: number;
  /** Deals waarbij aanbetaling vereist is. */
  dealsWithDepositDue: number;
  aanbetaaldPct: number | null;
  /** Deals waarvan het project nu op hold_sales_actie staat. */
  hold: number;
  holdPct: number | null;
  /** Op tijd t.o.v. BO-bel + factuur (+3 dagen). */
  tijdig: number;
  /** Deals met bekende uitkomst (op tijd of te laat). */
  tijdigBeoordeeld: number;
  tijdigPct: number | null;
};

export type SalesQualityOverview = {
  from: string;
  to: string;
  label: string;
  deals: number;
  aanbetaald: number;
  dealsWithDepositDue: number;
  aanbetaaldPct: number | null;
  hold: number;
  holdPct: number | null;
  tijdig: number;
  tijdigBeoordeeld: number;
  tijdigPct: number | null;
  advisors: SalesQualityAdvisorRow[];
};

/**
 * Saleskwaliteit in een periode: getekende deals per adviseur,
 * aanbetalingsgraad en aandeel dat nu op hold sales actie staat.
 */
export function buildSalesQuality(input: {
  advisors: { id: string; naam: string; actief: boolean }[];
  dossiers: Dossier[];
  projects: { leadId: string; offerteId: string | null; status: string }[];
  range: DateRange;
}): SalesQualityOverview {
  const { advisors, dossiers, projects, range } = input;

  const holdLeadIds = new Set<string>();
  const holdOfferIds = new Set<string>();
  for (const p of projects) {
    if (p.status !== "hold_sales_actie") continue;
    holdLeadIds.add(p.leadId);
    if (p.offerteId) holdOfferIds.add(p.offerteId);
  }

  type Acc = {
    id: string;
    naam: string;
    actief: boolean;
    deals: number;
    aanbetaald: number;
    dealsWithDepositDue: number;
    hold: number;
    tijdig: number;
    tijdigBeoordeeld: number;
  };
  const rows = new Map<string, Acc>();
  for (const a of advisors) {
    rows.set(a.id, {
      id: a.id,
      naam: a.naam,
      actief: a.actief,
      deals: 0,
      aanbetaald: 0,
      dealsWithDepositDue: 0,
      hold: 0,
      tijdig: 0,
      tijdigBeoordeeld: 0,
    });
  }

  let deals = 0;
  let aanbetaald = 0;
  let dealsWithDepositDue = 0;
  let hold = 0;
  let tijdig = 0;
  let tijdigBeoordeeld = 0;

  for (const dossier of dossiers) {
    if (!ymdInRange(dossier.signedYmd, range)) continue;
    if (dossier.cancelled) continue;
    if (!isAttributed(dossier) || !dossier.adviseurId) continue;

    const row = rows.get(dossier.adviseurId);
    if (!row) continue;

    deals += 1;
    row.deals += 1;

    if (!dossier.depositNone) {
      dealsWithDepositDue += 1;
      row.dealsWithDepositDue += 1;
      if (dossier.depositMet) {
        aanbetaald += 1;
        row.aanbetaald += 1;
      }
    }

    const onHold =
      (dossier.offerId != null && holdOfferIds.has(dossier.offerId)) ||
      holdLeadIds.has(dossier.leadId);
    if (onHold) {
      hold += 1;
      row.hold += 1;
    }

    if (dossier.timelyDepositKnown != null) {
      tijdigBeoordeeld += 1;
      row.tijdigBeoordeeld += 1;
      if (dossier.timelyDepositKnown) {
        tijdig += 1;
        row.tijdig += 1;
      }
    }
  }

  const advisorsOut: SalesQualityAdvisorRow[] = [...rows.values()]
    .filter((r) => r.deals > 0)
    .map((r) => ({
      ...r,
      aanbetaaldPct: pct(r.aanbetaald, r.dealsWithDepositDue),
      holdPct: pct(r.hold, r.deals),
      tijdigPct: pct(r.tijdig, r.tijdigBeoordeeld),
    }))
    .sort(
      (a, b) =>
        b.deals - a.deals ||
        (b.tijdigPct ?? -1) - (a.tijdigPct ?? -1) ||
        (b.aanbetaaldPct ?? -1) - (a.aanbetaaldPct ?? -1) ||
        a.naam.localeCompare(b.naam, "nl")
    );

  return {
    from: range.from,
    to: range.to,
    label: formatRangeLabel(range),
    deals,
    aanbetaald,
    dealsWithDepositDue,
    aanbetaaldPct: pct(aanbetaald, dealsWithDepositDue),
    hold,
    holdPct: pct(hold, deals),
    tijdig,
    tijdigBeoordeeld,
    tijdigPct: pct(tijdig, tijdigBeoordeeld),
    advisors: advisorsOut,
  };
}
