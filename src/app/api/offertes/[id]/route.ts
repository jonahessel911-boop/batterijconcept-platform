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
import type { OfferteRegel } from "@/types/database";

export const runtime = "nodejs";

/** GET /api/offertes/[id] — offerte + regels (o.a. materiaalinkoop) */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("offertes")
      .select(
        "id, offerte_nummer, status, lead_id, installatie_partner_id, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, offerte_regels(*), installatie_partners(id, naam, email, telefoon)"
      )
      .eq("id", id)
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: "Offerte niet gevonden" },
        { status: 404 }
      );
    }
    const regels = ((data as { offerte_regels?: OfferteRegel[] }).offerte_regels ||
      []) as OfferteRegel[];
    regels.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return NextResponse.json({
      offerte: { ...data, offerte_regels: regels },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

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
    backoffice_notitie_door?: string | null;
    installateur_notitie_door?: string | null;
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
  if (body.backoffice_notitie_door !== undefined) {
    patch.backoffice_notitie_door =
      body.backoffice_notitie_door?.trim() || null;
  }
  if (body.installateur_notitie_door !== undefined) {
    patch.installateur_notitie_door =
      body.installateur_notitie_door?.trim() || null;
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
        "id, lead_id, titel, offerte_nummer, status, btw_bedrag, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud, aanbetaling_modus, aanbetaling_bedrag_inc, actie_required, aanbetaling_te_innen_inc, backoffice_notitie, installateur_notitie, backoffice_notitie_door, installateur_notitie_door, leads(naam)"
      )
      .single();

    if (
      update.error &&
      (update.error.message?.includes("notitie_door") ||
        update.error.code === "42703")
    ) {
      delete patch.backoffice_notitie_door;
      delete patch.installateur_notitie_door;
      update = await sb
        .from("offertes")
        .update(patch)
        .eq("id", id)
        .select(
          "id, lead_id, titel, offerte_nummer, status, btw_bedrag, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud, aanbetaling_modus, aanbetaling_bedrag_inc, actie_required, aanbetaling_te_innen_inc, backoffice_notitie, installateur_notitie, leads(naam)"
        )
        .single();
    }

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
            "Run migrate-offerte-backoffice-actie.sql en migrate-notitie-door.sql in Supabase.",
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
    // Pas na “Actie afronden” (actie_required = false) doorstromen naar backoffice
    if (offerte.status === "ondertekend" && offerte.actie_required === false) {
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
        const projectPatch: Record<string, unknown> = {
          betaalwijze: Boolean(offerte.financiering_voorbehoud)
            ? "warmtefonds"
            : "eigen_middelen",
          aanbetaling_te_innen_inc:
            offerte.aanbetaling_te_innen_inc != null
              ? Number(offerte.aanbetaling_te_innen_inc)
              : null,
          backoffice_notitie: offerte.backoffice_notitie || null,
          installateur_notitie: offerte.installateur_notitie || null,
        };
        const o = offerte as {
          backoffice_notitie_door?: string | null;
          installateur_notitie_door?: string | null;
        };
        if (o.backoffice_notitie_door !== undefined) {
          projectPatch.backoffice_notitie_door =
            o.backoffice_notitie_door || null;
        }
        if (o.installateur_notitie_door !== undefined) {
          projectPatch.installateur_notitie_door =
            o.installateur_notitie_door || null;
        }
        const projUp = await sb
          .from("projecten")
          .update(projectPatch)
          .eq("id", projectId);
        if (
          projUp.error &&
          (projUp.error.message?.includes("notitie_door") ||
            projUp.error.code === "42703")
        ) {
          delete projectPatch.backoffice_notitie_door;
          delete projectPatch.installateur_notitie_door;
          await sb
            .from("projecten")
            .update(projectPatch)
            .eq("id", projectId);
        }

        // Koppel bestaande concept-BTW-factuur aan het nieuwe project
        await sb
          .from("facturen")
          .update({ project_id: projectId })
          .eq("offerte_id", offerte.id)
          .is("project_id", null);
      }

      // Doorzetten naar backoffice = sale afgeboekt (geen oranje “I” meer in agenda)
      if (typeof body.actie_required === "boolean" && body.actie_required === false) {
        const saleStatus = Boolean(offerte.financiering_voorbehoud)
          ? "sale_financiering"
          : "sale_eigen_middelen";
        await sb
          .from("leads")
          .update({ status: saleStatus })
          .eq("id", offerte.lead_id)
          .in("status", ["deal", "afspraak", "na_afspraak", "offerte"]);

        await sb
          .from("afspraken")
          .update({ status: "voltooid" })
          .eq("lead_id", offerte.lead_id)
          .in("status", ["gepland", "bevestigd", "verzet"])
          .in("soort", ["nieuw", "vervolg_fysiek"]);
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
    } else if (
      offerte.status === "ondertekend" &&
      (body.aanbetaling_modus != null ||
        body.aanbetaling_bedrag_inc !== undefined ||
        body.aanbetaling_te_innen_inc !== undefined ||
        body.financiering_voorbehoud !== undefined)
    ) {
      // Tussentijdse wijzigingen: factuur bijwerken zonder project
      await ensureBtwDraftFactuur(sb, {
        offerteId: offerte.id,
        leadId: offerte.lead_id,
        projectId: null,
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

function isBlockingFactuurStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "betaald" || s === "verstuurd" || s === "deels_betaald";
}

/**
 * DELETE /api/offertes/[id]
 * Verwijdert offerte + regels. Conceptfacturen mee; verstuurde/betaalde
 * facturen of gekoppelde projecten met harde facturen blokkeren.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Ontbrekend id" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: offerte, error: offErr } = await sb
      .from("offertes")
      .select("id, offerte_nummer, status, lead_id, titel")
      .eq("id", id)
      .maybeSingle();

    if (offErr) throw offErr;
    if (!offerte) {
      return NextResponse.json(
        { error: "Offerte niet gevonden" },
        { status: 404 }
      );
    }

    const { data: projecten, error: projErr } = await sb
      .from("projecten")
      .select("id, project_nummer")
      .eq("offerte_id", id);
    if (projErr && projErr.code !== "42P01") throw projErr;
    const projectIds = (projecten || []).map((p) => p.id as string);

    const { data: facturenOff, error: facOffErr } = await sb
      .from("facturen")
      .select("id, factuur_nummer, status")
      .eq("offerte_id", id);
    if (facOffErr && facOffErr.code !== "42P01") throw facOffErr;

    let facturenProj: { id: string; factuur_nummer: string; status: string }[] =
      [];
    if (projectIds.length > 0) {
      const { data, error } = await sb
        .from("facturen")
        .select("id, factuur_nummer, status")
        .in("project_id", projectIds);
      if (error && error.code !== "42P01") throw error;
      facturenProj = (data || []) as typeof facturenProj;
    }

    const allFac = [...(facturenOff || []), ...facturenProj];
    const blocked = allFac.find((f) => isBlockingFactuurStatus(f.status));
    if (blocked) {
      return NextResponse.json(
        {
          error: `Offerte heeft factuur ${blocked.factuur_nummer} (${blocked.status}) — die moet eerst weg of op concept.`,
        },
        { status: 409 }
      );
    }

    // Concept-/overige facturen op offerte
    if ((facturenOff || []).length > 0) {
      const { error: delFac } = await sb
        .from("facturen")
        .delete()
        .eq("offerte_id", id);
      if (delFac) {
        if (
          delFac.code === "23503" ||
          /foreign key|violates foreign key/i.test(delFac.message || "")
        ) {
          return NextResponse.json(
            {
              error:
                "Facturen zijn gekoppeld en blokkeren verwijderen. Verwijder of ontkoppel ze eerst.",
              detail: delFac.message,
            },
            { status: 409 }
          );
        }
        throw delFac;
      }
    }

    // Projecten: conceptfacturen weg, overige ontkoppelen, daarna project
    for (const pid of projectIds) {
      const { error: delFacProj } = await sb
        .from("facturen")
        .delete()
        .eq("project_id", pid);
      if (
        delFacProj &&
        delFacProj.code !== "42P01" &&
        (delFacProj.code === "23503" ||
          /foreign key|violates foreign key/i.test(delFacProj.message || ""))
      ) {
        // Probeer ontkoppelen i.p.v. hard delete
        const { error: unlinkFac } = await sb
          .from("facturen")
          .update({ project_id: null, offerte_id: null })
          .eq("project_id", pid);
        if (unlinkFac) {
          return NextResponse.json(
            {
              error:
                "Projectfacturen blokkeren verwijderen. Verwijder die facturen eerst.",
              detail: delFacProj.message,
            },
            { status: 409 }
          );
        }
      }

      for (const table of ["inkomende_facturen", "backoffice_actie_events"] as const) {
        await sb
          .from(table)
          .update({ project_id: null })
          .eq("project_id", pid);
      }

      const { error: delProj } = await sb
        .from("projecten")
        .delete()
        .eq("id", pid);
      if (delProj) {
        if (
          delProj.code === "23503" ||
          /foreign key|violates foreign key/i.test(delProj.message || "")
        ) {
          return NextResponse.json(
            {
              error:
                "Gekoppeld project blokkeert verwijderen. Verwijder eerst het project.",
              detail: delProj.message,
            },
            { status: 409 }
          );
        }
        throw delProj;
      }
    }

    const { error: delRegels } = await sb
      .from("offerte_regels")
      .delete()
      .eq("offerte_id", id);
    if (
      delRegels &&
      delRegels.code !== "42P01" &&
      !/does not exist|schema cache/i.test(delRegels.message || "")
    ) {
      throw delRegels;
    }

    const { error: delOff } = await sb.from("offertes").delete().eq("id", id);
    if (delOff) {
      if (
        delOff.code === "23503" ||
        /foreign key|violates foreign key/i.test(delOff.message || "")
      ) {
        return NextResponse.json(
          {
            error:
              "Offerte is gekoppeld aan andere gegevens en kan niet worden verwijderd.",
            detail: delOff.message,
          },
          { status: 409 }
        );
      }
      throw delOff;
    }

    return NextResponse.json({
      ok: true,
      offerte_nummer: offerte.offerte_nummer,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Offerte verwijderen mislukt") },
      { status: 500 }
    );
  }
}
