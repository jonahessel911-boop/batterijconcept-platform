import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NETTO_AANBETALING_COMMISSIE,
  commissiePctToFraction,
  commissieTrancheA,
  commissieTrancheB,
  isAanbetalingFactuur,
} from "@/lib/netto-boord";
import {
  creditWeekByYearWeek,
  creditWeekFromDate,
  previousCreditWeek,
  weekBeforePreviousCreditWeek,
  formatCreditFactuurNummer,
  formatCreditFactuurNummerSalesWeek,
  isCreditWeekAfgesloten,
  isSalesWeekFactuurNummer,
  type CreditWeek,
} from "@/lib/adviseur-creditfactuur";
import { bedragenMetBtw } from "@/lib/pdf-relatie-factuur";
import { verstuurAdviseurCreditfactuur } from "@/lib/creditfactuur-verstuur";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import { isUitgeslotenVanSalesCommissie } from "@/lib/rollen";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

function offerteRefTag(offerteNummer: string) {
  return `ref_offerte:${offerteNummer}`;
}

function offerteTrancheBTag(offerteNummer: string) {
  return `ref_offerte_tranche_b:${offerteNummer}`;
}

async function omzetExFromOfferte(
  sb: SupabaseClient,
  offerteId: string | null | undefined,
  fallback?: {
    subtotaal_ex_btw?: number | null;
    totaal_inc_btw?: number | null;
  }
): Promise<number> {
  let omzetEx = Number(fallback?.subtotaal_ex_btw) || 0;
  if (!(omzetEx > 0) && Number(fallback?.totaal_inc_btw) > 0) {
    omzetEx =
      Math.round((Number(fallback!.totaal_inc_btw) / 1.21) * 100) / 100;
  }
  if (!(omzetEx > 0) && offerteId) {
    const { data: off } = await sb
      .from("offertes")
      .select("id, subtotaal_ex_btw, totaal_inc_btw")
      .eq("id", offerteId)
      .maybeSingle();
    omzetEx = Number(off?.subtotaal_ex_btw) || 0;
    if (!(omzetEx > 0) && Number(off?.totaal_inc_btw) > 0) {
      omzetEx =
        Math.round((Number(off!.totaal_inc_btw) / 1.21) * 100) / 100;
    }
    if (!(omzetEx > 0) && off?.id) {
      const { data: regels } = await sb
        .from("offerte_regels")
        .select("totaal_ex_btw")
        .eq("offerte_id", off.id);
      omzetEx =
        Math.round(
          (regels || []).reduce(
            (s, r) => s + (Number(r.totaal_ex_btw) || 0),
            0
          ) * 100
        ) / 100;
    }
  }
  return omzetEx;
}

function applyMaxFee(
  fee: number,
  maxBedrag: number | null | undefined
): number {
  const max =
    maxBedrag != null && Number(maxBedrag) > 0 ? Number(maxBedrag) : null;
  if (max != null && fee > max) return max;
  return fee;
}

/** Hernummer bedragen op basis van alle regels. */
export async function recalcAdviseurCreditfactuurFromRegels(
  sb: SupabaseClient,
  creditfactuurId: string
): Promise<void> {
  const { data: regels } = await sb
    .from("adviseur_creditfactuur_regels")
    .select("bedrag")
    .eq("creditfactuur_id", creditfactuurId);
  const som =
    Math.round(
      (regels || []).reduce((s, r) => s + (Number(r.bedrag) || 0), 0) * 100
    ) / 100;
  const amounts = bedragenMetBtw(som);
  await sb
    .from("adviseur_creditfacturen")
    .update({
      aantal_aanbetalingen: (regels || []).length,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      btw_bedrag: amounts.btw_bedrag,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      updated_at: new Date().toISOString(),
    })
    .eq("id", creditfactuurId);
}

/**
 * Vind of maak de weekfactuur (één per adviseur per ISO-week) voor sales-commissie.
 */
