import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireSalesOrAdminApiKey } from "@/lib/api-v1/auth";
import { decodeSlotId } from "@/lib/api-v1/best-slots";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";
import { planAfspraak, parseJaNee } from "@/lib/plan-afspraak";

export const runtime = "nodejs";

/** GET /api/v1/afspraken — sales-afspraken (huisbezoek/bel) */
export async function GET(req: NextRequest) {
  const denied = requireSalesOrAdminApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const leadId = pickStr(sp.get("lead_id"));
  const adviseurId = pickStr(sp.get("adviseur_id"));
  const status = pickStr(sp.get("status"));
  const from = pickStr(sp.get("from"));
  const to = pickStr(sp.get("to"));
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 100, 1), 500);

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number), adviseurs(naam, email)"
      )
      .order("start_at", { ascending: true })
      .limit(limit);

    if (leadId) q = q.eq("lead_id", leadId);
    if (adviseurId) q = q.eq("adviseur_id", adviseurId);
    if (status) q = q.eq("status", status);
    if (from) q = q.gte("start_at", new Date(from).toISOString());
    if (to) q = q.lte("start_at", new Date(to).toISOString());

    const { data, error } = await q;
    if (error) {
      return jsonErr("Afspraken laden mislukt", 500, { detail: error.message });
    }

    return jsonOk({ ok: true, count: (data || []).length, afspraken: data || [] });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/**
 * POST /api/v1/afspraken — sales-afspraak inplannen
 *
 * Retell (moment-first):
 *   { lead_id, slot_id }  → adviseur + start_at uit slot_id
 *
 * Legacy:
 *   { lead_id, adviseur_id, start_at }
 */
export async function POST(req: NextRequest) {
  const denied = requireSalesOrAdminApiKey(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Ongeldige JSON");
  }

  const leadId = pickStr(body.lead_id, body.leadId);
  const slotId = pickStr(body.slot_id, body.slotId);
  let adviseurId = pickStr(body.adviseur_id, body.adviseurId);
  let startAt = pickStr(body.start_at, body.startAt);

  if (slotId) {
    const token = decodeSlotId(slotId);
    if (!token) {
      return jsonErr("Ongeldige slot_id — haal opnieuw slots op");
    }
    adviseurId = token.a;
    startAt = token.s;
  }

  if (!leadId || !adviseurId || !startAt) {
    return jsonErr(
      "lead_id + slot_id verplicht (of lead_id + adviseur_id + start_at)"
    );
  }

  let partner = parseJaNee(body.partner_aanwezig ?? body.partner);
  let offertes = parseJaNee(body.andere_offertes_gehad ?? body.andere_offertes);
  const soort = pickStr(body.soort) || "nieuw";
  if (soort === "nieuw") {
    if (partner === undefined) partner = true;
    if (offertes === undefined) offertes = false;
  }

  try {
    const sb = getSupabaseAdmin();
    const result = await planAfspraak(sb, {
      lead_id: leadId,
      adviseur_id: adviseurId,
      start_at: startAt,
      soort,
      notities: pickStr(body.notities) || (slotId ? "Ingepland via Retell" : null),
      partner_aanwezig: partner,
      andere_offertes_gehad: offertes,
    });

    if (!result.ok) {
      return jsonErr(result.error, result.status, { detail: result.detail });
    }

    return jsonOk(
      {
        ok: true,
        afspraak: result.afspraak,
        manage_url: result.manage_url,
        bevestiging_direct: result.bevestiging_direct,
        bevestiging_error: result.bevestiging_error,
      },
      201
    );
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
