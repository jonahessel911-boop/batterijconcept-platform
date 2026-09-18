import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";
import { serializeFactuur } from "@/lib/api-v1/serialize";
import { splitIncToExBtw } from "@/lib/aanbetaling";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
  parseBetaaltermijnDagen,
} from "@/lib/factuur-betaling";
import type { Factuur, FactuurStatus } from "@/types/database";

export const runtime = "nodejs";

const STATUSES: FactuurStatus[] = [
  "concept",
  "verzonden",
  "betaald",
  "deels_betaald",
  "vervallen",
];

async function loadFactuur(id: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("facturen")
    .select("*, leads(naam, email, telefoon, lead_number)")
    .eq("id", id)
    .maybeSingle();
  return { data: data as Factuur | null, error };
}

/** GET /api/v1/facturen/:id */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const { data, error } = await loadFactuur(id);
    if (error) return jsonErr("Laden mislukt", 500, { detail: error.message });
    if (!data) return jsonErr("Factuur niet gevonden", 404);
    return jsonOk({ ok: true, factuur: serializeFactuur(data) });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/** PATCH /api/v1/facturen/:id */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Ongeldige JSON");
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: current, error: loadErr } = await sb
      .from("facturen")
      .select("id, status, factuurdatum")
      .eq("id", id)
      .maybeSingle();

    if (loadErr) throw loadErr;
    if (!current) return jsonErr("Factuur niet gevonden", 404);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    const wantsEdit =
      body.bedrag_inc_btw !== undefined ||
      body.bedrag !== undefined ||
      body.omschrijving !== undefined ||
      body.betaaltermijn_dagen !== undefined;

    if (wantsEdit) {
      if (current.status !== "concept") {
        return jsonErr("Alleen conceptfacturen kunnen inhoudelijk worden bewerkt");
      }
      const bedragRaw = body.bedrag_inc_btw ?? body.bedrag;
      if (bedragRaw !== undefined) {
        const bedrag = parseNum(bedragRaw);
        if (bedrag == null || bedrag < 0.01) {
          return jsonErr("Ongeldig bedrag_inc_btw");
        }
        const split = splitIncToExBtw(bedrag);
        patch.bedrag_inc_btw = split.inc;
        patch.bedrag_ex_btw = split.ex;
        patch.btw_bedrag = split.btw;
      }
      if (body.omschrijving !== undefined) {
        patch.omschrijving = pickStr(body.omschrijving) || null;
      }
      if (body.betaaltermijn_dagen !== undefined) {
        const dagen = parseBetaaltermijnDagen(
          body.betaaltermijn_dagen,
          FACTUUR_BETAALTERMIJN_DAGEN
        );
        patch.vervaldatum = amsterdamDatePlusDays(
          current.factuurdatum || new Date(),
          dagen
        );
      }
    }

    if (body.status !== undefined) {
      const status = String(body.status) as FactuurStatus;
      if (!STATUSES.includes(status)) return jsonErr("Ongeldige status");
      patch.status = status;
      if (status === "betaald") {
        patch.betaald_op =
          pickStr(body.betaald_op) || new Date().toISOString().slice(0, 10);
      } else if (status !== "deels_betaald") {
        patch.betaald_op = null;
      }
    } else if (body.betaald_op !== undefined) {
      patch.betaald_op = pickStr(body.betaald_op) || null;
    }

    if (Object.keys(patch).length <= 1) {
      return jsonErr("Niets om bij te werken");
    }

    const { data, error } = await sb
      .from("facturen")
      .update(patch)
      .eq("id", id)
      .select("*, leads(naam, email, telefoon, lead_number)")
      .single();

    if (error || !data) {
      return jsonErr("Bijwerken mislukt", 500, { detail: error?.message });
    }

    return jsonOk({ ok: true, factuur: serializeFactuur(data as Factuur) });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/** DELETE /api/v1/facturen/:id */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { data: factuur } = await sb
      .from("facturen")
      .select("id, factuur_nummer, status")
      .eq("id", id)
      .maybeSingle();
    if (!factuur) return jsonErr("Factuur niet gevonden", 404);

    const { error } = await sb.from("facturen").delete().eq("id", id);
    if (error) {
      return jsonErr("Verwijderen mislukt", 500, { detail: error.message });
    }
    return jsonOk({ ok: true, factuur_nummer: factuur.factuur_nummer });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
