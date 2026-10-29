import type { SupabaseClient } from "@supabase/supabase-js";
import { creditWeekFromDate } from "@/lib/adviseur-creditfactuur";
import {
  encodePartnerFactuurRegels,
  formatPartnerCreditFactuurNummer,
  parsePartnerFactuurRegels,
  partnerInstallatieFactuurRegels,
  partnerWeekFactuurProjectKey,
  stripPartnerRegelsJson,
} from "@/lib/pdf-partner-creditfactuur";
import {
  PARTNER_FACTUUR_BETAALTERMIJN_DAGEN,
  bedragenMetBtw,
  type RelatieFactuurRegel,
} from "@/lib/pdf-relatie-factuur";
import { STANDAARD_INSTALLATIEKOSTEN } from "@/lib/project-kosten";

/**
 * Maak (of vul bij) een partner-weekfactuur-concept zodra de installatie
 * is voltooid (opleveringsformulier → status installatie_voltooid).
 * Per ISO-week 1 selfbilling: 1 regel per installatie
 * (“Installatie en schouw PRJ-…” · €675 of projectkosten).
 */
export async function ensurePartnerInstallatieCreditfactuur(
  sb: SupabaseClient,
  projectId: string
): Promise<{
  ok: boolean;
  created?: boolean;
  creditfactuur_id?: string;
  skipped?: string;
  error?: string;
}> {
  const { data: project, error: pErr } = await sb
    .from("projecten")
    .select(
      "id, status, project_nummer, installatie_partner_id, projectkosten, installatie_voltooid_at, installatie_at, offerte_id, offertes(offerte_nummer)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (pErr || !project) {
    return { ok: false, error: pErr?.message || "Project niet gevonden" };
  }
  // Ook na status-doorstroom (review/afgerond): zolang oplevering bekend is
  if (
    project.status !== "installatie_voltooid" &&
    !project.installatie_voltooid_at
  ) {
    return { ok: true, skipped: "niet_voltooid" };
  }
  if (!project.installatie_partner_id) {
    return { ok: true, skipped: "geen_partner" };
  }
  if (!project.project_nummer) {
    return { ok: true, skipped: "geen_project_nummer" };
  }

  const { data: partner } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats, actief"
    )
    .eq("id", project.installatie_partner_id)
    .maybeSingle();

  if (!partner || partner.actief === false) {
    return { ok: true, skipped: "partner_ontbreekt" };
  }

  const issuerNaam =
    partner.bedrijfsnaam?.trim() || partner.naam?.trim() || "Installatiepartner";

  const pk = Number(project.projectkosten);
  const bedragEx =
    Number.isFinite(pk) && pk > 0
      ? Math.round(pk * 100) / 100
      : STANDAARD_INSTALLATIEKOSTEN;
  const amounts = bedragenMetBtw(bedragEx);

  const off = project.offertes as
    | { offerte_nummer?: string }
    | { offerte_nummer?: string }[]
    | null;
  const offerte_nummer = Array.isArray(off)
    ? off[0]?.offerte_nummer || null
    : off?.offerte_nummer || null;

  const projectNr = project.project_nummer as string;
  const eventAt =
    project.installatie_voltooid_at ||
    project.installatie_at ||
    new Date().toISOString();
  const weekInfo = creditWeekFromDate(new Date(eventAt));
  const weekKey = partnerWeekFactuurProjectKey(weekInfo.jaar, weekInfo.week);
  const newRegels = partnerInstallatieFactuurRegels({
    projectNummer: projectNr,
    bedragEx: amounts.bedrag_ex_btw,
    offerteNummer: offerte_nummer,
  });

  // Bestaande weekfactuur (concept) → regels bijwerken als project nog ontbreekt
  const { data: weekExisting } = await sb
    .from("partner_creditfacturen")
    .select("id, status, omschrijving, notities, bedrag_ex_btw")
    .eq("partner_id", partner.id)
    .eq("week_jaar", weekInfo.jaar)
    .eq("week_nummer", weekInfo.week)
    .neq("status", "geannuleerd")
    .limit(1)
    .maybeSingle();

  if (weekExisting?.id) {
    const hay = `${weekExisting.omschrijving || ""}\n${weekExisting.notities || ""}`;
    if (hay.includes(projectNr)) {
      return {
        ok: true,
        created: false,
        creditfactuur_id: weekExisting.id as string,
        skipped: "in_weekfactuur",
      };
    }
    // Alleen concepten uitbreiden
    if (weekExisting.status === "concept") {
      const existingRegels =
        parsePartnerFactuurRegels(weekExisting.notities) || [];
      const merged: RelatieFactuurRegel[] = [...existingRegels, ...newRegels];
      const bedragExTotal =
        Math.round(merged.reduce((s, r) => s + r.bedrag, 0) * 100) / 100;
      const totals = bedragenMetBtw(bedragExTotal);
      const human =
        stripPartnerRegelsJson(weekExisting.notities) ||
        `Selfbilling weekfactuur ${issuerNaam} → Batterijconcept.`;
      const { error: updErr } = await sb
        .from("partner_creditfacturen")
        .update({
          bedrag_ex_btw: totals.bedrag_ex_btw,
          btw_bedrag: totals.btw_bedrag,
          bedrag_inc_btw: totals.bedrag_inc_btw,
          notities: encodePartnerFactuurRegels(
            merged,
            `${human} · + ${projectNr} na oplevering.`
          ),
        })
        .eq("id", weekExisting.id);
      if (updErr) {
        return { ok: false, error: updErr.message };
      }
      return {
        ok: true,
        created: false,
        creditfactuur_id: weekExisting.id as string,
        skipped: "toegevoegd_aan_weekfactuur",
      };
    }
    // Weekfactuur al verzonden → los concept mag (of skip)
    return {
      ok: true,
      created: false,
      creditfactuur_id: weekExisting.id as string,
      skipped: "weekfactuur_al_verwerkt",
    };
  }

  const jaar = weekInfo.jaar;
  const { count } = await sb
    .from("partner_creditfacturen")
    .select("id", { count: "exact", head: true })
    .gte("factuurdatum", `${jaar}-01-01`)
    .lte("factuurdatum", `${jaar}-12-31`);

  const factuurNummer = formatPartnerCreditFactuurNummer(
    jaar,
    (count || 0) + 1
  );

  const humanNotes = [
    `Selfbilling weekfactuur ${issuerNaam} → Batterijconcept.`,
    `Werkweek ${weekInfo.van} t/m ${weekInfo.tot}.`,
    `Factuurdatum ${weekInfo.betaalMaandag} (maandag na de week).`,
    `Betaaltermijn ${PARTNER_FACTUUR_BETAALTERMIJN_DAGEN} dagen.`,
    `Na oplevering · project ${projectNr}.`,
    partner.kvk_nummer
      ? `KvK ${partner.kvk_nummer}${partner.btw_nummer ? ` · BTW ${partner.btw_nummer}` : ""}${partner.iban ? ` · IBAN ${partner.iban}` : ""}.`
      : "KvK/IBAN nog niet ingevuld bij partner.",
  ].join(" ");

  const row: Record<string, unknown> = {
    partner_id: partner.id,
    factuur_nummer: factuurNummer,
    status: "concept",
    week_jaar: weekInfo.jaar,
    week_nummer: weekInfo.week,
    periode_van: weekInfo.van,
    periode_tot: weekInfo.tot,
    omschrijving: `${weekKey} · ${weekInfo.van} – ${weekInfo.tot}`,
    bedrag_ex_btw: amounts.bedrag_ex_btw,
    btw_bedrag: amounts.btw_bedrag,
    bedrag_inc_btw: amounts.bedrag_inc_btw,
    factuurdatum: weekInfo.betaalMaandag,
    notities: encodePartnerFactuurRegels(newRegels, humanNotes),
  };

  const { data: created, error: insErr } = await sb
    .from("partner_creditfacturen")
    .insert(row)
    .select("id")
    .single();

  if (insErr || !created) {
    if (
      insErr?.code === "42703" ||
      insErr?.message?.includes("partner_creditfacturen")
    ) {
      return {
        ok: false,
        error:
          "Voer supabase/migrate-partner-creditfacturen.sql uit in Supabase",
      };
    }
    if (insErr?.code === "23505") {
      const { data: again } = await sb
        .from("partner_creditfacturen")
        .select("id")
        .eq("partner_id", partner.id)
        .eq("week_jaar", weekInfo.jaar)
        .eq("week_nummer", weekInfo.week)
        .neq("status", "geannuleerd")
        .maybeSingle();
      if (again) {
        return {
          ok: true,
          created: false,
          creditfactuur_id: again.id as string,
          skipped: "race",
        };
      }
    }
    return { ok: false, error: insErr?.message || "CF aanmaken mislukt" };
  }

  return {
    ok: true,
    created: true,
    creditfactuur_id: created.id as string,
  };
}

