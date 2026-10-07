import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { buildKlantTrack } from "@/lib/klant-track";
import { isSchouwFormulierBewijs } from "@/lib/project-documenten";

export const runtime = "nodejs";

/**
 * GET /api/track/[token] — publieke klant track & trace payload
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select(
        "id, lead_id, offerte_nummer, status, ondertekend_op, signed_pdf_path, track_token, track_view_count, leads(naam, email, postcode, huisnummer, toevoeging, straat, plaats)"
      )
      .eq("track_token", token)
      .maybeSingle();

    if (error) {
      if (error.code === "42703" || error.message?.includes("track_token")) {
        return NextResponse.json(
          { error: "Track & trace is nog niet beschikbaar" },
          { status: 503 }
        );
      }
      throw error;
    }

    if (!offerte || offerte.status !== "ondertekend") {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    const trackToken = await ensureOfferteTrackToken(
      sb,
      offerte.id,
      offerte.track_token
    );
    if (!trackToken) {
      return NextResponse.json(
        { error: "Track & trace is nog niet beschikbaar" },
        { status: 503 }
      );
    }

    // Last sign-in / portaalbezoek (niet blokkeren bij fout)
    const seenAt = new Date().toISOString();
    const nextCount = (Number(offerte.track_view_count) || 0) + 1;
    void sb
      .from("offertes")
      .update({
        track_last_seen_at: seenAt,
        track_view_count: nextCount,
      })
      .eq("id", offerte.id)
      .then(({ error: seenErr }) => {
        if (seenErr) console.error("track_last_seen_at:", seenErr);
      });

    const projectSelect =
      "id, project_nummer, status, betaalwijze, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_voltooid_at, service_at, warmtefonds_afspraak_at, financiering_status, btw_terugvragen_aangevraagd_at, overstap_dynamische_leverancier_at, offerte_id, lead_id, updated_at, offertes(financiering_voorbehoud)";

    let { data: project } = await sb
      .from("projecten")
      .select(projectSelect)
      .eq("offerte_id", offerte.id)
      .maybeSingle();

    // Fallback: project via lead (oudere orders zonder/met verkeerde offerte-link)
    if (!project) {
      const { data: byLead } = await sb
        .from("projecten")
        .select(projectSelect)
        .eq("lead_id", offerte.lead_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      project = byLead;
    }

    const lead = Array.isArray(offerte.leads) ? offerte.leads[0] : offerte.leads;
    const leadId = offerte.lead_id as string;

    const [{ data: facturen }, schouwFormulierGeupload] = await Promise.all([
      sb
        .from("facturen")
        .select(
          "id, factuur_nummer, omschrijving, status, bedrag_inc_btw, factuurdatum, betaald_op, offerte_id, lead_id, project_id, credit_van_factuur_id"
        )
        .eq("lead_id", leadId)
        .in("status", ["verzonden", "betaald", "deels_betaald"])
        .order("factuurdatum", { ascending: false }),
      (async () => {
        if (!project?.id) return false;
        const { data: fotos } = await sb
          .from("project_fotos")
          .select("omschrijving, bestandsnaam, storage_path")
          .eq("project_id", project.id);
        return (fotos || []).some((f) =>
          isSchouwFormulierBewijs(
            f.omschrijving,
            f.bestandsnaam,
            f.storage_path
          )
        );
      })(),
    ]);

    const filtered = (facturen || []).filter((f) => {
      if (f.credit_van_factuur_id) return false;
      if (f.offerte_id === offerte.id) return true;
      if (project?.id && f.project_id === project.id) return true;
      return false;
    });

    const payload = buildKlantTrack({
      trackToken,
      klantNaam: (lead as { naam?: string } | null)?.naam || "klant",
      adres: lead
        ? adresRegel(
            lead as {
              postcode?: string | null;
              huisnummer?: string | null;
              toevoeging?: string | null;
              straat?: string | null;
              plaats?: string | null;
            }
          )
        : null,
      offerte: {
        offerte_nummer: offerte.offerte_nummer,
        ondertekend_op: offerte.ondertekend_op,
        signed_pdf_path: offerte.signed_pdf_path,
      },
      project: project
        ? (() => {
            const offJoin = Array.isArray(project.offertes)
              ? project.offertes[0]
              : project.offertes;
            return {
              project_nummer: project.project_nummer,
              status: project.status,
              betaalwijze: project.betaalwijze,
              financiering_voorbehoud: Boolean(
                (offJoin as { financiering_voorbehoud?: boolean | null } | null)
                  ?.financiering_voorbehoud
              ),
              schouw_jaar: project.schouw_jaar,
              schouw_week: project.schouw_week,
              schouw_at: project.schouw_at,
              installatie_at: project.installatie_at,
              installatie_voltooid_at: project.installatie_voltooid_at,
              service_at: project.service_at,
              warmtefonds_afspraak_at: project.warmtefonds_afspraak_at,
              financiering_status: project.financiering_status,
              schouw_formulier_geupload: schouwFormulierGeupload,
              btw_terugvragen_aangevraagd_at:
                project.btw_terugvragen_aangevraagd_at,
              overstap_dynamische_leverancier_at:
                project.overstap_dynamische_leverancier_at,
            };
          })()
        : null,
      facturen: filtered.map((f) => ({
        id: f.id,
        factuur_nummer: f.factuur_nummer,
        omschrijving: f.omschrijving,
        status: f.status,
        bedrag_inc_btw: Number(f.bedrag_inc_btw) || 0,
        factuurdatum: f.factuurdatum,
        betaald_op: f.betaald_op,
      })),
    });

    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