export async function findOrCreateWeekSalesCreditfactuur(
  sb: SupabaseClient,
  opts: {
    adviseurId: string;
    week: CreditWeek;
    notities?: string | null;
  }
): Promise<{ id: string; status: string; created: boolean; error?: string }> {
  const factuurNummer = formatCreditFactuurNummerSalesWeek(
    opts.week.jaar,
    opts.week.week,
    opts.adviseurId
  );

  const { data: byNr } = await sb
    .from("adviseur_creditfacturen")
    .select("id, status")
    .eq("factuur_nummer", factuurNummer)
    .neq("status", "geannuleerd")
    .maybeSingle();

  if (byNr?.id) {
    return {
      id: byNr.id as string,
      status: byNr.status as string,
      created: false,
    };
  }

  // Bestaande open weekfactuur (zelfde adviseur+week, week-nummering)
  const { data: openWeek } = await sb
    .from("adviseur_creditfacturen")
    .select("id, status, factuur_nummer")
    .eq("adviseur_id", opts.adviseurId)
    .eq("week_jaar", opts.week.jaar)
    .eq("week_nummer", opts.week.week)
    .neq("status", "geannuleerd")
    .in("status", ["concept", "verzonden", "goedgekeurd"])
    .order("created_at", { ascending: true })
    .limit(20);

  const weekHit = (openWeek || []).find((f) =>
    isSalesWeekFactuurNummer(f.factuur_nummer as string)
  );
  if (weekHit?.id) {
    return {
      id: weekHit.id as string,
      status: weekHit.status as string,
      created: false,
    };
  }

  const betaaldag = opts.week.betaalWoensdag;
  const { data: created, error } = await sb
    .from("adviseur_creditfacturen")
    .insert({
      adviseur_id: opts.adviseurId,
      factuur_nummer: factuurNummer,
      status: "concept",
      week_jaar: opts.week.jaar,
      week_nummer: opts.week.week,
      periode_van: opts.week.van,
      periode_tot: opts.week.tot,
      aantal_aanbetalingen: 0,
      bedrag_ex_btw: 0,
      btw_bedrag: 0,
      bedrag_inc_btw: 0,
      factuurdatum: betaaldag,
      notities: [
        opts.notities,
        `Sales-commissie week ${opts.week.week} (${opts.week.van} t/m ${opts.week.tot})`,
        `Verwerking woensdag ${betaaldag}`,
      ]
        .filter(Boolean)
        .join(" · "),
    })
    .select("id, status")
    .single();

  if (error || !created) {
    if (error?.code === "23505") {
      const { data: again } = await sb
        .from("adviseur_creditfacturen")
        .select("id, status")
        .eq("factuur_nummer", factuurNummer)
        .maybeSingle();
      if (again?.id) {
        return {
          id: again.id as string,
          status: again.status as string,
          created: false,
        };
      }
    }
    return {
      id: "",
      status: "",
      created: false,
      error: error?.message || "Weekfactuur aanmaken mislukt",
    };
  }

  return {
    id: created.id as string,
    status: (created.status as string) || "concept",
    created: true,
  };
}

/**
 * Zet losse AANBETALING/OFF-concepten om naar één weekfactuur per adviseur.
 * Regels verhuizen; oude CF’s worden geannuleerd.
 */
