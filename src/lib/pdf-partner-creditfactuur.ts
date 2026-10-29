import {
  PARTNER_FACTUUR_BETAALTERMIJN_DAGEN,
  buildRelatieFactuurPdf,
  type RelatieFactuurIssuer,
  type RelatieFactuurRegel,
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
  /** Optioneel: expliciete regels (weekfactuur); anders 1 regel per installatie */
  regels?: RelatieFactuurRegel[];
};

const REGELS_JSON_PREFIX = "REGELS_JSON:";

/** Omschrijving op de factuur: Installatie en schouw PRJ-… */
export function partnerInstallatieRegelOmschrijving(
  projectNummer: string | null | undefined
): string {
  const nr = projectNummer?.trim() || "";
  return nr ? `Installatie en schouw ${nr}` : "Installatie en schouw";
}

/**
 * Één regel per installatie: €675 ex (of projectkosten) ·
 * "Installatie en schouw PRJ-…".
 */
export function partnerInstallatieFactuurRegels(opts: {
  projectNummer: string | null | undefined;
  bedragEx: number;
  offerteNummer?: string | null;
  fallbackOmschrijving?: string | null;
}): RelatieFactuurRegel[] {
  const bedrag = Math.round(Math.max(0, opts.bedragEx) * 100) / 100;
  const nr = opts.projectNummer?.trim() || "";
  return [
    {
      omschrijving: nr
        ? partnerInstallatieRegelOmschrijving(nr)
        : opts.fallbackOmschrijving?.trim() || "Installatie en schouw",
      bedrag,
      // Geen offerte/project in subtitel — nummer zit al in de omschrijving
      offerte_nummer: null,
      project_nummer: nr || null,
    },
  ];
}

/** @deprecated Schouw alleen: nu ook 1 regel “Installatie en schouw”. */
export function partnerSchouwFactuurRegel(opts: {
  projectNummer: string;
  bedragEx: number;
  offerteNummer?: string | null;
}): RelatieFactuurRegel {
  return partnerInstallatieFactuurRegels({
    projectNummer: opts.projectNummer,
    bedragEx: opts.bedragEx,
  })[0]!;
}

function extractProjectNummer(r: RelatieFactuurRegel): string | null {
  const fromField = r.project_nummer?.trim();
  if (fromField) {
    // Oude collapse zette soms "PRJ-A, PRJ-B" — niet als één key gebruiken
    if (!fromField.includes(",")) return fromField;
  }
  const m = (r.omschrijving || "").match(/\b(PRJ-[\w-]+)\b/i);
  return m?.[1] || null;
}

/**
 * Weekfactuur: 1 regel per installatie/project.
 * Oude Schouw+Installatie-paren (50/50) worden samengevoegd tot één regel.
 */
export function collapsePartnerWeekRegels(
  regels: RelatieFactuurRegel[]
): RelatieFactuurRegel[] {
  if (regels.length === 0) return [];

  const byProject = new Map<
    string,
    { bedrag: number; omschrijving: string }
  >();
  const zonderProject: RelatieFactuurRegel[] = [];

  for (const r of regels) {
    const bedrag = Math.round((Number(r.bedrag) || 0) * 100) / 100;
    const projectNr = extractProjectNummer(r);
    if (!projectNr) {
      zonderProject.push({
        omschrijving: (r.omschrijving || "Installatie en schouw").trim(),
        bedrag,
        offerte_nummer: null,
        project_nummer: null,
      });
      continue;
    }
    const prev = byProject.get(projectNr);
    if (prev) {
      prev.bedrag = Math.round((prev.bedrag + bedrag) * 100) / 100;
    } else {
      byProject.set(projectNr, {
        bedrag,
        omschrijving: partnerInstallatieRegelOmschrijving(projectNr),
      });
    }
  }

  const out: RelatieFactuurRegel[] = [];
  for (const [projectNr, v] of byProject) {
    out.push({
      omschrijving: v.omschrijving,
      bedrag: v.bedrag,
      offerte_nummer: null,
      project_nummer: projectNr,
    });
  }
  out.push(...zonderProject);

  // Stabiele volgorde op projectnummer
  out.sort((a, b) =>
    (a.project_nummer || a.omschrijving).localeCompare(
      b.project_nummer || b.omschrijving,
      "nl"
    )
  );

  return out.length
    ? out
    : [{ omschrijving: "Installatie en schouw", bedrag: 0 }];
}

export function encodePartnerFactuurRegels(
  regels: RelatieFactuurRegel[],
  humanNotes?: string | null
): string {
  const collapsed = collapsePartnerWeekRegels(regels);
  const json = `${REGELS_JSON_PREFIX}${JSON.stringify(collapsed)}`;
  const human = humanNotes?.trim();
  return human ? `${json}\n${human}` : json;
}

export function parsePartnerFactuurRegels(
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
    return parsed.map((r: RelatieFactuurRegel) => ({
      omschrijving: String(r.omschrijving || "Regel"),
      bedrag: Number(r.bedrag) || 0,
      offerte_nummer: r.offerte_nummer ?? null,
      project_nummer: r.project_nummer ?? null,
    }));
  } catch {
    return null;
  }
}

export function stripPartnerRegelsJson(
  notities: string | null | undefined
): string | null {
  if (!notities) return null;
  const cleaned = notities
    .split("\n")
    .filter((l) => !l.trim().startsWith(REGELS_JSON_PREFIX))
    .join("\n")
    .trim();
  return cleaned || null;
}

export async function buildPartnerCreditfactuurPdf(
  input: Input
): Promise<Blob> {
  const fromJson = parsePartnerFactuurRegels(input.factuur.notities);
  const rawRegels =
    input.regels && input.regels.length > 0
      ? input.regels
      : fromJson && fromJson.length > 0
        ? fromJson
        : partnerInstallatieFactuurRegels({
            projectNummer: input.factuur.project_nummer,
            bedragEx: input.factuur.bedrag_ex_btw,
            offerteNummer: input.factuur.offerte_nummer,
            fallbackOmschrijving: input.factuur.omschrijving,
          });
  const regels = collapsePartnerWeekRegels(rawRegels);

  return buildRelatieFactuurPdf({
    factuur: {
      factuur_nummer: input.factuur.factuur_nummer,
      factuurdatum: input.factuur.factuurdatum,
      bedrag_ex_btw: input.factuur.bedrag_ex_btw,
      bedrag_inc_btw: input.factuur.bedrag_inc_btw,
      btw_bedrag: input.factuur.btw_bedrag,
      notities: stripPartnerRegelsJson(input.factuur.notities),
      week_jaar: input.factuur.week_jaar,
      week_nummer: input.factuur.week_nummer,
      periode_van: input.factuur.periode_van,
      periode_tot: input.factuur.periode_tot,
      status: input.factuur.status,
    },
    issuer: {
      ...input.partner,
      bedrijfsnaam: input.partner.bedrijfsnaam || input.partner.naam,
    },
    issuerLabel: "Installatiepartner",
    regels,
    betaaltermijnDagen: PARTNER_FACTUUR_BETAALTERMIJN_DAGEN,
  });
}

export function formatPartnerCreditFactuurNummer(
  jaar: number,
  seq: number
): string {
  return `PCF-${jaar}-${String(seq).padStart(4, "0")}`;
}

/** Week-key voor unieke weekfactuur: WEEK-2026-W43 */
export function partnerWeekFactuurProjectKey(
  jaar: number,
  week: number
): string {
  return `WEEK-${jaar}-W${String(week).padStart(2, "0")}`;
}
