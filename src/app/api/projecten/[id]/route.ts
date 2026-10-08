import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { Betaalwijze, ProjectStatus } from "@/types/database";
import { PROJECT_STATUSES, projectStatusLabel } from "@/lib/labels";
import {
  FINANCIERING_STATUS_LABEL,
  isFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  isValidSchouwWeek,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { logLeadEvent } from "@/lib/lead-events";
import { resolveBetaalwijze } from "@/lib/project-status-config";
import { projectHeeftOpleveringsrapport } from "@/lib/project-na-oplevering";
import { ensurePartnerInstallatieCreditfactuur } from "@/lib/partner-installatie-creditfactuur";
import { ensureAdviseurCommissieTrancheB } from "@/lib/netto-creditfactuur";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  isMateriaalLeverdatumColumnError,
  withLeverdatumInChecks,
} from "@/lib/materiaal-leverdatum";

export const runtime = "nodejs";

const PROJECT_SELECT =
  "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)";

/** GET /api/projecten/[id] — projectdetail (ook via lead_id als fallback). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Ontbrekend id" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const byId = await sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (byId.error) {
      return NextResponse.json(
        { error: "Laden mislukt", detail: byId.error.message },
        { status: 500 }
      );
    }
    if (byId.data) {
      return NextResponse.json({ project: byId.data });
    }

    // Soms wordt per ongeluk een lead-id gebruikt — stuur door naar het project.
    const byLead = await sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byLead.error) {
      return NextResponse.json(
        { error: "Laden mislukt", detail: byLead.error.message },
        { status: 500 }
      );
    }
    if (byLead.data) {
      return NextResponse.json({
        project: byLead.data,
        redirectTo: (byLead.data as { id: string }).id,
      });
    }

    return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/projecten/[id] — status / projectkosten / bel-actie / schouwweek */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    status?: ProjectStatus;
    projectkosten?: number;
    bel_schouw_aanbetaling_at?: string | null;
    financiering_geschakeld_at?: string | null;
    warmtefonds_aangevraagd_at?: string | null;
    /** Aparte Warmtefonds-fase; null = reset. */
    financiering_status?: FinancieringStatus | null;
    /** Interne datum/tijd WF-afspraak (geen mail). */
    warmtefonds_afspraak_at?: string | null;
    schouw_jaar?: number | null;
    schouw_week?: number | null;
    leveradres?: string | null;
    materiaal_checks?: Record<string, boolean | string> | null;
    /** Verwachte leverdatum inkoop (Planbord). */
    materiaal_leverdatum?: string | null;
    /** Client signaleert: alle inkoop-vinkjes net afgevinkt. */
    materiaal_volledig_afgevinkt?: boolean;
    notities?: string | null;
    titel?: string | null;
    backoffice_notitie?: string | null;
    installateur_notitie?: string | null;
    afdeling?: string | null;
    verantwoordelijke_id?: string | null;
    installatie_partner_id?: string | null;
    betaalwijze?: Betaalwijze;
    betaalwijze_reden?: string | null;
    schouw_notities?: string | null;
    installatie_notities?: string | null;
    service_notities?: string | null;
    btw_terugvragen_aangevraagd_at?: string | null;
    overstap_dynamische_leverancier_at?: string | null;
    review_gevraagd_at?: string | null;
    aangetekende_brief_verstuurd_at?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status) {
    if (!PROJECT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    patch.status = body.status;
    // Annulering → van planbord af (schouw/installatie wissen)
    if (body.status === "annulering") {
      patch.schouw_at = null;
      patch.schouw_jaar = null;
      patch.schouw_week = null;
      patch.installatie_at = null;
      patch.service_at = null;
      patch.materiaal_leverdatum = null;
    }
  }
  if (body.betaalwijze !== undefined) {
    if (
      body.betaalwijze !== "warmtefonds" &&
      body.betaalwijze !== "eigen_middelen"
    ) {
      return NextResponse.json(
        { error: "Ongeldige betaalwijze" },
        { status: 400 }
      );
    }
    patch.betaalwijze = body.betaalwijze;
    patch.betaalwijze_gewijzigd_at = new Date().toISOString();
    patch.betaalwijze_reden =
      body.betaalwijze_reden?.trim() ||
      (body.status === "warmtefonds_afgewezen"
        ? "Warmtefonds afgewezen"
        : null);
  }
  if (body.titel !== undefined) {
    patch.titel = body.titel?.trim() || null;
  }
  if (typeof body.projectkosten === "number") {
    if (Number.isNaN(body.projectkosten) || body.projectkosten < 0) {
      return NextResponse.json(
        { error: "Ongeldige projectkosten" },
        { status: 400 }
      );
    }
    patch.projectkosten = Math.round(body.projectkosten * 100) / 100;
  }
  if (body.bel_schouw_aanbetaling_at !== undefined) {
    if (body.bel_schouw_aanbetaling_at === null) {
      patch.bel_schouw_aanbetaling_at = null;
    } else {
      const d = new Date(body.bel_schouw_aanbetaling_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige bel-datum" },
          { status: 400 }
        );
      }
      patch.bel_schouw_aanbetaling_at = d.toISOString();
    }
  }
  if (body.financiering_geschakeld_at !== undefined) {
    if (body.financiering_geschakeld_at === null) {
      patch.financiering_geschakeld_at = null;
    } else {
      const d = new Date(body.financiering_geschakeld_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige datum" },
          { status: 400 }
        );
      }
      patch.financiering_geschakeld_at = d.toISOString();
    }
  }
  if (body.warmtefonds_aangevraagd_at !== undefined) {
    if (body.warmtefonds_aangevraagd_at === null) {
      patch.warmtefonds_aangevraagd_at = null;
    } else {
      const d = new Date(body.warmtefonds_aangevraagd_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige Warmtefonds-aanvraagdatum" },
          { status: 400 }
        );
      }
      patch.warmtefonds_aangevraagd_at = d.toISOString();
    }
  }
  for (const key of [
    "btw_terugvragen_aangevraagd_at",
    "overstap_dynamische_leverancier_at",
    "review_gevraagd_at",
    "aangetekende_brief_verstuurd_at",
  ] as const) {
    const val = body[key];
    if (val === undefined) continue;
    if (val === null) {
      patch[key] = null;
      continue;
    }
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Ongeldige datum" }, { status: 400 });
    }
    patch[key] = d.toISOString();
  }
  if (
    body.status === "review_gevraagd" &&
    patch.review_gevraagd_at === undefined
  ) {
    patch.review_gevraagd_at = new Date().toISOString();
  }
  if (body.financiering_status !== undefined) {
    if (body.financiering_status === null) {
      patch.financiering_status = null;
      if (body.warmtefonds_afspraak_at === undefined) {
        patch.warmtefonds_afspraak_at = null;
      }
    } else if (!isFinancieringStatus(body.financiering_status)) {
      return NextResponse.json(
        { error: "Ongeldige financieringsstatus" },
        { status: 400 }
      );
    } else {
      patch.financiering_status = body.financiering_status;
    }
  }
  if (body.warmtefonds_afspraak_at !== undefined) {
    if (body.warmtefonds_afspraak_at === null) {
      patch.warmtefonds_afspraak_at = null;
    } else {
      const d = new Date(body.warmtefonds_afspraak_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige Warmtefonds-afspraakdatum" },
          { status: 400 }
        );
      }
      patch.warmtefonds_afspraak_at = d.toISOString();
    }
  }
  if (body.schouw_jaar !== undefined || body.schouw_week !== undefined) {
    if (body.schouw_jaar == null || body.schouw_week == null) {
      patch.schouw_jaar = null;
      patch.schouw_week = null;
      patch.schouw_at = null;
    } else if (!isValidSchouwWeek(body.schouw_jaar, body.schouw_week)) {
      return NextResponse.json(
        { error: "Ongeldige schouwweek" },
        { status: 400 }
      );
    } else {
      try {
        patch.schouw_jaar = body.schouw_jaar;
        patch.schouw_week = body.schouw_week;
        patch.schouw_at = schouwWeekToMondayIso(
          body.schouw_jaar,
          body.schouw_week
        );
      } catch {
        return NextResponse.json(
          { error: "Ongeldige schouwweek" },
          { status: 400 }
        );
      }
    }
  }
  if (body.leveradres !== undefined) {
    patch.leveradres = body.leveradres?.trim() || null;
  }
  if (body.materiaal_checks !== undefined) {
    patch.materiaal_checks =
      body.materiaal_checks && typeof body.materiaal_checks === "object"
        ? body.materiaal_checks
        : {};
  }
  if (body.materiaal_leverdatum !== undefined) {
    if (body.materiaal_leverdatum === null || body.materiaal_leverdatum === "") {
      patch.materiaal_leverdatum = null;
    } else {
      const raw = String(body.materiaal_leverdatum).trim();
      // yyyy-MM-dd → 09:00 Amsterdam
      let iso: string;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        iso = fromZonedTime(`${raw}T09:00:00`, AMSTERDAM_TZ).toISOString();
      } else {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "Ongeldige leverdatum" },
            { status: 400 }
          );
        }
        iso = d.toISOString();
      }
      patch.materiaal_leverdatum = iso;
    }
  }
  if (body.notities !== undefined) {
    patch.notities = body.notities?.trim() || null;
  }
  if (body.backoffice_notitie !== undefined) {
    patch.backoffice_notitie = body.backoffice_notitie?.trim() || null;
  }
  if (body.installateur_notitie !== undefined) {
    patch.installateur_notitie = body.installateur_notitie?.trim() || null;
  }
  if (body.verantwoordelijke_id !== undefined) {
    patch.verantwoordelijke_id = body.verantwoordelijke_id?.trim() || null;
  }
  if (body.installatie_partner_id !== undefined) {
    patch.installatie_partner_id =
      body.installatie_partner_id?.trim() || null;
  }
  if (body.schouw_notities !== undefined) {
    patch.schouw_notities = body.schouw_notities?.trim() || null;
  }
  if (body.installatie_notities !== undefined) {
    patch.installatie_notities = body.installatie_notities?.trim() || null;
  }
  if (body.service_notities !== undefined) {
    patch.service_notities = body.service_notities?.trim() || null;
  }
  if (body.afdeling !== undefined) {
    patch.afdeling = body.afdeling?.trim() || null;
  }

  // Datum Warmtefonds aangevraagd: alleen auto-zetten als die nog ontbreekt
  const autoWfAangevraagdAt =
    (body.status === "warmtefonds_aangevraagd" ||
      body.financiering_status === "aanvraag_gedaan") &&
    body.warmtefonds_aangevraagd_at === undefined;

  if (Object.keys(patch).length === 0 && !autoWfAangevraagdAt) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: before } = await sb
      .from("projecten")
      .select(
        "id, lead_id, status, project_nummer, materiaal_checks, warmtefonds_aangevraagd_at, financiering_status, installatie_voltooid_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (
      autoWfAangevraagdAt &&
      !(before as { warmtefonds_aangevraagd_at?: string | null } | null)
        ?.warmtefonds_aangevraagd_at
    ) {
      patch.warmtefonds_aangevraagd_at = new Date().toISOString();
    }

    if (
      body.status === "installatie_voltooid" &&
      before?.status !== "installatie_voltooid"
    ) {
      const hasRapport = await projectHeeftOpleveringsrapport(sb, id);
      if (!hasRapport) {
        return NextResponse.json(
          {
            error:
              "Upload eerst het opleveringsrapport met handtekening van de klant.",
          },
          { status: 400 }
        );
      }
      if (
        !(before as { installatie_voltooid_at?: string | null } | null)
          ?.installatie_voltooid_at
      ) {
        patch.installatie_voltooid_at = new Date().toISOString();
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    let { data, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)"
      )
      .single();

    // Kolom materiaal_leverdatum nog niet gemigreerd → bewaar in materiaal_checks.
    if (error && isMateriaalLeverdatumColumnError(error)) {
      const { materiaal_leverdatum: leverIso, ...rest } = patch;
      const prevChecks =
        (rest.materiaal_checks as Record<string, unknown> | undefined) ||
        ((before as { materiaal_checks?: Record<string, unknown> | null } | null)
          ?.materiaal_checks as Record<string, unknown> | null) ||
        {};
      const fallbackPatch = {
        ...rest,
        materiaal_checks: withLeverdatumInChecks(
          prevChecks,
          typeof leverIso === "string" || leverIso === null
            ? (leverIso as string | null)
            : null
        ),
      };
      const retryLever = await sb
        .from("projecten")
        .update(fallbackPatch)
        .eq("id", id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op)"
        )
        .single();
      data = retryLever.data;
      error = retryLever.error;
      if (!error && data) {
        // Virtualiseer kolom voor clients
        (data as { materiaal_leverdatum?: string | null }).materiaal_leverdatum =
          typeof leverIso === "string" ? leverIso : null;
      }
    }

    if (
      error &&
      (error.message?.includes("bel_schouw_aanbetaling_at") ||
        error.message?.includes("financiering_geschakeld_at") ||
        error.message?.includes("warmtefonds_aangevraagd_at") ||
        error.message?.includes("warmtefonds_afspraak_ingepland") ||
        error.message?.includes("financiering_status") ||
        error.message?.includes("warmtefonds_afspraak_at") ||
        error.message?.includes("btw_terugvragen_aangevraagd_at") ||
        error.message?.includes("overstap_dynamische_leverancier_at") ||
        error.message?.includes("review_gevraagd_at") ||
        error.message?.includes("installatie_voltooid_at") ||
        error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-installatie-voltooid-at.sql (en eventueel migrate-project-afronding.sql) uit in Supabase.",
          detail: error.message,
        },
        { status: 500 }
      );
    }

    if (
      error &&
      (error.message?.includes("offertes") || error.code === "PGRST200")
    ) {
      const retry = await sb
        .from("projecten")
        .update(patch)
        .eq("id", id)
        .select("*, leads(naam, email, telefoon, lead_number)")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Bijwerken mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    if (
      body.status === "installatie_voltooid" &&
      before?.status !== "installatie_voltooid"
    ) {
      try {
        await ensurePartnerInstallatieCreditfactuur(sb, id);
      } catch (e) {
        console.error("ensurePartnerInstallatieCreditfactuur:", e);
      }
      try {
        await ensureAdviseurCommissieTrancheB(sb, id);
      } catch (e) {
        console.error("ensureAdviseurCommissieTrancheB:", e);
      }
    }

    const leadId = (before?.lead_id || data.lead_id) as string | undefined;
    if (leadId) {
      if (body.status && before?.status && body.status !== before.status) {
        const aangevraagdAt =
          body.status === "warmtefonds_aangevraagd"
            ? ((patch.warmtefonds_aangevraagd_at as string | undefined) ||
                (data as { warmtefonds_aangevraagd_at?: string | null })
                  .warmtefonds_aangevraagd_at ||
                null)
            : null;
        await logLeadEvent({
          leadId,
          soort: "status",
          titel: `Projectstatus: ${projectStatusLabel[body.status] || body.status}`,
          detail: [
            before.status
              ? `Was: ${projectStatusLabel[before.status as ProjectStatus] || before.status}`
              : null,
            aangevraagdAt
              ? `Aangevraagd op ${new Date(aangevraagdAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
          meta: {
            project_id: id,
            project_nummer: data.project_nummer,
            van: before.status,
            naar: body.status,
            ...(aangevraagdAt
              ? { warmtefonds_aangevraagd_at: aangevraagdAt }
              : {}),
          },
        });
      }

      if (body.financiering_status !== undefined) {
        const prevFs =
          (before as { financiering_status?: string | null } | null)
            ?.financiering_status ?? null;
        const nextFs = body.financiering_status;
        if (prevFs !== nextFs) {
          const nextLabel = nextFs
            ? FINANCIERING_STATUS_LABEL[nextFs]
            : "Gerereset";
          const prevLabel = prevFs
            ? isFinancieringStatus(prevFs)
              ? FINANCIERING_STATUS_LABEL[prevFs]
              : prevFs
            : "Nog niet gestart";
          await logLeadEvent({
            leadId,
            soort: "status",
            titel: `Financiering: ${nextLabel}`,
            detail: `Was: ${prevLabel}`,
            meta: {
              project_id: id,
              project_nummer: data.project_nummer,
              veld: "financiering_status",
              van: prevFs,
              naar: nextFs,
            },
          });
        }

        // Na goedkeuring: concept-restantfactuur Warmtefonds klaarzetten
        if (
          nextFs === "aanvraag_goedgekeurd" &&
          prevFs !== "aanvraag_goedgekeurd"
        ) {
          const offRaw = data.offertes;
          const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;
          if (off?.id && off.financiering_voorbehoud) {
            const { ensureRestantDraftFactuur } = await import(
              "@/lib/ensure-btw-factuur"
            );
            await ensureRestantDraftFactuur(sb, {
              offerteId: off.id,
              leadId,
              projectId: id,
              offerteNummer: off.offerte_nummer || data.project_nummer || "",
              orderIncBtw: Number(off.totaal_inc_btw) || 0,
              orderExBtw: Number(off.subtotaal_ex_btw) || 0,
              warmtefonds: true,
            });
          }
        }
      }

      if (body.materiaal_checks && typeof body.materiaal_checks === "object") {
        const prev = (before?.materiaal_checks || {}) as Record<
          string,
          boolean | string
        >;
        const next = body.materiaal_checks;
        const isOrdered = (v: boolean | string | undefined) =>
          v === true || v === "besteld" || v === "geleverd";
        const newlyChecked = Object.keys(next).filter(
          (key) => isOrdered(next[key]) && !isOrdered(prev[key])
        );
        for (const key of newlyChecked) {
          const label = key.replace(/^std:/, "").replace(/[_-]/g, " ");
          const statusLabel =
            next[key] === "geleverd" ? "geleverd" : "besteld";
          await logLeadEvent({
            leadId,
            soort: "inkoop",
            titel: `Inkoop ${statusLabel}: ${label}`,
            detail: data.project_nummer
              ? `Project ${data.project_nummer}`
              : null,
            meta: { project_id: id, check_key: key, status: next[key] },
          });
        }
        if (body.materiaal_volledig_afgevinkt === true) {
          await logLeadEvent({
            leadId,
            soort: "inkoop",
            titel: "Bestelling volledig afgevinkt",
            detail: data.project_nummer
              ? `Alle artikelen besteld · Project ${data.project_nummer}`
              : "Alle artikelen besteld",
            meta: {
              project_id: id,
              project_nummer: data.project_nummer,
              volledig: true,
            },
          });
        }
      }
    }

    if (body.status || body.financiering_status !== undefined) {
      const { syncAutoTakenVoorProject } = await import(
        "@/lib/sync-auto-taken"
      );
      await syncAutoTakenVoorProject(
        sb,
        id,
        (body.status ||
          (data as { status?: string }).status ||
          before?.status ||
          "") as string,
        body.financiering_status !== undefined
          ? body.financiering_status
          : undefined
      );
    }

    let annuleringMail: {
      sent: boolean;
      skipped?: boolean;
      error?: string;
    } | null = null;

    if (
      body.status === "annulering" &&
      before?.status &&
      before.status !== "annulering"
    ) {
      const leadRaw = data.leads;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      const to =
        lead && typeof lead === "object" && typeof lead.email === "string"
          ? lead.email.trim()
          : "";
      const naam =
        lead && typeof lead === "object" && typeof lead.naam === "string"
          ? lead.naam
          : "klant";

      if (!to) {
        annuleringMail = {
          sent: false,
          skipped: true,
          error: "Geen e-mailadres op de lead",
        };
      } else {
        const { sendEmail } = await import("@/lib/email/postmark");
        const { projectGeannuleerdKlantEmail } = await import(
          "@/lib/email/templates"
        );
        const html = projectGeannuleerdKlantEmail({
          naam,
          projectNummer: (data.project_nummer as string) || null,
        });
        const mail = await sendEmail({
          to,
          subject: "Bestelling geannuleerd — Batterijconcept",
          html,
          tag: "project-annulering",
        });
        annuleringMail = {
          sent: mail.ok,
          error: mail.error,
        };
        if (leadId) {
          await logLeadEvent({
            leadId,
            soort: "email",
            titel: mail.ok
              ? "Annuleringsmail verstuurd naar klant"
              : "Annuleringsmail mislukt",
            detail: mail.ok
              ? `Naar ${to}`
              : mail.error || "Onbekende fout",
            meta: {
              project_id: id,
              project_nummer: data.project_nummer,
              to,
              ok: mail.ok,
            },
          });
        }
      }
    }

    return NextResponse.json({ project: data, annulering_mail: annuleringMail });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
