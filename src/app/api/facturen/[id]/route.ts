import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { splitIncToExBtw } from "@/lib/aanbetaling";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
  parseBetaaltermijnDagen,
} from "@/lib/factuur-betaling";
import { formatEuro } from "@/lib/format";
import { logLeadEvent } from "@/lib/lead-events";
import type { FactuurStatus } from "@/types/database";

export const runtime = "nodejs";

const FACTUUR_STATUSES: FactuurStatus[] = [
  "concept",
  "verzonden",
  "betaald",
  "deels_betaald",
  "vervallen",
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseBedragInc(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n =
    typeof raw === "string"
      ? Number(raw.trim().replace(/\s/g, "").replace(",", "."))
      : Number(raw);
  if (!Number.isFinite(n) || n < 0.01) return null;
  return n;
}

/** PATCH /api/facturen/[id] — status / betaaldatum / concept-bewerken */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    status?: FactuurStatus;
    betaald_op?: string | null;
    bedrag_inc_btw?: number | string | null;
    omschrijving?: string | null;
    betaaltermijn_dagen?: number | string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const wantsEdit =
    body.bedrag_inc_btw !== undefined ||
    body.omschrijving !== undefined ||
    body.betaaltermijn_dagen !== undefined;

  try {
    const sb = getSupabaseAdmin();

    const { data: current, error: loadErr } = await sb
      .from("facturen")
      .select(
        "id, status, factuurdatum, lead_id, factuur_nummer, bedrag_inc_btw, omschrijving"
      )
      .eq("id", id)
      .maybeSingle();

    if (loadErr) throw loadErr;
    if (!current) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};

    if (wantsEdit) {
      if (current.status !== "concept") {
        return NextResponse.json(
          { error: "Alleen conceptfacturen kunnen worden bewerkt" },
          { status: 400 }
        );
      }

      if (body.bedrag_inc_btw !== undefined) {
        const bedrag = parseBedragInc(body.bedrag_inc_btw);
        if (bedrag == null) {
          return NextResponse.json(
            { error: "Vul een geldig bedrag incl. btw in (minimaal €0,01)" },
            { status: 400 }
          );
        }
        const split = splitIncToExBtw(bedrag);
        patch.bedrag_inc_btw = split.inc;
        patch.bedrag_ex_btw = split.ex;
        patch.btw_bedrag = split.btw;
      }

      if (body.omschrijving !== undefined) {
        const oms = body.omschrijving?.trim() || null;
        patch.omschrijving = oms;
      }

      if (body.betaaltermijn_dagen !== undefined) {
        const dagen = parseBetaaltermijnDagen(
          body.betaaltermijn_dagen,
          FACTUUR_BETAALTERMIJN_DAGEN
        );
        const base = current.factuurdatum || todayIsoDate();
        patch.vervaldatum = amsterdamDatePlusDays(base, dagen);
      }
    }

    if (body.status != null) {
      if (!FACTUUR_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
      }
      patch.status = body.status;
      if (body.status === "betaald") {
        patch.betaald_op = body.betaald_op?.trim() || todayIsoDate();
      } else if (body.status !== "deels_betaald") {
        patch.betaald_op = null;
      }
    } else if (body.betaald_op !== undefined) {
      patch.betaald_op = body.betaald_op?.trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Niets om bij te werken" },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("facturen")
      .update(patch)
      .eq("id", id)
      .select("*, leads(naam, email, lead_number)")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    const becamePaid =
      body.status === "betaald" && current.status !== "betaald" && current.lead_id;
    if (becamePaid) {
      const nr = data.factuur_nummer || current.factuur_nummer || id.slice(0, 8);
      const bedrag = Number(data.bedrag_inc_btw ?? current.bedrag_inc_btw ?? 0);
      const oms =
        (typeof data.omschrijving === "string" && data.omschrijving) ||
        current.omschrijving ||
        null;
      await logLeadEvent({
        leadId: current.lead_id,
        soort: "betaling",
        titel: `Factuur ${nr} betaald`,
        detail: [
          bedrag > 0 ? formatEuro(bedrag) + " incl. btw" : null,
          oms,
        ]
          .filter(Boolean)
          .join(" · ") || null,
        meta: {
          factuur_id: id,
          factuur_nummer: nr,
          bedrag_inc_btw: bedrag,
        },
      });
    }

    return NextResponse.json({ factuur: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** DELETE /api/facturen/[id] — factuur hard verwijderen */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();

    const { data: factuur, error: loadErr } = await sb
      .from("facturen")
      .select("id, factuur_nummer, status")
      .eq("id", id)
      .maybeSingle();

    if (loadErr) throw loadErr;
    if (!factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    // Gekoppeld aan adviseur-creditfactuur → FK restrict
    const { data: creditRegel, error: creditErr } = await sb
      .from("adviseur_creditfactuur_regels")
      .select("id")
      .eq("factuur_id", id)
      .maybeSingle();

    if (creditErr && creditErr.code !== "42P01") {
      throw creditErr;
    }
    if (creditRegel) {
      return NextResponse.json(
        {
          error:
            "Deze factuur zit in een adviseur-creditfactuur en kan niet worden verwijderd. Maak eerst die creditregel ongedaan.",
        },
        { status: 409 }
      );
    }

    const { error } = await sb.from("facturen").delete().eq("id", id);
    if (error) {
      const msg = error.message || "";
      if (
        error.code === "23503" ||
        /foreign key|violates foreign key/i.test(msg)
      ) {
        return NextResponse.json(
          {
            error:
              "Factuur is gekoppeld aan andere gegevens en kan niet worden verwijderd.",
            detail: msg,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Verwijderen mislukt", detail: msg },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      factuur_nummer: factuur.factuur_nummer,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
