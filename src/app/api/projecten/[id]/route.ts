import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { Betaalwijze, ProjectStatus } from "@/types/database";
import { PROJECT_STATUSES, projectStatusLabel } from "@/lib/labels";
import {
  isValidSchouwWeek,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { logLeadEvent } from "@/lib/lead-events";
import { resolveBetaalwijze } from "@/lib/project-status-config";

export const runtime = "nodejs";

const PROJECT_SELECT =
  "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, ondertekend_op)";

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
    schouw_jaar?: number | null;
    schouw_week?: number | null;
    leveradres?: string | null;
    materiaal_checks?: Record<string, boolean> | null;
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
  if (body.afdeling !== undefined) {
    patch.afdeling = body.afdeling?.trim() || null;
  }

  // Datum Warmtefonds aangevraagd: alleen auto-zetten als die nog ontbreekt
  const autoWfAangevraagdAt =
    body.status === "warmtefonds_aangevraagd" &&
    body.warmtefonds_aangevraagd_at === undefined;

  if (Object.keys(patch).length === 0 && !autoWfAangevraagdAt) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: before } = await sb
      .from("projecten")
      .select(
        "id, lead_id, status, project_nummer, materiaal_checks, warmtefonds_aangevraagd_at"
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

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    let { data, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, ondertekend_op)"
      )
      .single();

    if (
      error &&
      (error.message?.includes("bel_schouw_aanbetaling_at") ||
        error.message?.includes("financiering_geschakeld_at") ||
        error.message?.includes("warmtefonds_aangevraagd_at") ||
        error.message?.includes("warmtefonds_afspraak_ingepland") ||
        error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-warmtefonds-afspraak.sql (en eventueel bel-/financiering-migraties) uit in Supabase.",
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

      if (body.materiaal_checks && typeof body.materiaal_checks === "object") {
        const prev = (before?.materiaal_checks || {}) as Record<string, boolean>;
        const next = body.materiaal_checks;
        const newlyChecked = Object.keys(next).filter(
          (key) => next[key] === true && prev[key] !== true
        );
        for (const key of newlyChecked) {
          const label = key.replace(/^std:/, "").replace(/[_-]/g, " ");
          await logLeadEvent({
            leadId,
            soort: "inkoop",
            titel: `Inkoop gemarkeerd: ${label}`,
            detail: data.project_nummer
              ? `Project ${data.project_nummer}`
              : null,
            meta: { project_id: id, check_key: key },
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

    if (body.status) {
      const { syncAutoTakenVoorProject } = await import(
        "@/lib/sync-auto-taken"
      );
      await syncAutoTakenVoorProject(sb, id, body.status);
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
