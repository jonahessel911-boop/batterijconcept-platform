import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { ensureBtwDraftFactuur } from "@/lib/ensure-btw-factuur";
import { ensureProjectForOfferte } from "@/lib/ensure-project";
import {
  normalizeAanbetalingModus,
  parseEuroInput,
  type AanbetalingModus,
} from "@/lib/aanbetaling";

export const runtime = "nodejs";

/** PATCH /api/offertes/[id] — aanbetaling bij Warmtefonds */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    aanbetaling_modus?: AanbetalingModus | string;
    aanbetaling_bedrag_inc?: number | string | null;
    financiering_voorbehoud?: boolean;
    actie_required?: boolean;
    aanbetaling_te_innen_inc?: number | string | null;
    backoffice_notitie?: string | null;
    installateur_notitie?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.aanbetaling_modus != null) {
    patch.aanbetaling_modus = normalizeAanbetalingModus(body.aanbetaling_modus);
  }
  if (body.aanbetaling_bedrag_inc !== undefined) {
    const n =
      typeof body.aanbetaling_bedrag_inc === "string"
        ? parseEuroInput(body.aanbetaling_bedrag_inc)
        : Number(body.aanbetaling_bedrag_inc);
    if (Number.isNaN(n) || n < 0) {
      return NextResponse.json(
        { error: "Ongeldig aanbetalingsbedrag" },
        { status: 400 }
      );
    }
    patch.aanbetaling_bedrag_inc = Math.round(n * 100) / 100;
  }
  if (typeof body.financiering_voorbehoud === "boolean") {
    patch.financiering_voorbehoud = body.financiering_voorbehoud;
  }
  if (typeof body.actie_required === "boolean") {
    patch.actie_required = body.actie_required;
    patch.backoffice_afgerond_at = body.actie_required ? null : new Date().toISOString();
  }
  if (body.aanbetaling_te_innen_inc !== undefined) {
    const n =
      typeof body.aanbetaling_te_innen_inc === "string"
        ? parseEuroInput(body.aanbetaling_te_innen_inc)
        : Number(body.aanbetaling_te_innen_inc);
    if (Number.isNaN(n) || n < 0) {
      return NextResponse.json(
        { error: "Ongeldig bedrag voor aanbetaling te innen" },
        { status: 400 }
      );
    }
    patch.aanbetaling_te_innen_inc = Math.round(n * 100) / 100;
  }
  if (body.backoffice_notitie !== undefined) {
    patch.backoffice_notitie = body.backoffice_notitie?.trim() || null;
  }
  if (body.installateur_notitie !== undefined) {
    patch.installateur_notitie = body.installateur_notitie?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    let update = await sb
      .from("offertes")
      .update(patch)
      .eq("id", id)
      .select(
        "id, lead_id, titel, offerte_nummer, status, btw_bedrag, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud, aanbetaling_modus, aanbetaling_bedrag_inc, actie_required, aanbetaling_te_innen_inc, backoffice_notitie, installateur_notitie, leads(naam)"
      )
      .single();

    if (
      update.error &&
      (update.error.message?.includes("aanbetaling_") ||
        update.error.message?.includes("actie_required") ||
        update.error.message?.includes("backoffice_") ||
        update.error.message?.includes("installateur_notitie") ||
        update.error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Run migrate-offerte-backoffice-actie.sql in Supabase om backoffice velden in te stellen.",
        },
        { status: 400 }
      );
    }

    if (update.error || !update.data) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: update.error?.message },
        { status: 500 }
      );
    }

    const offerte = update.data;
    if (offerte.status === "ondertekend") {
      const leadJoin = (offerte as { leads?: { naam?: string | null } | null }).leads;
      const ensured = await ensureProjectForOfferte(sb, {
        offerteId: offerte.id,
        leadId: offerte.lead_id,
        offerteNummer: offerte.offerte_nummer,
        titel: offerte.titel,
        klantNaam: leadJoin?.naam || null,
      });
      const projectId = ensured?.id || null;

      if (projectId) {
        await sb
          .from("projecten")
          .update({
            aanbetaling_te_innen_inc:
              offerte.aanbetaling_te_innen_inc != null
                ? Number(offerte.aanbetaling_te_innen_inc)
                : null,
            backoffice_notitie: offerte.backoffice_notitie || null,
            installateur_notitie: offerte.installateur_notitie || null,
          })
          .eq("id", projectId);
      }

      await ensureBtwDraftFactuur(sb, {
        offerteId: offerte.id,
        leadId: offerte.lead_id,
        projectId,
        offerteNummer: offerte.offerte_nummer,
        btwBedrag: Number(offerte.btw_bedrag) || 0,
        subtotaalExBtw: Number(offerte.subtotaal_ex_btw) || 0,
        totaalIncBtw: Number(offerte.totaal_inc_btw) || 0,
        financieringVoorbehoud: Boolean(offerte.financiering_voorbehoud),
        aanbetalingModus: offerte.aanbetaling_modus,
        aanbetalingBedragInc:
          offerte.aanbetaling_bedrag_inc != null
            ? Number(offerte.aanbetaling_bedrag_inc)
            : null,
      });
    }

    return NextResponse.json({ offerte });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
