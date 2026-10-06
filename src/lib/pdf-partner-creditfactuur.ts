import {
  buildRelatieFactuurPdf,
  type RelatieFactuurIssuer,
} from "@/lib/pdf-relatie-factuur";

type Input = {
  factuur: {
    factuur_nummer: string;
    factuurdatum: string;
    status: string;
    week_jaar?: number | null;
    week_nummer?: number | null;
    periode_van?: string | null;
    periode_tot?: string | null;
    bedrag_ex_btw: number;
    bedrag_inc_btw: number;
    btw_bedrag: number;
    omschrijving: string | null;
    notities: string | null;
    offerte_nummer?: string | null;
    project_nummer?: string | null;
  };
  partner: RelatieFactuurIssuer & { naam: string };
};

export async function buildPartnerCreditfactuurPdf(
  input: Input
): Promise<Blob> {
  return buildRelatieFactuurPdf({
    factuur: {
      factuur_nummer: input.factuur.factuur_nummer,
      factuurdatum: input.factuur.factuurdatum,
      bedrag_ex_btw: input.factuur.bedrag_ex_btw,
      bedrag_inc_btw: input.factuur.bedrag_inc_btw,
      btw_bedrag: input.factuur.btw_bedrag,
      notities: input.factuur.notities,
      week_jaar: input.factuur.week_jaar,
      week_nummer: input.factuur.week_nummer,
      periode_van: input.factuur.periode_van,
      periode_tot: input.factuur.periode_tot,
      status: input.factuur.status,
    },
    issuer: input.partner,
    issuerLabel: "Installatiepartner",
    regels: [
      {
        omschrijving:
          input.factuur.omschrijving?.trim() || "Installatiewerkzaamheden",
        bedrag: input.factuur.bedrag_ex_btw,
        offerte_nummer: input.factuur.offerte_nummer,
        project_nummer: input.factuur.project_nummer,
      },
    ],
  });
}

export function formatPartnerCreditFactuurNummer(
  jaar: number,
  seq: number
): string {
  return `PCF-${jaar}-${String(seq).padStart(4, "0")}`;
}
