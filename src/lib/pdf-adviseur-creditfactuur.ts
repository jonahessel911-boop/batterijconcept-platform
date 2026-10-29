import {
  buildRelatieFactuurPdf,
  cleanRelatieFactuurNotities,
  type RelatieFactuurIssuer,
  type RelatieFactuurRegel,
} from "@/lib/pdf-relatie-factuur";

type Regel = {
  lead_naam: string | null;
  offerte_nummer: string | null;
  project_nummer?: string | null;
  klant_factuur_nummer: string | null;
  fee: number;
  betaald_op: string | null;
  omschrijving?: string | null;
};

type Input = {
  factuur: {
    factuur_nummer: string;
    factuurdatum: string;
    status: string;
    week_jaar: number;
    week_nummer: number;
    periode_van: string;
    periode_tot: string;
    bedrag_ex_btw: number;
    bedrag_inc_btw: number;
    btw_bedrag: number;
    notities: string | null;
  };
  adviseur: RelatieFactuurIssuer & { naam: string };
  regels: Regel[];
};

function isRestCommissie(
  factuurNummer: string,
  notities: string | null,
  omschrijving?: string | null
): boolean {
  const blob = [factuurNummer, notities, omschrijving].filter(Boolean).join(" ");
  return /RESTBETALING|tranche_b|rest-commissie|rest commissie|ref_offerte_tranche_b/i.test(
    blob
  );
}

function commissieTitel(opts: {
  factuurNummer: string;
  notities: string | null;
  omschrijving?: string | null;
  leadNaam?: string | null;
}): string {
  const rest = isRestCommissie(
    opts.factuurNummer,
    opts.notities,
    opts.omschrijving
  );
  const base = rest ? "Commissie restant" : "Commissie aanbetaling";
  const klant = opts.leadNaam?.trim();
  return klant ? `${base} · ${klant}` : base;
}

export async function buildAdviseurCreditfactuurPdf(
  input: Input
): Promise<Blob> {
  const regels: RelatieFactuurRegel[] =
    input.regels.length > 0
      ? input.regels.map((r) => ({
          omschrijving: commissieTitel({
            factuurNummer: input.factuur.factuur_nummer,
            notities: input.factuur.notities,
            omschrijving: r.omschrijving,
            leadNaam: r.lead_naam,
          }),
          bedrag: r.fee,
          offerte_nummer: r.offerte_nummer,
          project_nummer: r.project_nummer,
        }))
      : [
          {
            omschrijving: commissieTitel({
              factuurNummer: input.factuur.factuur_nummer,
              notities: input.factuur.notities,
            }),
            bedrag: input.factuur.bedrag_ex_btw,
          },
        ];

  return buildRelatieFactuurPdf({
    factuur: {
      factuur_nummer: input.factuur.factuur_nummer,
      factuurdatum: input.factuur.factuurdatum,
      bedrag_ex_btw: input.factuur.bedrag_ex_btw,
      bedrag_inc_btw: input.factuur.bedrag_inc_btw,
      btw_bedrag: input.factuur.btw_bedrag,
      notities: cleanRelatieFactuurNotities(input.factuur.notities),
      week_jaar: input.factuur.week_jaar,
      week_nummer: input.factuur.week_nummer,
      periode_van: input.factuur.periode_van,
      periode_tot: input.factuur.periode_tot,
      status: input.factuur.status,
    },
    issuer: input.adviseur,
    issuerLabel: "Adviseur / ZZP",
    regels,
  });
}
