/**
 * GET /api/v1/slots
 *
 * Moment-first (Retell):
 *   ?lead_id=…           → beste momenten (reistijd over adviseurs)
 *   ?lead_id=…&limit=6
 *
 * Legacy (per adviseur):
 *   ?adviseur_id=…       → kale kalender-slots van één adviseur
 */

import { NextRequest } from "next/server";
import { addDays, getISOWeekYear } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { AMSTERDAM_TZ, formatSlotLabelSpokenNl } from "@/lib/format";
import { generateAvailableSlots } from "@/lib/slots";
import { blockingBusySlots } from "@/lib/afspraak-busy";
import {
  dayKeyAmsterdam,
  filterSlotsByAfblokkingen,
  filterSlotsByBeschikbaarheid,
  loadAfblokkingen,
  loadUnavailableWeekKeys,
} from "@/lib/adviseur-beschikbaarheid";
import { requireSalesOrAdminApiKey } from "@/lib/api-v1/auth";
import { loadBestSlotsForLead } from "@/lib/api-v1/best-slots";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";
import { isAdminAdviseur } from "@/lib/admin-adviseur";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = requireSalesOrAdminApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const leadId = pickStr(sp.get("lead_id"), sp.get("leadId"));
  const adviseurId = pickStr(sp.get("adviseur_id"), sp.get("adviseurId"));
  const daysAhead = Math.min(
    Math.max(parseNum(sp.get("days")) || 21, 1),
    60
  );
  const limit = Math.min(
    Math.max(parseNum(sp.get("limit")) || (leadId ? 5 : 40), 1),
    100
  );

  try {
    const sb = getSupabaseAdmin();

    // —— Retell / agents: beste momenten voor lead ——
    if (leadId) {
      const result = await loadBestSlotsForLead(sb, {
        leadId,
        daysAhead,
        limit: Math.min(limit, 20),
      });
      if (!result.ok) {
        return jsonErr(result.error, result.status, {
          detail: result.detail,
        });
      }
      return jsonOk({
        ok: true,
        mode: result.mode,
        lead: result.lead,
        count: result.slots.length,
        slots: result.slots,
        slots_tekst: result.slots_tekst,
        note: result.note,
      });
    }

    // —— Legacy: zonder params → adviseurslijst ——
    if (!adviseurId) {
      const { data, error } = await sb
        .from("adviseurs")
        .select("id, naam, email, actief")
        .eq("actief", true)
        .order("naam");
      if (error) {
        return jsonErr("Adviseurs laden mislukt", 500, {
          detail: error.message,
        });
      }
      const adviseurs = (data || []).filter((a) => !isAdminAdviseur(a));
      return jsonOk({
        ok: true,
        hint: "Geef lead_id voor beste momenten (Retell), of adviseur_id voor kale slots",
        adviseurs: adviseurs.map((a) => ({
          id: a.id,
          naam: a.naam,
          email: a.email,
        })),
      });
    }

    // —— Legacy: slots van één adviseur ——
    const { data: adviseur, error: aErr } = await sb
      .from("adviseurs")
      .select("id, naam, email, actief")
      .eq("id", adviseurId)
      .maybeSingle();

    if (aErr) {
      return jsonErr("Adviseur laden mislukt", 500, { detail: aErr.message });
    }
    if (!adviseur || adviseur.actief === false) {
      return jsonErr("Adviseur niet gevonden of inactief", 404);
    }

    const busyRows = await blockingBusySlots(sb, adviseurId);
    const rawSlots = generateAvailableSlots({
      busy: busyRows,
      daysAhead,
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
    }));

    const nowLocal = toZonedTime(new Date(), AMSTERDAM_TZ);
    const y = getISOWeekYear(nowLocal);
    const unavailable = await loadUnavailableWeekKeys(sb, adviseurId, [
      y - 1,
      y,
      y + 1,
    ]);
    const van = dayKeyAmsterdam(new Date());
    const tot = dayKeyAmsterdam(addDays(new Date(), daysAhead + 5));
    const afgeblokt = await loadAfblokkingen(sb, {
      adviseurIds: [adviseurId],
      van,
      tot,
    });

    const slots = filterSlotsByAfblokkingen(
      filterSlotsByBeschikbaarheid(rawSlots, unavailable),
      adviseurId,
      afgeblokt
    )
      .slice(0, limit)
      .map((s) => ({
        start_at: s.start_at,
        end_at: s.end_at,
        label_nl: formatSlotLabelSpokenNl(s.start_at),
        label_kort: formatSlotLabelSpokenNl(s.start_at, { kort: true }),
      }));

    return jsonOk({
      ok: true,
      adviseur: { id: adviseur.id, naam: adviseur.naam },
      count: slots.length,
      slots,
      note: "Legacy per-adviseur. Voor Retell: GET ?lead_id=…",
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Slots laden mislukt"), 500);
  }
}
