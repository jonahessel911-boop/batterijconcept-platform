import {
  buildRelatieFactuurPdf,
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

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRef(
  text: string,
  label: "Offerte" | "Project",
  value: string | null | undefined
): string {
  if (!value) return text;
  const re1 = new RegExp(`\\s*·\\s*${label}\\s+${escapeRe(value)}`, "i");
  const re2 = new RegExp(`${label}\\s+${escapeRe(value)}\\s*·\\s*`, "i");
  return text.replace(re1, "").replace(re2, "");
}

function defaultCommissieOmschrijving(notities: string | null): string {
  const n = notities || "";
  if (/tranche_b|rest-commissie|rest commissie/i.test(n)) {
    return "Commissie restant (10% omzet excl. btw − €250)";
  }
  return "Commissie 1e deel (€250 excl. btw bij aanbetaling)";
}

export async function buildAdviseurCreditfactuurPdf(
  input: Input
): Promise<Blob> {
  const regels: RelatieFactuurRegel[] =
    input.regels.length > 0
      ? input.regels.map((r) => {
          let base =
            r.omschrijving?.trim() ||
            [
              "Commissie aanbetaling",
              r.lead_naam,
              r.klant_factuur_nummer
                ? `klantfactuur ${r.klant_factuur_nummer}`
                : null,
              r.betaald_op ? `betaald ${r.betaald_op}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
          base = stripRef(base, "Offerte", r.offerte_nummer);
          base = stripRef(base, "Project", r.project_nummer);
          return {
            omschrijving:
              base.replace(/^·\s*|·\s*$/g, "").trim() ||
              "Commissie aanbetaling",
            bedrag: r.fee,
            offerte_nummer: r.offerte_nummer,
            project_nummer: r.project_nummer,
          };
        })
      : [
          {
            omschrijving: defaultCommissieOmschrijving(input.factuur.notities),
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
      notities: input.factuur.notities,
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