type ProjectVoorWeekCf = {
  id: string;
  project_nummer: string;
  projectkosten: number | null;
  installatie_voltooid_at: string;
  installatie_partner_id: string;
  offerte_id?: string | null;
  offertes?:
    | { offerte_nummer?: string | null }
    | { offerte_nummer?: string | null }[]
    | null;
};

/**
 * Herbouw/maak weekfactuur-concepten per partner op basis van
 * installatie_voltooid_at. Één concept per ISO-week, 1 regel per installatie.
 * Bestaande verzonden facturen blijven onaangeroerd.
 */
export async function syncPartnerWeekCreditfacturen(opts: {
  sb: SupabaseClient;
  partnerId?: string | null;
}): Promise<{
  ok: boolean;
  weeks: Array<{
    partner: string;
    week: string;
    projecten: string[];
    factuur_nummer?: string;
    action: "created" | "updated" | "skipped";
    error?: string;
  }>;
  error?: string;
}> {
  const { sb, partnerId } = opts;
  let q = sb
    .from("projecten")
    .select(
      "id, project_nummer, projectkosten, installatie_voltooid_at, installatie_partner_id, offerte_id, offertes(offerte_nummer)"
    )
    .not("installatie_voltooid_at", "is", null)
    .not("installatie_partner_id", "is", null)
    .not("project_nummer", "is", null);

  if (partnerId) q = q.eq("installatie_partner_id", partnerId);

  const { data: rows, error } = await q;
  if (error) return { ok: false, weeks: [], error: error.message };

  const projects = (rows || []) as ProjectVoorWeekCf[];
  if (projects.length === 0) return { ok: true, weeks: [] };

  const partnerIds = [
    ...new Set(projects.map((p) => p.installatie_partner_id)),
  ];
  const { data: partners } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, bedrijfsnaam, kvk_nummer, btw_nummer, iban, actief"
    )
    .in("id", partnerIds);

  const partnerById = new Map((partners || []).map((p) => [p.id, p]));
  type WeekBucket = {
    partnerId: string;
    jaar: number;
    week: number;
    weekInfo: ReturnType<typeof creditWeekFromDate>;
    projects: ProjectVoorWeekCf[];
  };
  const buckets = new Map<string, WeekBucket>();

  for (const project of projects) {
    const weekInfo = creditWeekFromDate(
      new Date(project.installatie_voltooid_at)
    );
    const key = `${project.installatie_partner_id}:${weekInfo.jaar}-W${weekInfo.week}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.projects.push(project);
    else {
      buckets.set(key, {
        partnerId: project.installatie_partner_id,
        jaar: weekInfo.jaar,
        week: weekInfo.week,
        weekInfo,
        projects: [project],
      });
    }
  }

  const results: Array<{
    partner: string;
    week: string;
    projecten: string[];
    factuur_nummer?: string;
    action: "created" | "updated" | "skipped";
    error?: string;
  }> = [];

  // Stabiele volgorde: partner → week
  const ordered = [...buckets.values()].sort(
    (a, b) =>
      a.partnerId.localeCompare(b.partnerId) ||
      a.jaar - b.jaar ||
      a.week - b.week
  );

  for (const bucket of ordered) {
    const partner = partnerById.get(bucket.partnerId);
    const issuerNaam =
      partner?.bedrijfsnaam?.trim() ||
      partner?.naam?.trim() ||
      "Installatiepartner";
    const weekLabel = `W${bucket.week}-${bucket.jaar}`;
    const projectNrs = bucket.projects
      .map((p) => p.project_nummer)
      .sort((a, b) => a.localeCompare(b, "nl"));

    if (!partner || partner.actief === false) {
      results.push({
        partner: issuerNaam,
        week: weekLabel,
        projecten: projectNrs,
        action: "skipped",
        error: "partner_ontbreekt",
      });
      continue;
    }

    const regels: RelatieFactuurRegel[] = [];
    for (const project of bucket.projects) {
      const pk = Number(project.projectkosten);
      const bedragEx =
        Number.isFinite(pk) && pk > 0
          ? Math.round(pk * 100) / 100
          : STANDAARD_INSTALLATIEKOSTEN;
      const off = project.offertes;
      const offerte_nummer = Array.isArray(off)
        ? off[0]?.offerte_nummer || null
        : off?.offerte_nummer || null;
      regels.push(
        ...partnerInstallatieFactuurRegels({
          projectNummer: project.project_nummer,
          bedragEx,
          offerteNummer: offerte_nummer,
        })
      );
    }

    const bedragExTotal =
      Math.round(regels.reduce((s, r) => s + r.bedrag, 0) * 100) / 100;
    const totals = bedragenMetBtw(bedragExTotal);
    const weekKey = partnerWeekFactuurProjectKey(bucket.jaar, bucket.week);
    const humanNotes = [
      `Selfbilling weekfactuur ${issuerNaam} → Batterijconcept.`,
      `Werkweek ${bucket.weekInfo.van} t/m ${bucket.weekInfo.tot}.`,
      `Factuurdatum ${bucket.weekInfo.betaalMaandag} (maandag na de week).`,
      `Betaaltermijn ${PARTNER_FACTUUR_BETAALTERMIJN_DAGEN} dagen.`,
      `Projecten: ${projectNrs.join(", ")}.`,
    ].join(" ");

    const { data: existing } = await sb
      .from("partner_creditfacturen")
      .select("id, status, factuur_nummer")
      .eq("partner_id", partner.id)
      .eq("week_jaar", bucket.jaar)
      .eq("week_nummer", bucket.week)
      .neq("status", "geannuleerd")
      .limit(1)
      .maybeSingle();

    if (existing?.id && existing.status !== "concept") {
      results.push({
        partner: issuerNaam,
        week: weekLabel,
        projecten: projectNrs,
        factuur_nummer: existing.factuur_nummer,
        action: "skipped",
        error: `status_${existing.status}`,
      });
      continue;
    }

    const patch = {
      bedrag_ex_btw: totals.bedrag_ex_btw,
      btw_bedrag: totals.btw_bedrag,
      bedrag_inc_btw: totals.bedrag_inc_btw,
      periode_van: bucket.weekInfo.van,
      periode_tot: bucket.weekInfo.tot,
      factuurdatum: bucket.weekInfo.betaalMaandag,
      omschrijving: `${weekKey} · ${bucket.weekInfo.van} – ${bucket.weekInfo.tot}`,
      notities: encodePartnerFactuurRegels(regels, humanNotes),
    };

    if (existing?.id) {
      const { error: updErr } = await sb
        .from("partner_creditfacturen")
        .update(patch)
        .eq("id", existing.id);
      results.push({
        partner: issuerNaam,
        week: weekLabel,
        projecten: projectNrs,
        factuur_nummer: existing.factuur_nummer,
        action: updErr ? "skipped" : "updated",
        error: updErr?.message,
      });
      continue;
    }

    const { count } = await sb
      .from("partner_creditfacturen")
      .select("id", { count: "exact", head: true })
      .gte("factuurdatum", `${bucket.jaar}-01-01`)
      .lte("factuurdatum", `${bucket.jaar}-12-31`);

    const factuurNummer = formatPartnerCreditFactuurNummer(
      bucket.jaar,
      (count || 0) + 1
    );

    const { data: created, error: insErr } = await sb
      .from("partner_creditfacturen")
      .insert({
        partner_id: partner.id,
        factuur_nummer: factuurNummer,
        status: "concept",
        week_jaar: bucket.jaar,
        week_nummer: bucket.week,
        ...patch,
      })
      .select("id, factuur_nummer")
      .single();

    results.push({
      partner: issuerNaam,
      week: weekLabel,
      projecten: projectNrs,
      factuur_nummer: created?.factuur_nummer || factuurNummer,
      action: insErr ? "skipped" : "created",
      error: insErr?.message,
    });
  }

  return { ok: true, weeks: results };
}
