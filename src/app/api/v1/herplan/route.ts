/**
 * GET /api/v1/herplan
 *
 * Wachtrij voor de herplan-bot (Retell): geannuleerde huisbezoeken
 * die opnieuw ingepland moeten worden.
 *
 * Criteria:
 *   - lead.status = afspraak_afgezegd_klant / deur_niet_open
 *     OF  (mode=all) geannuleerde fysieke afspraak
 *   - geen actieve toekomstige huisbezoek-afspraak
 *   - telefoon aanwezig
 *
 * Per item: lead_id + oude afspraak + dynamic-var ready fields.
 * Boeken: zelfde als Fay → GET /slots?lead_id → POST /afspraken { lead_id, slot_id }
 */

import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import {
  annuleringsNotitieFromAfspraak,
  latestCancelledVisitAfspraak,
} from "@/lib/bel-queue";
import { formatDateTimeLongNl } from "@/lib/format";
import type { Afspraak, Lead } from "@/types/database";

export const runtime = "nodejs";

const ACTIEF = new Set(["gepland", "bevestigd", "verzet"]);

export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const mode = pickStr(sp.get("mode")) || "klant"; // klant | all
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 50, 1), 200);

  try {
    const sb = getSupabaseAdmin();
    const now = new Date();
    const nowMs = now.getTime();

    const [{ data: leads, error: leadErr }, { data: afspraken, error: afsErr }] =
      await Promise.all([
        sb
          .from("leads")
          .select(
            "id, lead_number, naam, telefoon, email, status, plaats, postcode, straat, huisnummer"
          )
          .not("telefoon", "is", null)
          .neq("telefoon", "")
          .order("updated_at", { ascending: false })
          .limit(500),
        sb
          .from("afspraken")
          .select(
            "id, lead_id, adviseur_id, start_at, end_at, status, soort, notities, updated_at"
          )
          .order("start_at", { ascending: false })
          .limit(2000),
      ]);

    if (leadErr) {
      return jsonErr("Leads laden mislukt", 500, { detail: leadErr.message });
    }
    if (afsErr) {
      return jsonErr("Afspraken laden mislukt", 500, { detail: afsErr.message });
    }

    const afs = (afspraken || []) as Afspraak[];
    const hasFutureActive = new Set<string>();
    for (const a of afs) {
      if (!afspraakBlokkeertAgenda(a.soort)) continue;
      if (!ACTIEF.has(a.status)) continue;
      if (new Date(a.start_at).getTime() <= nowMs) continue;
      hasFutureActive.add(a.lead_id);
    }

    const items: Record<string, unknown>[] = [];

    for (const lead of (leads || []) as Lead[]) {
      if (hasFutureActive.has(lead.id)) continue;
      if (!lead.telefoon?.trim()) continue;

      const cancelled = latestCancelledVisitAfspraak(afs, lead.id);
      const isDeurNietOpen = lead.status === "deur_niet_open";
      const isKlantAfgezegd = lead.status === "afspraak_afgezegd_klant";

      if (mode === "klant") {
        if (!isKlantAfgezegd && !isDeurNietOpen) continue;
      } else {
        // all: geannuleerde fysieke afspraak OF herplan-statussen
        if (!isKlantAfgezegd && !isDeurNietOpen && !cancelled) continue;
      }

      const reden =
        annuleringsNotitieFromAfspraak(cancelled) ||
        (isDeurNietOpen
          ? "Deur niet open / klant niet bereikbaar"
          : null);
      const firstName = (lead.naam || "").trim().split(/\s+/)[0] || "daar";
      const oudeLabel = cancelled
        ? formatDateTimeLongNl(cancelled.start_at)
        : null;

      items.push({
        lead_id: lead.id,
        lead_number: lead.lead_number,
        naam: lead.naam,
        first_name: firstName,
        telefoon: lead.telefoon,
        plaats: lead.plaats,
        status: lead.status,
        oude_afspraak_id: cancelled?.id || null,
        oude_afspraak_start_at: cancelled?.start_at || null,
        oude_afspraak_label_nl: oudeLabel,
        annuleringsreden: reden,
        /** Klaar om als Retell dynamic variables mee te geven bij outbound */
        dynamic_variables: {
          lead_id: lead.id,
          first_name: firstName,
          lead_naam: lead.naam || "",
          oude_afspraak_label: oudeLabel || "",
          annuleringsreden: reden || "",
        },
      });

      if (items.length >= limit) break;
    }

    return jsonOk({
      ok: true,
      mode,
      count: items.length,
      herplan: items,
      boek_via: {
        slots: "GET /api/v1/slots?lead_id=…",
        boek: "POST /api/v1/afspraken { lead_id, slot_id }",
      },
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
