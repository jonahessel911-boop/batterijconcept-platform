import {
  normalizeFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";

/** Statussen zoals Edwin ze in het portaal ziet. */
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

export const WF_WERK_LABEL: Record<WfWerkStatus, string> = {
  afwachten_contact: "Afwachten contact",
  afspraak_inplannen: "Afspraak inplannen",
  afspraak_ingepland: "Afspraak ingepland",
  in_behandeling: "WF in behandeling",
  goedgekeurd: "WF goedgekeurd",
  declaratie: "Declaratie ingediend",
  afgerond: "Afgerond",
};

/** Standaardlijst: wachten tot de afspraak gezet wordt. */
export const WF_WERK_STANDAARD: WfWerkStatus[] = ["afspraak_inplannen"];

type WerkBron = {
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
};

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
  if (row.warmtefonds_afspraak_at) return "afspraak_ingepland";
  if (
    n === "doorgestuurd_naar_edwin" ||
    n === "documenten_aanleveren"
  ) {
    return "afspraak_inplannen";
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
      return { financiering_status: null, warmtefonds_afspraak_at: null };
    case "afspraak_inplannen":
      return {
        financiering_status: "doorgestuurd_naar_edwin",
        warmtefonds_afspraak_at: null,
      };
    case "afspraak_ingepland":
      return { financiering_status: "doorgestuurd_naar_edwin" };
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
