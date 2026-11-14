import {
  aanbetalingVanOrder,
  heeftGeenAanbetalingNodig,
  isAanbetalingFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { VERVOLG_PUNT_VRIJGESTELD } from "@/lib/afspraak-soort";
import { FACTUUR_BETAALTERMIJN_DAGEN, factuurBetaaltermijnDagen } from "@/lib/factuur-betaling";
import { normalizeProjectStatus } from "@/lib/labels";
import { addYmd, dateOnlyYmd, daysInclusive, isoToYmd } from "@/lib/sales-cockpit/range";
import type { LeadStatus } from "@/types/database";

export type RawAppt = {
  id: string;
  leadId: string;
  adviseurId: string | null;
  plannerId: string | null;
  startAt: string;
  /** Optioneel; anders start + standaard afspraakduur. */
  endAt?: string | null;
  /** Aanmaaktijd — voor “zojuist ingepland” op de wallboard. */
  createdAt?: string | null;
  status: string;
  soort: string | null;
};

export type RawLead = {
  id: string;
  leadNumber: string;
  naam: string;
  status: string;
  bron: string | null;
  /** Eigenaar / maker van de lead (o.a. referral door adviseur). */
  adviseurId?: string | null;
};

export type RawOffer = {
  id: string;
  leadId: string;
  ondertekendOp: string;
  ex: number;
  btw: number;
  inc: number;
  modus: string | null;
  bedragInc: number | null;
  teInnen: number | null;
  financiering: boolean | null;
  /** Wie de offerte aanmaakte — fallback bij referral zonder bezoekafspraak. */
  aangemaaktDoorId?: string | null;
};

export type RawProject = {
  leadId: string;
  offerteId: string | null;
  status: string;
  installatieVoltooidAt: string | null;
  projectkosten: number;
  betaalwijze: string | null;
  /** Eerste backoffice-bel voor schouw + aanbetaling. */
  belSchouwAanbetalingAt?: string | null;
};

export type RawFactuur = {
  leadId: string;
  offerteId: string | null;
  status: string;
  inc: number;
  betaaldOp: string | null;
  creditOf: string | null;
  bunq: boolean;
  omschrijving?: string | null;
  factuurdatum?: string | null;
  vervaldatum?: string | null;
};

export type SalesStand = "open" | "open_vervolg" | "afgeboekt" | "sale";

export type BezoekKlasse =
  | "gesprek"
  | "deur_dicht"
  | "afgezegd"
  | "geannuleerd"
  | "onbekend"
  | "gepland";

export type Dossier = {
  leadId: string;
  leadNumber: string;
  naam: string;
  bron: string | null;
  status: string;
  adviseurId: string | null;
  /**
   * Hoe de sale is toegeschreven:
   * - afspraak: via bezoekafspraak
   * - offerte: via offerte.aangemaakt_door_id (referral / zelf aangemaakt)
   * - lead: via lead.adviseur_id
   * - onzeker: niet toerekenbaar
   */
  attribution: "afspraak" | "offerte" | "lead" | "onzeker";
  plannerId: string | null;
  financiering: "warmtefonds" | "eigen_middelen" | "onbekend";
  assignmentYmd: string | null;
  conversationYmd: string | null;
  gelopen: boolean;
  /** Huidige leadstatus of ontbrekende bezoekuitkomst: benadering. */
  gelopenBenadering: boolean;
  stand: SalesStand;
  bezoek: BezoekKlasse;
  vervolgYmd: string | null;
  signedYmd: string | null;
  signedEx: number;
  signedInc: number;
  offerId: string | null;
  extraOrders: number;
  extraEx: number;
  depositRequiredInc: number;
  depositNone: boolean;
  depositMet: boolean;
  depositYmd: string | null;
  depositDateQuality: "bunq" | "ingevoerd" | "onbekend" | null;
  payDays: number | null;
  /** null = niet van toepassing of datum onbekend */
  timelyKnown: boolean | null;
  /**
   * Start betaaltermijn: latere van BO-bel en verstuurde aanbetalingsfactuur
   * (fallback: alleen factuur of alleen bel als de andere ontbreekt).
   * Deadline = start + 3 dagen (FACTUUR_BETAALTERMIJN_DAGEN).
   */
  depositClockStartYmd: string | null;
  depositPayDeadlineYmd: string | null;
  /**
   * Op tijd t.o.v. betaalklok (+3 dagen).
   * null = n.v.t., nog lopend, of data incompleet.
   */
  timelyDepositKnown: boolean | null;
  inTerm: boolean;
  openOver7: boolean;
  cancelled: boolean;
  conflict: boolean;
  netto: boolean;
  nettoYmd: string | null;
  projectkosten: number;
  commissiePct: number;
  marginEx: number | null;
};

const TERMINAL_NO_SALE = new Set([
  "vervolg_geen_contact",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
  "geen_interesse",
  "geen_interesse_al_batterij",
  "geen_interesse_plugin",
  "geen_interesse_alleen_info",
  "geen_interesse_vertrouwt_niet",
  "deur_niet_open",
  "afspraak_afgezegd_klant",
  "geen_contact",
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
]);

const CONVERSATION_STATUS = new Set([
  "vervolg_fysiek",
  "vervolg_tel",
  "vervolg_geen_contact",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
  "sale_financiering",
  "sale_eigen_middelen",
  "deal",
]);

const VERVOLG_SOORT = new Set(["vervolg_fysiek", "vervolg_tel", "vervolg_punt"]);

function soortOf(soort: string | null | undefined): string {
  const s = (soort || "").trim();
  return s || "nieuw";
}

function isPhysical(soort: string | null | undefined): boolean {
  const s = soortOf(soort);
  return s === "nieuw" || s === "vervolg_fysiek";
}

function isFollowUp(soort: string | null | undefined): boolean {
  return VERVOLG_SOORT.has(soortOf(soort));
}

function active(a: RawAppt): boolean {
  return a.status !== "geannuleerd";
}

function ymdOf(a: RawAppt): string | null {
  return isoToYmd(a.startAt);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysFrom(signYmd: string, payYmd: string): number {
  return daysInclusive(signYmd, payYmd) - 1;
}

/** Sale is toegeschreven aan een adviseur (afspraak, offerte-maker of lead-eigenaar). */
export function isAttributed(row: {
  adviseurId: string | null;
  attribution: Dossier["attribution"];
}): boolean {
  return row.adviseurId != null && row.attribution !== "onzeker";
}

export function classifyLead(input: {
  lead: RawLead;
  appointments: RawAppt[];
  offers: RawOffer[];
  projects: RawProject[];
  invoices: RawFactuur[];
  commissiePct?: number | null;
  todayYmd: string;
}): Dossier {
  const appts = [...input.appointments].sort((a, b) =>
    a.startAt.localeCompare(b.startAt)
  );
  const nieuw = appts.filter((a) => soortOf(a.soort) === "nieuw");
  const firstNieuw = nieuw[0] ?? null;
  const firstActiveNieuw = nieuw.find(active) ?? null;
  const followUps = appts.filter((a) => active(a) && isFollowUp(a.soort));
  const physical = appts.filter((a) => active(a) && isPhysical(a.soort));

  const signed = [...input.offers]
    .filter((o) => o.ondertekendOp)
    .sort((a, b) => a.ondertekendOp.localeCompare(b.ondertekendOp));
  const primary = signed[0] ?? null;
  const extras = signed.slice(1);
  const signedYmd = primary ? dateOnlyYmd(primary.ondertekendOp) ?? isoToYmd(primary.ondertekendOp) : null;

  const status = input.lead.status || "";
  const hasFollowUp = followUps.length > 0;
  const conversationByStatus = CONVERSATION_STATUS.has(status);
  const sold = Boolean(primary && signedYmd);

  let gelopen = false;
  let gelopenBenadering = false;
  let conversationYmd: string | null = null;

  if (hasFollowUp) {
    gelopen = true;
    const firstFollow = followUps[0]!;
    const prior = physical.filter(
      (a) => a.startAt < firstFollow.startAt && soortOf(a.soort) === "nieuw"
    );
    const anchor = prior[0] ?? physical.find((a) => a.startAt <= firstFollow.startAt) ?? firstActiveNieuw;
    conversationYmd = anchor ? ymdOf(anchor) : null;
    gelopenBenadering = !anchor || prior.length === 0;
  } else if (sold && signedYmd) {
    gelopen = true;
    const prior = physical.filter((a) => {
      const ymd = ymdOf(a);
      return ymd != null && ymd <= signedYmd;
    });
    const anchor = prior[prior.length - 1] ?? null;
    conversationYmd = anchor ? ymdOf(anchor) : null;
    gelopenBenadering = !anchor;
  } else if (conversationByStatus) {
    gelopen = true;
    gelopenBenadering = true;
    conversationYmd = firstActiveNieuw ? ymdOf(firstActiveNieuw) : physical[0] ? ymdOf(physical[0]) : null;
  } else {
    // Niet-afgeboekt verstreken huisbezoek telt als gelopen (conversie + volume),
    // gelijk aan sales-manager: afgelopen bezoek mét én zonder uitkomst.
    const pastNieuw = nieuw.find((a) => {
      if (!active(a)) return false;
      const ymd = ymdOf(a);
      return ymd != null && ymd <= input.todayYmd;
    });
    const heeftUitkomst =
      VERVOLG_PUNT_VRIJGESTELD.has(status as LeadStatus) || status === "deal";
    if (pastNieuw && !heeftUitkomst) {
      gelopen = true;
      gelopenBenadering = true;
      conversationYmd = ymdOf(pastNieuw);
    }
  }

  if (status === "deur_niet_open" || status === "afspraak_afgezegd_klant") {
    if (!hasFollowUp && !sold) {
      gelopen = false;
      gelopenBenadering = false;
      conversationYmd = null;
    }
  }

  const terminal = TERMINAL_NO_SALE.has(status);
  let stand: SalesStand;
  if (sold) stand = "sale";
  else if (terminal) stand = "afgeboekt";
  else if (
    hasFollowUp ||
    status === "vervolg_fysiek" ||
    status === "vervolg_tel"
  ) {
    stand = "open_vervolg";
  } else stand = "open";

  let bezoek: BezoekKlasse = "onbekend";
  if (gelopen) bezoek = "gesprek";
  else if (status === "deur_niet_open") bezoek = "deur_dicht";
  else if (status === "afspraak_afgezegd_klant") bezoek = "afgezegd";
  else if (nieuw.length > 0 && nieuw.every((a) => a.status === "geannuleerd")) {
    bezoek = "geannuleerd";
  } else if (firstActiveNieuw && (ymdOf(firstActiveNieuw) ?? "") > input.todayYmd) {
    bezoek = "gepland";
  }

  const nextFollow = followUps.find((a) => (ymdOf(a) ?? "") >= input.todayYmd) ?? followUps[followUps.length - 1];
  const vervolgYmd = stand === "open_vervolg" && nextFollow ? ymdOf(nextFollow) : null;

  const projectForOffer = primary
    ? input.projects.find((p) => p.offerteId === primary.id) ?? input.projects[0] ?? null
    : input.projects[0] ?? null;
  const projectStatus = projectForOffer
    ? normalizeProjectStatus(projectForOffer.status)
    : null;
  const cancelled = projectStatus === "annulering";
  const nettoYmd = projectForOffer
    ? dateOnlyYmd(projectForOffer.installatieVoltooidAt) ??
      isoToYmd(projectForOffer.installatieVoltooidAt)
    : null;
  const conflict = Boolean(cancelled && nettoYmd);
  const netto = Boolean(nettoYmd) && !cancelled;

  let financiering: Dossier["financiering"] = "onbekend";
  if (
    primary?.financiering ||
    status === "sale_financiering" ||
    projectForOffer?.betaalwijze === "warmtefonds"
  ) {
    financiering = "warmtefonds";
  } else if (status === "sale_eigen_middelen" || projectForOffer?.betaalwijze === "eigen_middelen") {
    financiering = "eigen_middelen";
  }

  const depositNone = primary
    ? heeftGeenAanbetalingNodig({
        aanbetalingTeInnenInc: primary.teInnen,
        aanbetalingModus: primary.modus,
        aanbetalingBedragInc: primary.bedragInc,
        subtotaalExBtw: primary.ex,
        btwBedrag: primary.btw,
        totaalIncBtw: primary.inc,
        financieringVoorbehoud: primary.financiering,
      })
    : false;
  const required = primary
    ? depositNone
      ? 0
      : primary.teInnen != null && Number.isFinite(Number(primary.teInnen))
        ? round2(Number(primary.teInnen))
        : aanbetalingVanOrder({
            subtotaalExBtw: primary.ex,
            btwBedrag: primary.btw,
            totaalIncBtw: primary.inc,
            modus: primary.modus,
            handmatigIncBtw: primary.bedragInc,
            financieringVoorbehoud: primary.financiering,
          }).bedragIncBtw
    : 0;

  const linked = input.invoices.filter(
    (f) => !f.creditOf && f.status !== "vervallen" && f.status !== "concept"
  );
  const forOffer = primary
    ? linked.filter((f) => f.offerteId === primary.id)
    : [];
  const pool = forOffer.length > 0 ? forOffer : linked;
  const paid = pool
    .filter((f) => f.status === "betaald" || f.status === "deels_betaald")
    .map((f) => ({
      inc: f.status === "deels_betaald" ? 0 : round2(Number(f.inc) || 0),
      partial: f.status === "deels_betaald",
      ymd: dateOnlyYmd(f.betaaldOp),
      bunq: f.bunq,
    }))
    .filter((f) => !f.partial && f.inc > 0);

  // Deelbetaling telt niet als volledige ontvangst: status deels_betaald heeft geen betrouwbaar deelbedrag.
  const sortedPaid = [...paid].sort((a, b) => {
    if (a.ymd && b.ymd) return a.ymd.localeCompare(b.ymd);
    if (a.ymd) return -1;
    if (b.ymd) return 1;
    return 0;
  });

  let running = 0;
  let depositYmd: string | null = null;
  let depositDateQuality: Dossier["depositDateQuality"] = null;
  let met = depositNone && sold;
  if (!depositNone && required > 0) {
    for (const p of sortedPaid) {
      running = round2(running + p.inc);
      if (running + 0.009 >= required) {
        met = true;
        depositYmd = p.ymd;
        depositDateQuality = p.ymd ? (p.bunq ? "bunq" : "ingevoerd") : "onbekend";
        break;
      }
    }
  } else if (depositNone) {
    met = sold;
    depositDateQuality = null;
  }

  let payDays: number | null = null;
  if (met && !depositNone && signedYmd && depositYmd) {
    payDays = Math.max(0, daysFrom(signedYmd, depositYmd));
  }

  const deadline = signedYmd ? addYmd(signedYmd, 7) : null;
  const termOver = Boolean(deadline && input.todayYmd > deadline);
  const inTerm = Boolean(
    sold && !cancelled && !depositNone && !met && deadline && input.todayYmd <= deadline
  );
  const openOver7 = Boolean(sold && !cancelled && !depositNone && !met && termOver);
  const timelyKnown =
    !sold || depositNone
      ? null
      : !termOver && !met
        ? null
        : met && !depositYmd
          ? null
          : met && depositYmd && deadline
            ? depositYmd <= deadline
            : termOver && !met
              ? false
              : null;

  // Op-tijd-regel: 3 dagen na start van de betaalklok.
  // Ideaal: latere van eerste BO-bel én verstuurde aanbetalingsfactuur.
  // Fallback: alleen factuurdatum als bel-timestamp ontbreekt (kolom/migratie of
  // historisch niet gezet) — anders is niets beoordeelbaar.
  const belYmd = (() => {
    const raw =
      projectForOffer?.belSchouwAanbetalingAt ||
      input.projects.find((p) => p.belSchouwAanbetalingAt)?.belSchouwAanbetalingAt ||
      null;
    return dateOnlyYmd(raw) ?? isoToYmd(raw);
  })();
  const depositInvoiceSentYmd = (() => {
    const list = input.invoices.filter((f) => {
      if (f.creditOf) return false;
      if (f.status === "concept" || f.status === "vervallen") return false;
      if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) return false;
      if (primary?.id && f.offerteId && f.offerteId !== primary.id) return false;
      return true;
    });
    let best: string | null = null;
    for (const f of list) {
      const verval = dateOnlyYmd(f.vervaldatum) ?? isoToYmd(f.vervaldatum);
      const factuur = dateOnlyYmd(f.factuurdatum) ?? isoToYmd(f.factuurdatum);
      let sent: string | null = null;
      if (verval) {
        const days = factuurBetaaltermijnDagen({
          factuurdatum: factuur,
          vervaldatum: verval,
          fallback: FACTUUR_BETAALTERMIJN_DAGEN,
        });
        sent = addYmd(verval, -days);
      } else {
        sent = factuur;
      }
      if (sent && (!best || sent < best)) best = sent;
    }
    return best;
  })();
  // Betaaldatum bij voorkeur van de aanbetalingsfactuur zelf (nauwkeuriger dan
  // cumulatieve pool van alle betaalde facturen).
  const depositPaidFromInvoiceYmd = (() => {
    const list = input.invoices.filter((f) => {
      if (f.creditOf) return false;
      if (f.status !== "betaald") return false;
      if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) return false;
      if (primary?.id && f.offerteId && f.offerteId !== primary.id) return false;
      return Boolean(dateOnlyYmd(f.betaaldOp) ?? isoToYmd(f.betaaldOp));
    });
    let best: string | null = null;
    for (const f of list) {
      const ymd = dateOnlyYmd(f.betaaldOp) ?? isoToYmd(f.betaaldOp);
      if (ymd && (!best || ymd < best)) best = ymd;
    }
    return best;
  })();
  const timelyPayYmd = depositPaidFromInvoiceYmd || depositYmd;
  const depositClockStartYmd =
    belYmd && depositInvoiceSentYmd
      ? belYmd > depositInvoiceSentYmd
        ? belYmd
        : depositInvoiceSentYmd
      : depositInvoiceSentYmd || belYmd || null;
  const depositPayDeadlineYmd = depositClockStartYmd
    ? addYmd(depositClockStartYmd, FACTUUR_BETAALTERMIJN_DAGEN)
    : null;
  const depositTermOver = Boolean(
    depositPayDeadlineYmd && input.todayYmd > depositPayDeadlineYmd
  );
  const timelyDepositKnown =
    !sold || depositNone
      ? null
      : !depositPayDeadlineYmd
        ? null
        : (met || Boolean(depositPaidFromInvoiceYmd)) && timelyPayYmd
          ? timelyPayYmd <= depositPayDeadlineYmd
          : (met || Boolean(depositPaidFromInvoiceYmd)) && !timelyPayYmd
            ? null
            : depositTermOver && !met && !depositPaidFromInvoiceYmd
              ? false
              : null;

  const sellerAppt = (() => {
    if (sold && signedYmd) {
      const candidates = appts.filter((a) => {
        if (!active(a) || !a.adviseurId) return false;
        const ymd = ymdOf(a);
        return ymd != null && ymd <= signedYmd;
      });
      const physicalHit = [...candidates].reverse().find((a) => isPhysical(a.soort));
      return physicalHit ?? candidates[candidates.length - 1] ?? null;
    }
    if (conversationYmd) {
      const hit = physical.find((a) => ymdOf(a) === conversationYmd && a.adviseurId);
      if (hit) return hit;
    }
    return firstActiveNieuw ?? null;
  })();

  // Zelfde volgorde als resolveSaleAdviseurId: afspraak → offerte-maker → lead-eigenaar.
  // Nodig voor referral-sales waarbij de adviseur zelf een lead aanmaakt zonder
  // (of vóór) een klassiek huisbezoek.
  let adviseurId: string | null = null;
  let attribution: Dossier["attribution"] = "onzeker";
  if (sellerAppt?.adviseurId) {
    adviseurId = sellerAppt.adviseurId;
    attribution = "afspraak";
  } else if (primary?.aangemaaktDoorId) {
    adviseurId = primary.aangemaaktDoorId;
    attribution = "offerte";
  } else if (input.lead.adviseurId) {
    adviseurId = input.lead.adviseurId;
    attribution = "lead";
  }

  const projectkosten = round2(Number(projectForOffer?.projectkosten) || 0);
  const commissiePct = Number(input.commissiePct) || 0;
  const signedEx = round2(Number(primary?.ex) || 0);
  const signedInc = round2(Number(primary?.inc) || 0);
  const marginEx =
    sold && signedEx > 0
      ? round2(signedEx - (signedEx * commissiePct) / 100 - projectkosten)
      : null;

  const assignmentYmd = firstNieuw ? ymdOf(firstNieuw) : physical[0] ? ymdOf(physical[0]) : null;

  return {
    leadId: input.lead.id,
    leadNumber: input.lead.leadNumber,
    naam: input.lead.naam,
    bron: input.lead.bron,
    status,
    adviseurId,
    attribution,
    plannerId: firstNieuw?.plannerId ?? null,
    financiering,
    assignmentYmd,
    conversationYmd: gelopen ? conversationYmd : null,
    gelopen,
    gelopenBenadering: gelopen && gelopenBenadering,
    stand,
    bezoek,
    vervolgYmd,
    signedYmd: sold ? signedYmd : null,
    signedEx: sold ? signedEx : 0,
    signedInc: sold ? signedInc : 0,
    offerId: primary?.id ?? null,
    extraOrders: extras.length,
    extraEx: round2(extras.reduce((s, o) => s + (Number(o.ex) || 0), 0)),
    depositRequiredInc: sold ? required : 0,
    depositNone: sold && depositNone,
    depositMet: sold && met && !depositNone,
    depositYmd: sold && met && !depositNone ? depositYmd : null,
    depositDateQuality: sold && met && !depositNone ? depositDateQuality : null,
    payDays: sold && !depositNone ? payDays : null,
    timelyKnown: sold ? timelyKnown : null,
    depositClockStartYmd: sold && !depositNone ? depositClockStartYmd : null,
    depositPayDeadlineYmd: sold && !depositNone ? depositPayDeadlineYmd : null,
    timelyDepositKnown: sold ? timelyDepositKnown : null,
    inTerm,
    openOver7: Boolean(openOver7 && !cancelled),
    cancelled,
    conflict,
    netto,
    nettoYmd: netto ? nettoYmd : null,
    projectkosten,
    commissiePct,
    marginEx,
  };
}
