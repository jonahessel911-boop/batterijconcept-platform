import {
  normalizeFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";

/**
 * Portaal-werkstatussen (Edwin) ↔ BO-financieringspipeline.
 *
 * Leesrichting:
 *   afwachten_contact   ← null | doorgestuurd | documenten  (geen afspraak)
 *   afspraak_inplannen  ← contact_verstuurd                 (geen afspraak)
 *   afspraak_ingepland  ← heeft warmtefonds_afspraak_at + nog vóór in_behandeling
 *   in_behandeling      ← in_behandeling
 *   goedgekeurd         ← aanbod_ondertekenen
 *   declaratie          ← declaratie_indienen | wacht_op_betaling
 *   afgerond            ← uitbetaald
 *   (buiten portaal)    ← afgewezen
 *
 * Schrijfrichting: zie patchVoorWerkStatus.
 */
export const WF_WERK_STATUSSEN = [
  "afwachten_contact",
  "afspraak_inplannen",
  "afspraak_ingepland",
  "in_behandeling",
  "goedgekeurd",
  "declaratie",
  "afgerond",
] as const;

export type WfWerkStatus = (typeof WF_WERK_STATUSSEN)[number];

/**
 * Labels voor Edwin — 1:1 met BO-fase, zonder dubbele “klaar”-suggestie.
 *
 * goedgekeurd  = Warmtefonds heeft goedgekeurd → klant tekent aanbod
 *                (BO: aanbod_ondertekenen)
 * declaratie   = declaratie indienen óf al ingediend / wacht op betaling
 *                (BO: declaratie_indienen | wacht_op_betaling)
 * afgerond     = uitbetaald
 */
export const WF_WERK_LABEL: Record<WfWerkStatus, string> = {
  afwachten_contact: "Afwachten contact",
  afspraak_inplannen: "Afspraak inplannen",
  afspraak_ingepland: "Afspraak ingepland",
  in_behandeling: "WF in behandeling",
  goedgekeurd: "Aanbod ondertekenen",
  declaratie: "Declaratie",
  afgerond: "Afgerond",
};

/** Korte uitleg per stap — wat jij doet / wat het systeem doet. */
export const WF_WERK_STAP_UITLEG: Record<WfWerkStatus, string> = {
  afwachten_contact:
    "Bel of mail de klant. Markeer contact → status wordt Afspraak inplannen.",
  afspraak_inplannen:
    "Plan de WF-afspraak. Klant krijgt bevestiging per mail → status Afspraak ingepland.",
  afspraak_ingepland:
    "Na het gesprek: zet door naar WF in behandeling.",
  in_behandeling:
    "Warmtefonds behandelt de aanvraag. Bij doorzetten naar hier: Edergy-creditfactuur wordt aangemaakt.",
  goedgekeurd:
    "WF akkoord. Concept-restantfactuur wordt klaargezet — verstuur die naar de klant.",
  declaratie:
    "Declaratie indienen / wachten op uitbetaling.",
  afgerond: "Uitbetaald — klaar in de WF-flow.",
};

/** Standaardlijst: wachten tot de afspraak gezet wordt. */
export const WF_WERK_STANDAARD: WfWerkStatus[] = ["afspraak_inplannen"];

/** Volgende status in de keten (null = klaar). */
export function volgendeWerkStatus(
  status: WfWerkStatus | null
): WfWerkStatus | null {
  if (!status) return null;
  const idx = WF_WERK_STATUSSEN.indexOf(status);
  if (idx < 0 || idx >= WF_WERK_STATUSSEN.length - 1) return null;
  return WF_WERK_STATUSSEN[idx + 1]!;
}

/**
 * Wat er moet gebeuren om van deze status door te kunnen.
 * contact/afspraak = actie eerst; status = mag direct doorzetten.
 */
export function poortVoorWerkStatus(status: WfWerkStatus | null): {
  soort: "contact" | "afspraak" | "status" | "klaar";
  volgende: WfWerkStatus | null;
  titel: string;
  uitleg: string;
  ctaLabel: string | null;
} {
  const volgende = volgendeWerkStatus(status);
  if (!status || status === "afgerond") {
    return {
      soort: "klaar",
      volgende: null,
      titel: "Afgerond",
      uitleg: "Deze aanvraag is klaar in de Warmtefonds-flow.",
      ctaLabel: null,
    };
  }
  if (status === "afwachten_contact") {
    return {
      soort: "contact",
      volgende: "afspraak_inplannen",
      titel: "Contact met de klant",
      uitleg: WF_WERK_STAP_UITLEG.afwachten_contact,
      ctaLabel: "Contact opnemen",
    };
  }
  if (status === "afspraak_inplannen") {
    return {
      soort: "afspraak",
      volgende: "afspraak_ingepland",
      titel: "WF-afspraak zetten",
      uitleg: WF_WERK_STAP_UITLEG.afspraak_inplannen,
      ctaLabel: "Maak WF afspraak",
    };
  }
  if (status === "afspraak_ingepland") {
    return {
      soort: "status",
      volgende: "in_behandeling",
      titel: "Naar WF in behandeling",
      uitleg:
        "Na het gesprek: zet door. Bij deze stap wordt de Edergy-creditfactuur aangemaakt (één keer per aanvraag).",
      ctaLabel: "Zet door → WF in behandeling",
    };
  }
  if (status === "in_behandeling") {
    return {
      soort: "status",
      volgende: "goedgekeurd",
      titel: "Naar aanbod ondertekenen",
      uitleg:
        "Zodra Warmtefonds akkoord is: zet door. Systeem zet dan een concept-restantfactuur klaar onder Documenten.",
      ctaLabel: "Zet door → Aanbod ondertekenen",
    };
  }
  if (status === "goedgekeurd") {
    return {
      soort: "status",
      volgende: "declaratie",
      titel: "Restantfactuur versturen",
      uitleg: WF_WERK_STAP_UITLEG.goedgekeurd,
      ctaLabel: "Zet door → Declaratie",
    };
  }
  // declaratie
  return {
    soort: "status",
    volgende: "afgerond",
    titel: "Afronden",
    uitleg: WF_WERK_STAP_UITLEG.declaratie,
    ctaLabel: "Zet door → Afgerond",
  };
}

type WerkBron = {
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
};

/** Vroege pipeline — nog vóór “in behandeling”. */
function isVroegeFinanciering(
  n: FinancieringStatus | null
): boolean {
  return (
    !n ||
    n === "doorgestuurd_naar_edwin" ||
    n === "documenten_aanleveren" ||
    n === "contact_verstuurd"
  );
}

/**
 * Afgeleid uit financiering_status + of er een WF-afspraak staat.
 * Afgewezen valt buiten de zeven statussen (null).
 */
export function wfWerkStatusVan(row: WerkBron): WfWerkStatus | null {
  const n = normalizeFinancieringStatus(row.financiering_status);
  if (n === "afgewezen") return null;
  if (n === "uitbetaald") return "afgerond";
  if (n === "declaratie_indienen" || n === "wacht_op_betaling") {
    return "declaratie";
  }
  if (n === "aanbod_ondertekenen") return "goedgekeurd";
  if (n === "in_behandeling") return "in_behandeling";

  // Afspraak telt alleen zolang de BO-fase nog vroeg is
  // (zelfde regel als BO-kanban `isWfAfspraakIngepland`).
  if (row.warmtefonds_afspraak_at && isVroegeFinanciering(n)) {
    return "afspraak_ingepland";
  }

  // Contact gehad → klaar om afspraak te plannen
  if (n === "contact_verstuurd") return "afspraak_inplannen";

  // Doorgestuurd / documenten / nog geen fase → eerst contact
  if (
    n === "doorgestuurd_naar_edwin" ||
    n === "documenten_aanleveren" ||
    !n
  ) {
    return "afwachten_contact";
  }

  return "afwachten_contact";
}

/** Wat het portaal wegschrijft als iemand een werkstatus kiest. */
export function patchVoorWerkStatus(status: WfWerkStatus): {
  financiering_status: FinancieringStatus | null;
  warmtefonds_afspraak_at?: null;
} {
  switch (status) {
    case "afwachten_contact":
      // Terug naar “doorgestuurd” — blijft in portaal + BO-rij doorgestuurd.
      return {
        financiering_status: "doorgestuurd_naar_edwin",
        warmtefonds_afspraak_at: null,
      };
    case "afspraak_inplannen":
      // Zelfde als Contact-actie in BO/portaal.
      return {
        financiering_status: "contact_verstuurd",
        warmtefonds_afspraak_at: null,
      };
    case "afspraak_ingepland":
      // Afspraak impliceert contact; status niet terugzetten naar doorgestuurd.
      return { financiering_status: "contact_verstuurd" };
    case "in_behandeling":
      return { financiering_status: "in_behandeling" };
    case "goedgekeurd":
      return { financiering_status: "aanbod_ondertekenen" };
    case "declaratie":
      return { financiering_status: "declaratie_indienen" };
    case "afgerond":
      return { financiering_status: "uitbetaald" };
  }
}
