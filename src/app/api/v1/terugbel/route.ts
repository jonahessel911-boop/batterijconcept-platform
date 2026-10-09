/**
 * /api/v1/terugbel — terugbelverzoeken voor Retell / voicebots
 *
 * POST: maak een terugbel-afspraak (soort bel | warme_bel).
 *       Verschijnt in CRM → Bellen (chip “Terugbellen”).
 *
 * GET: openstaande terugbel-afspraken.
 *
 * Retell Code-node voorbeeld:
 *   POST { lead_id, notitie, start_at? }
 */

import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { requireApiKey } from "@/lib/api-v1/auth";
import {
  jsonErr,
  jsonOk,
  parseBool,
  parseNum,
  pickStr,
} from "@/lib/api-v1/http";
import { planAfspraak, parseJaNee } from "@/lib/plan-afspraak";
import { isTerugbelPlanbaar } from "@/lib/rollen";
import { isTerugbelSoort } from "@/lib/afspraak-soort";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ, formatDateTimeLongNl } from "@/lib/format";

export const runtime = "nodejs";

const ACTIEF = new Set(["gepland", "bevestigd", "verzet"]);

function amsterdamDay(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

async function resolveAdviseurId(
  sb: ReturnType<typeof getSupabaseAdmin>,
  preferred: string | null,
  leadAdviseurId: string | null
): Promise<string | null> {
  const { data: rows } = await sb
    .from("adviseurs")
    .select("id, naam, email, actief, rol")
    .eq("actief", true);

  const planbaar = (rows || []).filter(
    (a) => !isAdminAdviseur(a) && isTerugbelPlanbaar(a)
  );

  if (preferred && planbaar.some((a) => a.id === preferred)) {
    return preferred;
  }
  if (leadAdviseurId && planbaar.some((a) => a.id === leadAdviseurId)) {
    return leadAdviseurId;
  }
  return planbaar[0]?.id || null;
}

/** GET /api/v1/terugbel — openstaande terugbelverzoeken */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const leadId = pickStr(sp.get("lead_id"));
  const dueOnly = parseBool(sp.get("due") ?? sp.get("due_only")) ?? false;
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 100, 1), 500);

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("afspraken")
      .select(
        "id, lead_id, adviseur_id, start_at, end_at, status, soort, notities, created_at, leads(id, naam, telefoon, email, lead_number, terugbellen, terugbel_notitie, status), adviseurs(naam)"
      )
      .in("status", [...ACTIEF])
      .in("soort", ["bel", "warme_bel"])
      .order("start_at", { ascending: true })
      .limit(limit);

    if (leadId) q = q.eq("lead_id", leadId);

    const { data, error } = await q;
    if (error) {
      return jsonErr("Terugbel laden mislukt", 500, { detail: error.message });
    }

    const today = amsterdamDay(new Date());
    let items = data || [];
    if (dueOnly) {
      items = items.filter((a) => amsterdamDay(a.start_at) <= today);
    }

    return jsonOk({
      ok: true,
      count: items.length,
      terugbel: items.map((a) => ({
        id: a.id,
        lead_id: a.lead_id,
        adviseur_id: a.adviseur_id,
        start_at: a.start_at,
        status: a.status,
        soort: a.soort,
        warm: a.soort === "warme_bel",
        notities: a.notities,
        due: amsterdamDay(a.start_at) <= today,
        lead: a.leads,
        adviseur_naam:
          (a.adviseurs as { naam?: string } | null)?.naam || null,
      })),
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/**
 * POST /api/v1/terugbel — terugbelverzoek aanmaken (Retell)
 *
 * Body:
 *   lead_id*          uuid
 *   notitie           reden / samenvatting intake (ook: notities, reden)
 *   start_at          ISO of Amsterdam YYYY-MM-DDTHH:mm (default: nu)
 *   adviseur_id       optioneel; anders lead.adviseur_id of eerste planbare
 *   warm              boolean → warme_bel (default false)
 */
export async function POST(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Ongeldige JSON");
  }

  const leadId = pickStr(body.lead_id, body.leadId);
  if (!leadId) {
    return jsonErr("lead_id is verplicht");
  }

  const notitie =
    pickStr(body.notitie, body.notities, body.reden, body.reason) ||
    "Terugbelverzoek via AI-bot";
  const startAtRaw = pickStr(body.start_at, body.startAt, body.gewenst_tijdstip);
  const warm =
    parseBool(body.warm) ??
    parseJaNee(body.warme_bel ?? body.warme) ??
    false;
  const soort = warm ? "warme_bel" : "bel";
  const preferAdviseur = pickStr(body.adviseur_id, body.adviseurId);

  try {
    const sb = getSupabaseAdmin();

    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select("id, naam, telefoon, adviseur_id, status")
      .eq("id", leadId)
      .maybeSingle();

    if (leadErr || !lead) {
      return jsonErr("Lead niet gevonden", 404);
    }

    const adviseurId = await resolveAdviseurId(
      sb,
      preferAdviseur,
      lead.adviseur_id
    );
    if (!adviseurId) {
      return jsonErr("Geen planbare adviseur beschikbaar", 503);
    }

    // Oude openstaande terugbel afronden (zelfde als BelPanel)
    const { data: oude } = await sb
      .from("afspraken")
      .select("id, soort, status")
      .eq("lead_id", leadId)
      .in("status", [...ACTIEF]);

    const oudeIds = (oude || [])
      .filter((a) => isTerugbelSoort(a.soort))
      .map((a) => a.id);

    if (oudeIds.length > 0) {
      await sb
        .from("afspraken")
        .update({ status: "voltooid" })
        .in("id", oudeIds);
    }

    const startAt = startAtRaw || new Date().toISOString();

    const result = await planAfspraak(sb, {
      lead_id: leadId,
      adviseur_id: adviseurId,
      start_at: startAt,
      soort,
      notities: notitie,
    });

    if (!result.ok) {
      return jsonErr(result.error, result.status, { detail: result.detail });
    }

    const startLabel = formatDateTimeLongNl(
      String(result.afspraak.start_at)
    );

    return jsonOk(
      {
        ok: true,
        bericht: warm
          ? "Warme terugbel genoteerd — verschijnt in Bellen"
          : "Terugbelverzoek genoteerd — verschijnt in Bellen",
        terugbel: {
          afspraak_id: result.afspraak.id,
          lead_id: leadId,
          lead_naam: lead.naam,
          adviseur_id: adviseurId,
          start_at: result.afspraak.start_at,
          start_label_nl: startLabel,
          soort,
          warm,
          notitie,
        },
      },
      201
    );
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
