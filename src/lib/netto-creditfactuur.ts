import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NETTO_AANBETALING_COMMISSIE,
  commissieTrancheB,
  isAanbetalingFactuur,
  nextWednesdayYmd,
} from "@/lib/netto-boord";
import {
  creditWeekFromDate,
  formatCreditFactuurNummer,
} from "@/lib/adviseur-creditfactuur";
import { bedragenMetBtw } from "@/lib/pdf-relatie-factuur";
import { verstuurAdviseurCreditfactuur } from "@/lib/creditfactuur-verstuur";

function offerteRefTag(offerteNummer: string) {
  return `ref_offerte:${offerteNummer}`;
}

function offerteTrancheBTag(offerteNummer: string) {
  return `ref_offerte_tranche_b:${offerteNummer}`;
}

/**
 * Concept commissiefactuur (€250 excl. + 21% btw) bij getekende order.
 * Nog niet versturen — dat gebeurt bij betaalde aanbetaling.
 */
export async function ensureAdviseurOrderCommissieConcept(
  sb: SupabaseClient,
  opts: {
    leadId: string;
    offerteId: string;
    offerteNummer: string;
    projectNummer?: string | null;
  }
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  skipped?: string;
  error?: string;
}> {
  const { data: lead } = await sb
    .from("leads")
    .select("id, naam, adviseur_id")
    .eq("id", opts.leadId)
    .maybeSingle();

  if (!lead?.adviseur_id) {
    return { ok: true, skipped: "geen_adviseur" };
  }

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, actief"
    )
    .eq("id", lead.adviseur_id)
    .maybeSingle();

  if (!adv) return { ok: true, skipped: "adviseur_ontbreekt" };
  if (!adv.bedrijfsnaam || !adv.kvk_nummer || !adv.iban) {
    return { ok: true, skipped: "zzp_gegevens_incompleet" };
  }

  const tag = offerteRefTag(opts.offerteNummer);
  const { data: existing } = await sb
    .from("adviseur_creditfacturen")
    .select("id, status")
    .eq("adviseur_id", adv.id)
    .neq("status", "geannuleerd")
    .ilike("notities", `%${tag}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return {
      ok: true,
      created: false,
      creditfactuur_id: existing.id as string,
      skipped: "al_bestaat",
    };
  }

  let fee = NETTO_AANBETALING_COMMISSIE;
  const max =
    adv.max_factuur_bedrag != null && Number(adv.max_factuur_bedrag) > 0
      ? Number(adv.max_factuur_bedrag)
      : null;
  if (max != null && fee > max) fee = max;
  const amounts = bedragenMetBtw(fee);

  const weekInfo = creditWeekFromDate(new Date());
  const factuurNummer = formatCreditFactuurNummer(
    weekInfo.jaar,
    "aanbetaling",
    opts.offerteNummer
  );
  const betaaldag = nextWednesdayYmd(new Date());

  const { data: created, error: createErr } = await sb
    .from("adviseur_creditfacturen")
    .insert({
      adviseur_id: adv.id,
      factuur_nummer: factuurNummer,
      status: "concept",
      week_jaar: weekInfo.jaar,
      week_nummer: weekInfo.week,
      periode_van: weekInfo.van,
      periode_tot: weekInfo.tot,
      aantal_aanbetalingen: 0,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      btw_bedrag: amounts.btw_bedrag,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      factuurdatum: betaaldag,
      notities: [
        tag,
        `Commissie 1e deel (€${fee} excl. btw) · Offerte ${opts.offerteNummer}`,
        opts.projectNummer ? `Project ${opts.projectNummer}` : null,
        lead.naam ? `Klant ${lead.naam}` : null,
        `10% omzet excl. btw · 1e deel bij aanbetaling · + 21% btw op factuur`,
      ]
        .filter(Boolean)
        .join(" · "),
    })
    .select("id")
    .single();

  if (createErr || !created) {
    return {
      ok: false,
      error: createErr?.message || "Concept commissiefactuur mislukt",
    };
  }

  return {
    ok: true,
    created: true,
    creditfactuur_id: created.id as string,
  };
}

/**
 * Koppel betaalde aanbetalingsfactuur aan commissie-CF en verstuur naar adviseur.
 */
export async function ensureNettoAanbetalingCreditfactuur(
  sb: SupabaseClient,
  factuurId: string
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  mailed?: boolean;
  skipped?: string;
  error?: string;
}> {
  const { data: fac, error: facErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, lead_id, status, omschrijving, betaald_op, offerte_id"
    )
    .eq("id", factuurId)
    .maybeSingle();

  if (facErr || !fac) {
    return { ok: false, error: facErr?.message || "Factuur niet gevonden" };
  }
  if (fac.status !== "betaald") {
    return { ok: true, skipped: "niet_betaald" };
  }
  if (!isAanbetalingFactuur(fac.omschrijving)) {
    return { ok: true, skipped: "geen_aanbetaling" };
  }
  if (!fac.lead_id) {
    return { ok: true, skipped: "geen_lead" };
  }

  const { data: existingRegel } = await sb
    .from("adviseur_creditfactuur_regels")
    .select("id, creditfactuur_id")
    .eq("factuur_id", factuurId)
    .maybeSingle();

  if (existingRegel?.creditfactuur_id) {
    // Al gekoppeld — als nog concept, alsnog versturen
    const mailed = await tryVerstuur(sb, existingRegel.creditfactuur_id as string);
    return {
      ok: true,
      created: false,
      creditfactuur_id: existingRegel.creditfactuur_id as string,
      mailed,
      skipped: "al_gekoppeld",
    };
  }

  const { data: lead } = await sb
    .from("leads")
    .select("id, naam, adviseur_id")
    .eq("id", fac.lead_id)
    .maybeSingle();

  if (!lead?.adviseur_id) {
    return { ok: true, skipped: "geen_adviseur" };
  }

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, actief"
    )
    .eq("id", lead.adviseur_id)
    .maybeSingle();

  if (!adv) return { ok: true, skipped: "adviseur_ontbreekt" };
  if (!adv.bedrijfsnaam || !adv.kvk_nummer || !adv.iban) {
    return { ok: true, skipped: "zzp_gegevens_incompleet" };
  }

  const { data: off } = fac.offerte_id
    ? await sb
        .from("offertes")
        .select("offerte_nummer")
        .eq("id", fac.offerte_id)
        .maybeSingle()
    : { data: null };

  const { data: project } = await sb
    .from("projecten")
    .select("project_nummer")
    .eq("lead_id", fac.lead_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let fee = NETTO_AANBETALING_COMMISSIE;
  const max =
    adv.max_factuur_bedrag != null && Number(adv.max_factuur_bedrag) > 0
      ? Number(adv.max_factuur_bedrag)
      : null;
  if (max != null && fee > max) fee = max;
  const amounts = bedragenMetBtw(fee);

  const betaaldag = nextWednesdayYmd(
    fac.betaald_op ? new Date(fac.betaald_op) : new Date()
  );
  const weekInfo = creditWeekFromDate(
    fac.betaald_op ? new Date(fac.betaald_op) : new Date()
  );

  // Zoek bestaand concept voor deze order
  let creditId: string | null = null;
  if (off?.offerte_nummer) {
    const tag = offerteRefTag(off.offerte_nummer);
    const { data: orderCf } = await sb
      .from("adviseur_creditfacturen")
      .select("id, status")
      .eq("adviseur_id", adv.id)
      .eq("status", "concept")
      .ilike("notities", `%${tag}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderCf?.id) creditId = orderCf.id as string;
  }

  let created = false;
  if (!creditId) {
    if (!off?.offerte_nummer) {
      return { ok: false, error: "Offertenummer ontbreekt voor creditfactuur" };
    }
    const factuurNummer = formatCreditFactuurNummer(
      weekInfo.jaar,
      "aanbetaling",
      off.offerte_nummer
    );
    const tag = offerteRefTag(off.offerte_nummer);

    const { data: newCf, error: createErr } = await sb
      .from("adviseur_creditfacturen")
      .insert({
        adviseur_id: adv.id,
        factuur_nummer: factuurNummer,
        status: "concept",
        week_jaar: weekInfo.jaar,
        week_nummer: weekInfo.week,
        periode_van: weekInfo.van,
        periode_tot: weekInfo.tot,
        aantal_aanbetalingen: 1,
        bedrag_ex_btw: amounts.bedrag_ex_btw,
        btw_bedrag: amounts.btw_bedrag,
        bedrag_inc_btw: amounts.bedrag_inc_btw,
        factuurdatum: betaaldag,
        notities: [
          tag,
          `Commissie aanbetaling · uitbetaling woensdag ${betaaldag}`,
          off?.offerte_nummer ? `Offerte ${off.offerte_nummer}` : null,
          project?.project_nummer ? `Project ${project.project_nummer}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })
      .select("id")
      .single();

    if (createErr || !newCf) {
      return { ok: false, error: createErr?.message || "CF aanmaken mislukt" };
    }
    creditId = newCf.id as string;
    created = true;
  } else {
    await sb
      .from("adviseur_creditfacturen")
      .update({
        aantal_aanbetalingen: 1,
        bedrag_ex_btw: amounts.bedrag_ex_btw,
        btw_bedrag: amounts.btw_bedrag,
        bedrag_inc_btw: amounts.bedrag_inc_btw,
        factuurdatum: betaaldag,
        updated_at: new Date().toISOString(),
      })
      .eq("id", creditId);
  }

  const { error: regelErr } = await sb.from("adviseur_creditfactuur_regels").insert({
    creditfactuur_id: creditId,
    factuur_id: fac.id,
    lead_id: fac.lead_id,
    bedrag: fee,
    omschrijving: [
      "Commissie aanbetaling",
      lead.naam,
      off?.offerte_nummer ? `Offerte ${off.offerte_nummer}` : null,
      project?.project_nummer ? `Project ${project.project_nummer}` : null,
      fac.factuur_nummer ? `klantfactuur ${fac.factuur_nummer}` : null,
      fac.betaald_op ? `betaald ${String(fac.betaald_op).slice(0, 10)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });

  if (regelErr) {
    if (regelErr.code === "23505") {
      const mailed = await tryVerstuur(sb, creditId);
      return {
        ok: true,
        created: false,
        creditfactuur_id: creditId,
        mailed,
        skipped: "regel_bestaat",
      };
    }
    return { ok: false, error: regelErr.message };
  }

  const mailed = await tryVerstuur(sb, creditId);
  return {
    ok: true,
    created,
    creditfactuur_id: creditId,
    mailed,
  };
}

async function tryVerstuur(
  sb: SupabaseClient,
  creditId: string
): Promise<boolean> {
  try {
    const { data: fac } = await sb
      .from("adviseur_creditfacturen")
      .select("status")
      .eq("id", creditId)
      .maybeSingle();
    if (!fac || (fac.status !== "concept" && fac.status !== "verzonden")) {
      return false;
    }
    // Alleen concept → versturen (opnieuw versturen mag ook bij verzonden)
    if (fac.status === "concept") {
      const result = await verstuurAdviseurCreditfactuur(sb, creditId);
      return result.ok;
    }
    return false;
  } catch (e) {
    console.error("Auto-verstuur adviseur creditfactuur:", e);
    return false;
  }
}

/**
 * Rest-commissie (tranche B = 10% omzet ex − €250) bij installatie voltooid.
 * Maakt concept + verstuurt naar adviseur ter goedkeuring in het platform.
 */
export async function ensureAdviseurCommissieTrancheB(
  sb: SupabaseClient,
  projectId: string
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  mailed?: boolean;
  skipped?: string;
  error?: string;
  bedrag?: number;
}> {
  const { data: project, error: pErr } = await sb
    .from("projecten")
    .select(
      "id, project_nummer, status, lead_id, offerte_id, leads(id, naam, adviseur_id), offertes(id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (pErr || !project) {
    return { ok: false, error: pErr?.message || "Project niet gevonden" };
  }

  const lead = project.leads as
    | { id: string; naam?: string | null; adviseur_id?: string | null }
    | null
    | undefined;
  const off = project.offertes as
    | {
        id: string;
        offerte_nummer?: string | null;
        subtotaal_ex_btw?: number | null;
        totaal_inc_btw?: number | null;
      }
    | null
    | undefined;

  if (!lead?.adviseur_id) return { ok: true, skipped: "geen_adviseur" };
  if (!off?.offerte_nummer) return { ok: true, skipped: "geen_offerte" };

  let omzetEx = Number(off.subtotaal_ex_btw) || 0;
  if (!(omzetEx > 0) && Number(off.totaal_inc_btw) > 0) {
    omzetEx = Math.round((Number(off.totaal_inc_btw) / 1.21) * 100) / 100;
  }
  if (!(omzetEx > 0) && off.id) {
    const { data: regels } = await sb
      .from("offerte_regels")
      .select("totaal_ex_btw")
      .eq("offerte_id", off.id);
    omzetEx = Math.round(
      (regels || []).reduce(
        (s, r) => s + (Number(r.totaal_ex_btw) || 0),
        0
      ) * 100
    ) / 100;
  }

  let fee = commissieTrancheB(omzetEx);
  if (!(fee > 0)) return { ok: true, skipped: "geen_tranche_b", bedrag: 0 };

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, actief"
    )
    .eq("id", lead.adviseur_id)
    .maybeSingle();

  if (!adv) return { ok: true, skipped: "adviseur_ontbreekt" };
  if (!adv.bedrijfsnaam || !adv.kvk_nummer || !adv.iban) {
    return { ok: true, skipped: "zzp_gegevens_incompleet" };
  }

  const max =
    adv.max_factuur_bedrag != null && Number(adv.max_factuur_bedrag) > 0
      ? Number(adv.max_factuur_bedrag)
      : null;
  if (max != null && fee > max) fee = max;

  const tag = offerteTrancheBTag(off.offerte_nummer);
  const { data: existing } = await sb
    .from("adviseur_creditfacturen")
    .select("id, status")
    .eq("adviseur_id", adv.id)
    .neq("status", "geannuleerd")
    .ilike("notities", `%${tag}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    if (existing.status === "concept") {
      const mailed = await tryVerstuur(sb, existing.id as string);
      return {
        ok: true,
        created: false,
        creditfactuur_id: existing.id as string,
        mailed,
        bedrag: fee,
        skipped: "al_bestaat",
      };
    }
    return {
      ok: true,
      created: false,
      creditfactuur_id: existing.id as string,
      skipped: "al_bestaat",
      bedrag: fee,
    };
  }

  const amounts = bedragenMetBtw(fee);
  const weekInfo = creditWeekFromDate(new Date());
  const factuurNummer = formatCreditFactuurNummer(
    weekInfo.jaar,
    "restbetaling",
    off.offerte_nummer
  );
  const betaaldag = nextWednesdayYmd(new Date());

  const { data: created, error: createErr } = await sb
    .from("adviseur_creditfacturen")
    .insert({
      adviseur_id: adv.id,
      factuur_nummer: factuurNummer,
      status: "concept",
      week_jaar: weekInfo.jaar,
      week_nummer: weekInfo.week,
      periode_van: weekInfo.van,
      periode_tot: weekInfo.tot,
      aantal_aanbetalingen: 0,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      btw_bedrag: amounts.btw_bedrag,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      factuurdatum: betaaldag,
      notities: [
        tag,
        `Commissie restant (€${fee} excl. btw = 10% omzet − €250) · Offerte ${off.offerte_nummer}`,
        project.project_nummer
          ? `Project ${project.project_nummer}`
          : null,
        lead.naam ? `Klant ${lead.naam}` : null,
        `Na installatie voltooid · + 21% btw op factuur`,
      ]
        .filter(Boolean)
        .join(" · "),
    })
    .select("id")
    .single();

  if (createErr || !created) {
    return {
      ok: false,
      error: createErr?.message || "Tranche B creditfactuur mislukt",
    };
  }

  const mailed = await tryVerstuur(sb, created.id as string);
  return {
    ok: true,
    created: true,
    creditfactuur_id: created.id as string,
    mailed,
    bedrag: fee,
  };
}
