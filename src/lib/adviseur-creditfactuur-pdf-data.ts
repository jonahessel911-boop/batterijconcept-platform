import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdviseurCreditfactuurPdf } from "@/lib/pdf-adviseur-creditfactuur";

type FacRow = {
  id: string;
  adviseur_id: string;
  factuur_nummer: string;
  status: string;
  week_jaar: number;
  week_nummer: number;
  periode_van: string;
  periode_tot: string;
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
  factuurdatum: string;
  notities: string | null;
};

type AdvRow = {
  id: string;
  naam: string;
  email?: string | null;
  bedrijfsnaam: string | null;
  kvk_nummer: string | null;
  btw_nummer?: string | null;
  iban: string | null;
  factuur_adres?: string | null;
  factuur_postcode?: string | null;
  factuur_plaats?: string | null;
};

/** Haal offerte- en projectnummers op voor creditregels. */
export async function enrichCreditRegels(
  sb: SupabaseClient,
  regels: {
    bedrag: number;
    omschrijving: string | null;
    factuur_id: string;
    lead_id?: string | null;
  }[]
) {
  const factuurIds = regels.map((r) => r.factuur_id).filter(Boolean);
  if (factuurIds.length === 0) {
    return regels.map((r) => ({
      lead_naam: null as string | null,
      offerte_nummer: null as string | null,
      project_nummer: null as string | null,
      klant_factuur_nummer: null as string | null,
      fee: Number(r.bedrag || 0),
      betaald_op: null as string | null,
      omschrijving: r.omschrijving,
    }));
  }

  const { data: facs } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, lead_id, offerte_id, offertes(offerte_nummer), leads(naam)"
    )
    .in("id", factuurIds);

  const leadIds = [
    ...new Set(
      (facs || [])
        .map((f) => f.lead_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const offerteIds = [
    ...new Set(
      (facs || [])
        .map((f) => f.offerte_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const projectByLead = new Map<string, string>();
  const projectByOfferte = new Map<string, string>();

  if (leadIds.length > 0 || offerteIds.length > 0) {
    let q = sb.from("projecten").select("project_nummer, lead_id, offerte_id");
    if (leadIds.length > 0 && offerteIds.length > 0) {
      q = q.or(
        `lead_id.in.(${leadIds.join(",")}),offerte_id.in.(${offerteIds.join(",")})`
      );
    } else if (leadIds.length > 0) {
      q = q.in("lead_id", leadIds);
    } else {
      q = q.in("offerte_id", offerteIds);
    }
    const { data: projects } = await q;
    for (const p of projects || []) {
      if (p.lead_id) projectByLead.set(p.lead_id as string, p.project_nummer);
      if (p.offerte_id)
        projectByOfferte.set(p.offerte_id as string, p.project_nummer);
    }
  }

  const facMap = new Map(
    (facs || []).map((f) => {
      const off = f.offertes as
        | { offerte_nummer?: string }
        | { offerte_nummer?: string }[]
        | null;
      const offerte_nummer = Array.isArray(off)
        ? off[0]?.offerte_nummer
        : off?.offerte_nummer;
      const lead = f.leads as
        | { naam?: string }
        | { naam?: string }[]
        | null;
      const lead_naam = Array.isArray(lead) ? lead[0]?.naam : lead?.naam;
      return [
        f.id as string,
        {
          factuur_nummer: f.factuur_nummer as string,
          lead_id: f.lead_id as string | null,
          offerte_id: f.offerte_id as string | null,
          offerte_nummer: offerte_nummer || null,
          lead_naam: lead_naam || null,
        },
      ] as const;
    })
  );

  return regels.map((r) => {
    const fac = facMap.get(r.factuur_id);
    const project_nummer =
      (fac?.offerte_id && projectByOfferte.get(fac.offerte_id)) ||
      (fac?.lead_id && projectByLead.get(fac.lead_id)) ||
      null;
    return {
      lead_naam: fac?.lead_naam || null,
      offerte_nummer: fac?.offerte_nummer || null,
      project_nummer,
      klant_factuur_nummer: fac?.factuur_nummer || null,
      fee: Number(r.bedrag || 0),
      betaald_op: null as string | null,
      omschrijving: r.omschrijving,
    };
  });
}

export async function buildAdviseurCreditPdfBytes(
  sb: SupabaseClient,
  fac: FacRow,
  adv: AdvRow
): Promise<Buffer> {
  const { data: regels } = await sb
    .from("adviseur_creditfactuur_regels")
    .select("bedrag, omschrijving, factuur_id, lead_id")
    .eq("creditfactuur_id", fac.id);

  const enriched = await enrichCreditRegels(sb, regels || []);

  const blob = await buildAdviseurCreditfactuurPdf({
    factuur: {
      factuur_nummer: fac.factuur_nummer,
      factuurdatum: fac.factuurdatum,
      status: fac.status,
      week_jaar: fac.week_jaar,
      week_nummer: fac.week_nummer,
      periode_van: fac.periode_van,
      periode_tot: fac.periode_tot,
      bedrag_ex_btw: Number(fac.bedrag_ex_btw || 0),
      bedrag_inc_btw: Number(fac.bedrag_inc_btw || 0),
      btw_bedrag: Number(fac.btw_bedrag || 0),
      notities: fac.notities,
    },
    adviseur: {
      naam: adv.naam,
      email: adv.email,
      bedrijfsnaam: adv.bedrijfsnaam,
      kvk_nummer: adv.kvk_nummer,
      btw_nummer: adv.btw_nummer,
      iban: adv.iban,
      factuur_adres: adv.factuur_adres,
      factuur_postcode: adv.factuur_postcode,
      factuur_plaats: adv.factuur_plaats,
    },
    regels: enriched,
  });

  return Buffer.from(await blob.arrayBuffer());
}
