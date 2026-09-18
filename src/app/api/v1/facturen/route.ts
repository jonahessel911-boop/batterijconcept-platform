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
  factuurIsOpenstaand,
  parseBetaaltermijnDagen,
  withFactuurAdresOpPdfMarker,
} from "@/lib/factuur-betaling";
import type { Factuur } from "@/types/database";

export const runtime = "nodejs";

/** GET /api/v1/facturen */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const projectId = pickStr(sp.get("project_id"));
  const leadId = pickStr(sp.get("lead_id"));
  const status = pickStr(sp.get("status"));
  const openstaandOnly = sp.get("openstaand") === "1" || sp.get("openstaand") === "true";
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 100, 1), 500);

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("facturen")
      .select(
        "*, leads(naam, email, telefoon, lead_number)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (projectId) q = q.eq("project_id", projectId);
    if (leadId) q = q.eq("lead_id", leadId);
    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) {
      return jsonErr("Facturen laden mislukt", 500, { detail: error.message });
    }

    let facturen = (data || []) as Factuur[];
    if (openstaandOnly) {
      facturen = facturen.filter((f) => factuurIsOpenstaand(f.status));
    }

    return jsonOk({
      ok: true,
      count: facturen.length,
      facturen: facturen.map(serializeFactuur),
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/** POST /api/v1/facturen — concept aanmaken */
export async function POST(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Ongeldige JSON");
  }

  const projectId = pickStr(body.project_id, body.projectId);
  const bedrag = parseNum(body.bedrag_inc_btw ?? body.bedrag);
  const omschrijving = pickStr(body.omschrijving, body.titel) || "Factuur Batterijconcept";
  const betaaltermijn = parseBetaaltermijnDagen(
    body.betaaltermijn_dagen ?? body.betaaltermijn,
    FACTUUR_BETAALTERMIJN_DAGEN
  );
  const adresOpFactuur = Boolean(
    body.adres_gegevens_op_factuur ?? body.adres_op_factuur
  );

  if (!projectId) return jsonErr("project_id is verplicht");
  if (bedrag == null || bedrag < 0.01) {
    return jsonErr("bedrag_inc_btw is verplicht (minimaal 0,01)");
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: pErr } = await sb
      .from("projecten")
      .select("id, lead_id, offerte_id, project_nummer")
      .eq("id", projectId)
      .maybeSingle();

    if (pErr || !project) return jsonErr("Project niet gevonden", 404);

    const split = splitIncToExBtw(bedrag);
    const today = new Date();
    const factuurdatum = amsterdamDatePlusDays(today, 0);
    const vervaldatum = amsterdamDatePlusDays(today, betaaltermijn);

    const { data: nummer, error: numErr } = await sb.rpc(
      "generate_factuur_nummer"
    );
    if (numErr || !nummer) {
      return jsonErr("Kon geen factuurnummer genereren", 500, {
        detail: numErr?.message,
      });
    }

    const ref =
      (
        await sb
          .from("offertes")
          .select("offerte_nummer")
          .eq("id", project.offerte_id || "")
          .maybeSingle()
      ).data?.offerte_nummer || project.project_nummer;

    const notitiesBase = `Betreft ${project.project_nummer}. Betaal op NL48 BUNQ 2209 5579 33 t.n.v. BatterijConcept o.v.v. ${ref}.`;
    const notities = withFactuurAdresOpPdfMarker(notitiesBase, adresOpFactuur);

    const { data: factuur, error } = await sb
      .from("facturen")
      .insert({
        lead_id: project.lead_id,
        project_id: project.id,
        offerte_id: project.offerte_id || null,
        factuur_nummer: nummer as string,
        status: "concept",
        omschrijving,
        bedrag_ex_btw: split.ex,
        btw_bedrag: split.btw,
        bedrag_inc_btw: split.inc,
        factuurdatum,
        vervaldatum,
        notities,
      })
      .select("*, leads(naam, email, telefoon, lead_number)")
      .single();

    if (error || !factuur) {
      return jsonErr("Factuur aanmaken mislukt", 500, { detail: error?.message });
    }

    return jsonOk(
      { ok: true, factuur: serializeFactuur(factuur as Factuur) },
      201
    );
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