export async function consolidateAdviseurWeekSalesCreditfacturen(
  sb: SupabaseClient,
  opts: { adviseurId: string; jaar: number; week: number }
): Promise<{ weekCfId: string | null; merged: number }> {
  const { data: open } = await sb
    .from("adviseur_creditfacturen")
    .select("id, status, factuur_nummer, notities, bedrag_ex_btw")
    .eq("adviseur_id", opts.adviseurId)
    .eq("week_jaar", opts.jaar)
    .eq("week_nummer", opts.week)
    .neq("status", "geannuleerd")
    .neq("status", "betaald")
    .not("factuur_nummer", "ilike", "%/RESTBETALING/%")
    .not("notities", "ilike", "%[WF]%")
    .order("created_at", { ascending: true });

  const sales = (open || []).filter((f) => {
    const nr = String(f.factuur_nummer || "");
    if (isSalesWeekFactuurNummer(nr)) return true;
    if (/\/AANBETALING\//i.test(nr)) return true;
    if (/^CF-\d{4}-W\d{2}-/i.test(nr)) return true;
    return false;
  });

  if (sales.length === 0) return { weekCfId: null, merged: 0 };

  const week = creditWeekByYearWeek(opts.jaar, opts.week);

  const target = await findOrCreateWeekSalesCreditfactuur(sb, {
    adviseurId: opts.adviseurId,
    week,
  });
  if (!target.id) return { weekCfId: null, merged: 0 };

  let merged = 0;
  for (const cf of sales) {
    if (cf.id === target.id) continue;
    const { data: regels } = await sb
      .from("adviseur_creditfactuur_regels")
      .select("id, factuur_id")
      .eq("creditfactuur_id", cf.id);

    if (regels && regels.length > 0) {
      for (const r of regels) {
        const { error } = await sb
          .from("adviseur_creditfactuur_regels")
          .update({ creditfactuur_id: target.id })
          .eq("id", r.id);
        if (!error) merged += 1;
      }
    }

    await sb
      .from("adviseur_creditfacturen")
      .update({ status: "geannuleerd", updated_at: new Date().toISOString() })
      .eq("id", cf.id);
  }

  await recalcAdviseurCreditfactuurFromRegels(sb, target.id);
  return { weekCfId: target.id, merged };
}

/** Consolideer open sales-weken (vorige + week ervoor) voor alle adviseurs. */
export async function consolidateOpenSalesWeekCreditfacturen(
  sb: SupabaseClient,
  now: Date = new Date()
): Promise<number> {
  const prev = previousCreditWeek(now);
  const older = weekBeforePreviousCreditWeek(now);
  const weeks = [
    { jaar: older.jaar, week: older.week },
    { jaar: prev.jaar, week: prev.week },
  ];

  const { data: open } = await sb
    .from("adviseur_creditfacturen")
    .select("adviseur_id, week_jaar, week_nummer")
    .neq("status", "geannuleerd")
    .neq("status", "betaald")
    .in(
      "week_jaar",
      [...new Set(weeks.map((w) => w.jaar))]
    )
    .limit(2000);

  const keys = new Set<string>();
  for (const row of open || []) {
    const jaar = row.week_jaar as number;
    const week = row.week_nummer as number;
    if (!weeks.some((w) => w.jaar === jaar && w.week === week)) continue;
    keys.add(`${row.adviseur_id}|${jaar}|${week}`);
  }

  let total = 0;
  for (const key of keys) {
    const [adviseurId, jaarS, weekS] = key.split("|");
    const r = await consolidateAdviseurWeekSalesCreditfacturen(sb, {
      adviseurId,
      jaar: Number(jaarS),
      week: Number(weekS),
    });
    total += r.merged;
  }
  return total;
}

/**
 * @deprecated Premature concepten bij order-sign veroorzaakten woensdag-mails
 * vóór betaalde aanbetaling. Tranche A wordt aangemaakt via
 * `ensureNettoAanbetalingCreditfactuur` (of handmatig vanuit NettoBoord).
 * Deze functie blijft als no-op voor bestaande callers.
 */
export async function ensureAdviseurOrderCommissieConcept(
  _sb: SupabaseClient,
  _opts: {
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
  return { ok: true, skipped: "deferred_tot_aanbetaling" };
}

/**
 * Tranche A: koppel betaalde klant-aanbetaling aan commissie-CF (concept).
 * Versturen gebeurt woensdag via `runWoensdagCommissieBatch` (niet direct).
 */
export async function ensureNettoAanbetalingCreditfactuur(
  sb: SupabaseClient,
  factuurId: string,
  opts?: { autoVerstuur?: boolean }
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  mailed?: boolean;
  skipped?: string;
  error?: string;
}> {
  const autoVerstuur = opts?.autoVerstuur === true;
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
    const mailed = autoVerstuur
      ? await tryVerstuur(sb, existingRegel.creditfactuur_id as string)
      : false;
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
      "id, naam, rol, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, actief, commissie_pct"
    )
    .eq("id", lead.adviseur_id)
    .maybeSingle();

  if (!adv) return { ok: true, skipped: "adviseur_ontbreekt" };
  if (isUitgeslotenVanSalesCommissie(adv as { naam?: string; rol?: string })) {
    return { ok: true, skipped: "geen_verkoper" };
  }
  // Concept mag zonder ZZP; versturen (Bevestig) vereist wel KvK/IBAN.

  const { data: off } = fac.offerte_id
    ? await sb
        .from("offertes")
        .select("id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw")
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

  const omzetEx = await omzetExFromOfferte(sb, fac.offerte_id, off || undefined);
  const pct = (adv as { commissie_pct?: number | null }).commissie_pct;
  let fee =
    omzetEx > 0
      ? commissieTrancheA(omzetEx, pct)
      : NETTO_AANBETALING_COMMISSIE;
  fee = applyMaxFee(fee, adv.max_factuur_bedrag);
  if (!(fee > 0)) return { ok: true, skipped: "geen_tranche_a" };

  const weekInfo = creditWeekFromDate(
    fac.betaald_op ? new Date(fac.betaald_op) : new Date()
  );
  // Concept pas als de betaalweek afgesloten is (vorige week of ouder)
  if (!isCreditWeekAfgesloten(weekInfo)) {
    return { ok: true, skipped: "week_nog_open" };
  }

  // Één weekfactuur per adviseur — alle sales-regels van die week erop
  const weekCf = await findOrCreateWeekSalesCreditfactuur(sb, {
    adviseurId: adv.id,
    week: weekInfo,
  });
  if (!weekCf.id) {
    return { ok: false, error: weekCf.error || "Weekfactuur aanmaken mislukt" };
  }

  const creditId = weekCf.id;
  const created = weekCf.created;

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
      const mailed = autoVerstuur ? await tryVerstuur(sb, creditId) : false;
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

  if (weekCf.status === "concept") {
    await recalcAdviseurCreditfactuurFromRegels(sb, creditId);
  }

  const mailed = autoVerstuur ? await tryVerstuur(sb, creditId) : false;
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

/** Mag deze concept-CF woensdag worden gemaild? */
export function magWoensdagVersturen(cf: {
  factuur_nummer?: string | null;
  aantal_aanbetalingen?: number | null;
  has_regels?: boolean;
}): boolean {
  const nr = String(cf.factuur_nummer || "");
  if (/\/RESTBETALING\//i.test(nr)) return true;
  if (/\/AANBETALING\//i.test(nr) || isSalesWeekFactuurNummer(nr)) {
    return (
      Number(cf.aantal_aanbetalingen) > 0 || Boolean(cf.has_regels)
    );
  }
  // Weekfactuur / handmatig: alleen met regels of expliciet aantal
  return Number(cf.aantal_aanbetalingen) > 0 || Boolean(cf.has_regels);
}

/**
 * Rest-commissie (tranche B = adviseur-% omzet ex − tranche A) bij installatie voltooid.
 * Maakt concept; versturen gebeurt woensdag via `runWoensdagCommissieBatch`.
 */
export async function ensureAdviseurCommissieTrancheB(
  sb: SupabaseClient,
  projectId: string,
  opts?: { autoVerstuur?: boolean }
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  mailed?: boolean;
  skipped?: string;
  error?: string;
  bedrag?: number;
}> {
  const autoVerstuur = opts?.autoVerstuur === true;
  const { data: project, error: pErr } = await sb
    .from("projecten")
    .select(
      "id, project_nummer, status, lead_id, offerte_id, installatie_voltooid_at, leads(id, naam, adviseur_id), offertes(id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (pErr || !project) {
    return { ok: false, error: pErr?.message || "Project niet gevonden" };
  }

  const leadRaw = project.leads as
    | { id: string; naam?: string | null; adviseur_id?: string | null }
    | { id: string; naam?: string | null; adviseur_id?: string | null }[]
    | null
    | undefined;
  const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
  const offRaw = project.offertes as
    | {
        id: string;
        offerte_nummer?: string | null;
        subtotaal_ex_btw?: number | null;
        totaal_inc_btw?: number | null;
      }
    | {
        id: string;
        offerte_nummer?: string | null;
        subtotaal_ex_btw?: number | null;
        totaal_inc_btw?: number | null;
      }[]
    | null
    | undefined;
  const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;

  if (!lead?.adviseur_id) return { ok: true, skipped: "geen_adviseur" };
  if (!off?.offerte_nummer) return { ok: true, skipped: "geen_offerte" };

  const { data: adv } = await sb
    .from("adviseurs")
    .select(
      "id, naam, rol, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, actief, commissie_pct"
    )
    .eq("id", lead.adviseur_id)
    .maybeSingle();

  if (!adv) return { ok: true, skipped: "adviseur_ontbreekt" };
  if (isUitgeslotenVanSalesCommissie(adv as { naam?: string; rol?: string })) {
    return { ok: true, skipped: "geen_verkoper" };
  }
  // Concept mag zonder ZZP; versturen (Bevestig) vereist wel KvK/IBAN.

  const pct = (adv as { commissie_pct?: number | null }).commissie_pct;
  const omzetEx = await omzetExFromOfferte(sb, off.id || project.offerte_id, off);
  let fee = commissieTrancheB(omzetEx, pct);
  if (!(fee > 0)) return { ok: true, skipped: "geen_tranche_b", bedrag: 0 };

  fee = applyMaxFee(fee, adv.max_factuur_bedrag);

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
    if (existing.status === "concept" && autoVerstuur) {
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
  const eventAt =
    (project as { installatie_voltooid_at?: string | null })
      .installatie_voltooid_at || new Date().toISOString();
  const weekInfo = creditWeekFromDate(new Date(eventAt));
  if (!isCreditWeekAfgesloten(weekInfo)) {
    return { ok: true, skipped: "week_nog_open", bedrag: fee };
  }
  const factuurNummer = formatCreditFactuurNummer(
    weekInfo.jaar,
    "restbetaling",
    off.offerte_nummer
  );
  const betaaldag = weekInfo.betaalWoensdag;
  const trancheA = commissieTrancheA(omzetEx, pct);
  const pctLabel = Math.round(commissiePctToFraction(pct) * 100);

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
      aantal_aanbetalingen: 1,
      bedrag_ex_btw: amounts.bedrag_ex_btw,
      btw_bedrag: amounts.btw_bedrag,
      bedrag_inc_btw: amounts.bedrag_inc_btw,
      factuurdatum: betaaldag,
      notities: [
        tag,
        `Commissie restant (€${fee} excl. btw = ${pctLabel}% − €${trancheA}) · Offerte ${off.offerte_nummer}`,
        project.project_nummer
          ? `Project ${project.project_nummer}`
          : null,
        lead.naam ? `Klant ${lead.naam}` : null,
        `Netto sale · verwerking woensdag ${betaaldag} · + 21% btw`,
      ]
        .filter(Boolean)
        .join(" · "),
    })
    .select("id")
    .single();

  if (createErr || !created) {
    if (createErr?.code === "23505") {
      const { data: again } = await sb
        .from("adviseur_creditfacturen")
        .select("id")
        .eq("factuur_nummer", factuurNummer)
        .maybeSingle();
      if (again?.id) {
        return {
          ok: true,
          created: false,
          creditfactuur_id: again.id as string,
          skipped: "al_bestaat",
          bedrag: fee,
        };
      }
    }
    return {
      ok: false,
      error: createErr?.message || "Tranche B creditfactuur mislukt",
    };
  }

  const mailed = autoVerstuur
    ? await tryVerstuur(sb, created.id as string)
    : false;
  return {
    ok: true,
    created: true,
    creditfactuur_id: created.id as string,
    mailed,
    bedrag: fee,
  };
}

export type WoensdagCommissieBatchResult = {
  ok: boolean;
  week: { jaar: number; week: number; van: string; tot: string };
  betaalWoensdag: string;
  aanbetalingen: { checked: number; created: number; errors: string[] };
  netto: { checked: number; created: number; errors: string[] };
  verstuurd: { count: number; ids: string[]; errors: string[]; skipped: number };
  skipped?: string;
};

/**
 * Elke woensdag: verwerk commissie van de vorige ISO-week.
 * - Aanbetalingen betaald in die week → tranche A concepten
 * - Netto sales (installatie uitgevoerd) in die week → tranche B concepten
 * - Alleen rijpe concepten van die week versturen (A met betaalde regel, of B)
 */
export async function runWoensdagCommissieBatch(
  sb: SupabaseClient,
  now: Date = new Date()
): Promise<WoensdagCommissieBatchResult> {
  const week = previousCreditWeek(now);
  const betaalWoensdag = week.betaalWoensdag;
  const result: WoensdagCommissieBatchResult = {
    ok: true,
    week: {
      jaar: week.jaar,
      week: week.week,
      van: week.van,
      tot: week.tot,
    },
    betaalWoensdag,
    aanbetalingen: { checked: 0, created: 0, errors: [] },
    netto: { checked: 0, created: 0, errors: [] },
    verstuurd: { count: 0, ids: [], errors: [], skipped: 0 },
  };

  // 1) Aanbetalingen betaald in vorige week
  const { data: aanbetalingen, error: aanbErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, lead_id, status, omschrijving, betaald_op, offerte_id"
    )
    .eq("status", "betaald")
    .gte("betaald_op", week.van)
    .lte("betaald_op", week.tot)
    .limit(2000);

  if (aanbErr) {
    result.ok = false;
    result.aanbetalingen.errors.push(aanbErr.message);
  } else {
    for (const fac of aanbetalingen || []) {
      if (!isAanbetalingFactuurOmschrijving(fac.omschrijving)) continue;
      result.aanbetalingen.checked += 1;
      const r = await ensureNettoAanbetalingCreditfactuur(sb, fac.id as string, {
        autoVerstuur: false,
      });
      if (!r.ok) {
        result.aanbetalingen.errors.push(
          `${fac.factuur_nummer || fac.id}: ${r.error || "fout"}`
        );
      } else if (r.created) {
        result.aanbetalingen.created += 1;
      }
    }
  }

  // 2) Netto sales = installatie uitgevoerd in vorige week
  const weekStartIso = fromZonedTime(
    `${week.van}T00:00:00`,
    AMSTERDAM_TZ
  ).toISOString();
  const weekEndIso = fromZonedTime(
    `${week.tot}T23:59:59.999`,
    AMSTERDAM_TZ
  ).toISOString();

  let { data: nettoProjects, error: nettoErr } = await sb
    .from("projecten")
    .select("id, project_nummer, status, installatie_voltooid_at")
    .not("installatie_voltooid_at", "is", null)
    .gte("installatie_voltooid_at", weekStartIso)
    .lte("installatie_voltooid_at", weekEndIso)
    .limit(2000);

  if (
    nettoErr &&
    (nettoErr.message?.includes("installatie_voltooid_at") ||
      nettoErr.code === "42703")
  ) {
    const retry = await sb
      .from("projecten")
      .select("id, project_nummer, status, updated_at")
      .in("status", ["installatie_voltooid", "review_gevraagd", "afgerond", "service"])
      .gte("updated_at", weekStartIso)
      .lte("updated_at", weekEndIso)
      .limit(2000);
    nettoProjects = retry.data as typeof nettoProjects;
    nettoErr = retry.error;
  }

  if (nettoErr) {
    result.ok = false;
    result.netto.errors.push(nettoErr.message);
  } else {
    for (const p of nettoProjects || []) {
      result.netto.checked += 1;
      const r = await ensureAdviseurCommissieTrancheB(sb, p.id as string, {
        autoVerstuur: false,
      });
      if (!r.ok) {
        result.netto.errors.push(
          `${p.project_nummer || p.id}: ${r.error || "fout"}`
        );
      } else if (r.created) {
        result.netto.created += 1;
      } else if (r.skipped === "zzp_gegevens_incompleet") {
        result.netto.errors.push(
          `${p.project_nummer || p.id}: ZZP-gegevens incompleet (bedrijfsnaam/KvK/IBAN)`
        );
      }
    }
  }

  // 3) Rijpe concepten van die week → versturen
  const { data: concepts, error: cfErr } = await sb
    .from("adviseur_creditfacturen")
    .select("id, factuur_nummer, status, aantal_aanbetalingen")
    .eq("status", "concept")
    .eq("week_jaar", week.jaar)
    .eq("week_nummer", week.week)
    .limit(2000);

  if (cfErr) {
    result.ok = false;
    result.verstuurd.errors.push(cfErr.message);
    return result;
  }

  for (const cf of concepts || []) {
    const { count: regelCount } = await sb
      .from("adviseur_creditfactuur_regels")
      .select("id", { count: "exact", head: true })
      .eq("creditfactuur_id", cf.id);

    const ready = magWoensdagVersturen({
      factuur_nummer: cf.factuur_nummer as string,
      aantal_aanbetalingen: cf.aantal_aanbetalingen as number,
      has_regels: (regelCount || 0) > 0,
    });

    if (!ready) {
      result.verstuurd.skipped += 1;
      continue;
    }

    await sb
      .from("adviseur_creditfacturen")
      .update({
        factuurdatum: betaalWoensdag,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cf.id);

    const mailed = await tryVerstuur(sb, cf.id as string);
    if (mailed) {
      result.verstuurd.count += 1;
      result.verstuurd.ids.push(cf.id as string);
    } else {
      result.verstuurd.errors.push(
        `${cf.factuur_nummer || cf.id}: versturen mislukt`
      );
    }
  }

  if (
    result.aanbetalingen.errors.length ||
    result.netto.errors.length ||
    result.verstuurd.errors.length
  ) {
    result.ok = result.verstuurd.count > 0 || result.aanbetalingen.created > 0;
  }

  return result;
}
