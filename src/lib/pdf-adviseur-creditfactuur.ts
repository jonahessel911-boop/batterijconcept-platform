import {
  buildRelatieFactuurPdf,
  cleanRelatieFactuurNotities,
  type RelatieFactuurIssuer,
  type RelatieFactuurRegel,
} from "@/lib/pdf-relatie-factuur";
import {
  isBelcommissieCreditfactuur,
  isOpsCommissieCreditfactuur,
} from "@/lib/callcenter-creditfactuur";

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

const REGELS_JSON_PREFIX = "REGELS_JSON:";

function parseEmbeddedRegels(
  notities: string | null | undefined
): RelatieFactuurRegel[] | null {
  if (!notities) return null;
  const line = notities
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(REGELS_JSON_PREFIX));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(REGELS_JSON_PREFIX.length));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((r: { omschrijving?: string; bedrag?: number }) => ({
      omschrijving: String(r.omschrijving || "Regel"),
      bedrag: Number(r.bedrag) || 0,
    }));
  } catch {
    return null;
  }
}

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
  if (opts.omschrijving?.trim()) return opts.omschrijving.trim();
  if (
    isOpsCommissieCreditfactuur({
      factuur_nummer: opts.factuurNummer,
      notities: opts.notities,
    })
  ) {
    return "Opscommissie";
  }
  if (
    isBelcommissieCreditfactuur({
      factuur_nummer: opts.factuurNummer,
      notities: opts.notities,
    })
  ) {
    const match = (opts.notities || "").match(
      /(\d+)\s*×\s*€?\s*10[^\n.]*netto/i
    );
    if (match) {
      return `${match[1]}× €10 netto huisbezoeken`;
    }
    return "Belcommissie · netto huisbezoeken";
  }
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
  const embedded = parseEmbeddedRegels(input.factuur.notities);
  const regels: RelatieFactuurRegel[] =
    embedded && embedded.length > 0
      ? embedded
      : input.regels.length > 0
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
