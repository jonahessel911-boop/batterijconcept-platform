import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { buildKlantTrack } from "@/lib/klant-track";
import { isSchouwFormulierBewijs } from "@/lib/project-documenten";
import {
  toKlantDatumOptie,
  type ProjectDatumOptie,
} from "@/lib/project-datum-opties";

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
        "id, lead_id, offerte_nummer, status, ondertekend_op, signed_pdf_path, totaal_inc_btw, track_token, track_view_count, leads(naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats)"
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

    const projectSelectBase =
      "id, project_nummer, status, betaalwijze, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_voltooid_at, service_at, warmtefonds_afspraak_at, financiering_status, btw_terugvragen_aangevraagd_at, overstap_dynamische_leverancier_at, offerte_id, lead_id, updated_at, offertes(financiering_voorbehoud)";
    const projectSelectWithOverstap =
      "id, project_nummer, status, betaalwijze, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_voltooid_at, service_at, overstap_afspraak_at, warmtefonds_afspraak_at, financiering_status, btw_terugvragen_aangevraagd_at, overstap_dynamische_leverancier_at, offerte_id, lead_id, updated_at, offertes(financiering_voorbehoud)";

    type ProjectRow = {
      id: string;
      project_nummer: string;
      status: string;
      betaalwijze?: string | null;
      schouw_jaar?: number | null;
      schouw_week?: number | null;
      schouw_at?: string | null;
      installatie_at?: string | null;
      installatie_voltooid_at?: string | null;
      service_at?: string | null;
      overstap_afspraak_at?: string | null;
      warmtefonds_afspraak_at?: string | null;
      financiering_status?: string | null;
      btw_terugvragen_aangevraagd_at?: string | null;
      overstap_dynamische_leverancier_at?: string | null;
      offerte_id?: string | null;
      lead_id?: string | null;
      updated_at?: string;
      offertes?:
        | { financiering_voorbehoud?: boolean | null }
        | { financiering_voorbehoud?: boolean | null }[]
        | null;
    };

    async function fetchProject(select: string): Promise<{
      data: ProjectRow | null;
      error: { message?: string; code?: string } | null;
    }> {
      const r1 = await sb
        .from("projecten")
        .select(select)
        .eq("offerte_id", offerte!.id)
        .maybeSingle();
      if (r1.data) {
        return { data: r1.data as unknown as ProjectRow, error: null };
      }
      if (r1.error) return { data: null, error: r1.error };
      const r2 = await sb
        .from("projecten")
        .select(select)
        .eq("lead_id", offerte!.lead_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        data: (r2.data as unknown as ProjectRow) || null,
        error: r2.error,
      };
    }

    let projectRes = await fetchProject(projectSelectWithOverstap);
    if (
      projectRes.error &&
      (projectRes.error.message?.includes("overstap_afspraak_at") ||
        projectRes.error.code === "42703")
    ) {
      projectRes = await fetchProject(projectSelectBase);
    }
    if (projectRes.error) throw projectRes.error;
    const project = projectRes.data;

    const lead = Array.isArray(offerte.leads) ? offerte.leads[0] : offerte.leads;
    const leadId = offerte.lead_id as string;

    let datumOpties: ReturnType<typeof toKlantDatumOptie>[] = [];
    const serviceAfspraken: { at: string }[] = [];
    if (project?.id) {
      const { data: optRows, error: optErr } = await sb
        .from("project_datum_opties")
        .select("*")
        .eq("project_id", project.id)
        .in("status", ["open", "gekozen"])
        .order("created_at", { ascending: false });
      if (
        !optErr &&
        optRows
      ) {
        const bySoort = new Map<string, ProjectDatumOptie>();
        const seenServiceAt = new Set<number>();
        for (const row of optRows as ProjectDatumOptie[]) {
          if (!bySoort.has(row.soort)) bySoort.set(row.soort, row);
          if (
            row.soort === "service" &&
            row.status === "gekozen" &&
            row.gekozen_slot
          ) {
            const ms = new Date(row.gekozen_slot).getTime();
            if (!Number.isNaN(ms) && !seenServiceAt.has(ms)) {
              seenServiceAt.add(ms);
              serviceAfspraken.push({ at: row.gekozen_slot });
            }
          }
        }
        datumOpties = [...bySoort.values()].map(toKlantDatumOptie);
        // Handmatig / via BO geplande service_at meenemen als die ontbreekt
        if (project.service_at) {
          const ms = new Date(project.service_at).getTime();
          if (!Number.isNaN(ms) && !seenServiceAt.has(ms)) {
            serviceAfspraken.push({ at: project.service_at });
          }
        }
        serviceAfspraken.sort(
          (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
        );
      } else if (project.service_at) {
        serviceAfspraken.push({ at: project.service_at });
      }
    }

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

    // Alle facturen die de klant heeft ontvangen (incl. creditfacturen)
    const filtered = (facturen || []).filter((f) => {
      if (f.offerte_id === offerte.id) return true;
      if (project?.id && f.project_id === project.id) return true;
      return false;
    });

    const payload = buildKlantTrack({
      trackToken,
      klantNaam: (lead as { naam?: string } | null)?.naam || "klant",
      klantEmail: (lead as { email?: string | null } | null)?.email || null,
      klantTelefoon:
        (lead as { telefoon?: string | null } | null)?.telefoon || null,
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
        totaal_inc_btw: Number(offerte.totaal_inc_btw) || 0,
      },
      datumOpties,
      serviceAfspraken,
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
              overstap_afspraak_at: project.overstap_afspraak_at,
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
        credit_van_factuur_id: f.credit_van_factuur_id,
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
