/**
 * Verwerk binnenkomende TC Swiss gebeurtenissen → store + lead_events.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { logLeadEvent } from "@/lib/lead-events";
import {
  parseTcSwissWebhookPayload,
  tcSwissEventDetail,
  tcSwissEventTitle,
  type TcSwissGebeurtenis,
} from "@/lib/tcswiss";
import {
  markTcSwissEventLogged,
  upsertTcSwissEvent,
  type TcSwissStoredEvent,
} from "@/lib/tcswiss-events-store";

async function resolveCrmLeadId(
  externId: string | null | undefined,
  klantEmail: string | null | undefined
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const ext = (externId || "").trim();
  if (ext) {
    // extern_id = onze lead UUID of lead_number
    const byId = await sb.from("leads").select("id").eq("id", ext).maybeSingle();
    if (byId.data?.id) return byId.data.id as string;
    const byNr = await sb
      .from("leads")
      .select("id")
      .eq("lead_number", ext)
      .maybeSingle();
    if (byNr.data?.id) return byNr.data.id as string;
  }
  const email = (klantEmail || "").trim().toLowerCase();
  if (email) {
    const { data } = await sb
      .from("leads")
      .select("id")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

export async function ingestTcSwissEvents(opts: {
  rawJson: unknown;
  source: "webhook" | "poll" | "manual";
}): Promise<{
  received: number;
  created: number;
  duplicates: number;
  logged: number;
  items: TcSwissStoredEvent[];
}> {
  const events = parseTcSwissWebhookPayload(opts.rawJson);
  let created = 0;
  let duplicates = 0;
  let logged = 0;
  const items: TcSwissStoredEvent[] = [];

  for (const ev of events) {
    const volg =
      typeof ev.volgnummer === "number"
        ? ev.volgnummer
        : Number.isFinite(Number(ev.volgnummer))
          ? Number(ev.volgnummer)
          : null;
    const { created: isNew, item } = upsertTcSwissEvent({
      volgnummer: volg,
      soort: String(ev.soort || "overig"),
      lead: typeof ev.lead === "string" ? ev.lead : null,
      externId: typeof ev.extern_id === "string" ? ev.extern_id : null,
      source: opts.source,
      payload: ev,
    });
    if (!isNew) {
      duplicates += 1;
      items.push(item);
      continue;
    }
    created += 1;

    const crmLeadId = await resolveCrmLeadId(
      item.externId,
      typeof ev.klant_email === "string" ? ev.klant_email : null
    );
    if (crmLeadId) {
      await logLeadEvent({
        leadId: crmLeadId,
        soort: mapSoort(ev),
        titel: tcSwissEventTitle(ev),
        detail: tcSwissEventDetail(ev),
        meta: {
          bron: "tcswiss",
          tcswiss_lead: item.lead,
          volgnummer: item.volgnummer,
          soort: item.soort,
          tijdstip: ev.tijdstip || null,
          payload: ev,
        },
        createdAt: typeof ev.tijdstip === "string" ? ev.tijdstip : null,
      });
      markTcSwissEventLogged(item.id, crmLeadId);
      logged += 1;
      items.push({ ...item, crmLeadId, logged: true });
    } else {
      items.push(item);
    }
  }

  return {
    received: events.length,
    created,
    duplicates,
    logged,
    items,
  };
}

function mapSoort(ev: TcSwissGebeurtenis): string {
  const s = String(ev.soort || "");
  if (s === "afspraak") return "afspraak";
  if (s === "notitie") return "notitie";
  if (s === "status" || s === "uitkomst") return "status";
  if (s === "document") return "overig";
  if (s === "offerte" || s === "verkoop" || s === "verkoop_teruggedraaid")
    return "overig";
  return "overig";
}
