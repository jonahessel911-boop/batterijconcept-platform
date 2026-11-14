/**
 * TikTok Events API — dezelfde funnelmomenten als Meta CAPI.
 *
 * Status → events komt uit meta-capi-config. TikTok-naam:
 *   QualifiedLead    → CompleteRegistration
 *   Schedule         → Schedule
 *   Purchase         → CompletePayment  (met omzet)
 *   NotQualifiedLead → NotQualifiedLead (custom)
 *
 * Dedup: `tt:<Meta-event>` in leads.capi_events_sent, plus een vaste event_id
 * zodat een retry bij TikTok niet dubbel telt.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashMetaUserField } from "@/lib/meta-capi";
import {
  metaCapiEventsForStatus,
  type MetaCapiEventName,
} from "@/lib/meta-capi-config";
import type { LeadStatus } from "@/types/database";

const TRACK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

/** Meta-event → TikTok standard / custom event. */
export const TIKTOK_EVENT_NAME: Record<MetaCapiEventName, string> = {
  QualifiedLead: "CompleteRegistration",
  Schedule: "Schedule",
  Purchase: "CompletePayment",
  NotQualifiedLead: "NotQualifiedLead",
};

export type TikTokSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  sent: MetaCapiEventName[];
  already: MetaCapiEventName[];
  errors?: string[];
};

function pixelCode(): string | null {
  return (
    process.env.TIKTOK_PIXEL_CODE?.trim() ||
    process.env.TIKTOK_PIXEL_ID?.trim() ||
    null
  );
}

function accessToken(): string | null {
  return (
    process.env.TIKTOK_EVENTS_ACCESS_TOKEN?.trim() ||
    process.env.TIKTOK_ACCESS_TOKEN?.trim() ||
    null
  );
}

function dedupKey(event: MetaCapiEventName): string {
  return `tt:${event}`;
}

function eventSourceUrl(lead: {
  lander?: string | null;
  meta_event_source_url?: string | null;
}): string {
  const raw =
    lead.meta_event_source_url?.trim() || lead.lander?.trim() || "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `https://batterijconcept.nl${raw}`;
  if (raw) return `https://batterijconcept.nl/${raw.replace(/^\//, "")}`;
  return "https://batterijconcept.nl";
}

function clickFromUrl(raw: string | null | undefined): {
  ttclid: string | null;
  ttp: string | null;
} {
  if (!raw?.trim()) return { ttclid: null, ttp: null };
  const trimmed = raw.trim();
  if (!/ttclid|ttp=/i.test(trimmed)) return { ttclid: null, ttp: null };
  try {
    const withProto = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://batterijconcept.nl/${trimmed.replace(/^\//, "")}`;
    const url = new URL(withProto);
    return {
      ttclid: url.searchParams.get("ttclid"),
      ttp: url.searchParams.get("ttp"),
    };
  } catch {
    return { ttclid: null, ttp: null };
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** ttclid / _ttp uit het webhook-payload of een landings-URL. */
export function tiktokClickFromLead(lead: {
  lander?: string | null;
  meta_event_source_url?: string | null;
  raw_payload?: unknown;
}): { ttclid: string | null; ttp: string | null } {
  const raw =
    lead.raw_payload && typeof lead.raw_payload === "object"
      ? (lead.raw_payload as Record<string, unknown>)
      : null;
  const fromPayload = raw
    ? {
        ttclid:
          str(raw.ttclid) ||
          str(raw.tt_clid) ||
          str(raw.tiktok_ttclid) ||
          str(raw.callback),
        ttp: str(raw.ttp) || str(raw._ttp) || str(raw.tiktok_ttp),
      }
    : { ttclid: null, ttp: null };

  const fromUrl = clickFromUrl(
    str(raw?.event_source_url) ||
      str(raw?.page_url) ||
      str(raw?.landing_url) ||
      str(raw?.url) ||
      lead.meta_event_source_url ||
      lead.lander
  );

  return {
    ttclid: fromPayload.ttclid || fromUrl.ttclid,
    ttp: fromPayload.ttp || fromUrl.ttp,
  };
}

async function purchaseValueForLead(leadId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("offertes")
    .select("subtotaal_ex_btw, status, ondertekend_op, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = data || [];
  const signed = rows
    .filter((o) => o.status === "ondertekend")
    .sort((a, b) => {
      const ta = a.ondertekend_op ? new Date(a.ondertekend_op).getTime() : 0;
      const tb = b.ondertekend_op ? new Date(b.ondertekend_op).getTime() : 0;
      return tb - ta;
    })[0];
  const pick = signed || rows[0];
  return pick ? Number(pick.subtotaal_ex_btw) || 0 : 0;
}

type LeadRow = {
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  plaats: string | null;
  postcode: string | null;
  lander: string | null;
  status: LeadStatus;
  capi_events_sent?: string[] | null;
  meta_client_ip?: string | null;
  meta_user_agent?: string | null;
  meta_event_source_url?: string | null;
  raw_payload?: unknown;
};

function buildUser(lead: LeadRow): Record<string, unknown> | null {
  const user: Record<string, unknown> = {};
  const em = hashMetaUserField("email", lead.email);
  const ph = hashMetaUserField("phone", lead.telefoon);
  const external = hashMetaUserField("email", lead.id);
  if (em) user.email = [em];
  if (ph) user.phone = [ph];
  if (external) user.external_id = [external];

  const click = tiktokClickFromLead(lead);
  if (click.ttclid) user.ttclid = click.ttclid;
  if (click.ttp) user.ttp = click.ttp;
  if (lead.meta_client_ip?.trim()) user.ip = lead.meta_client_ip.trim();
  if (lead.meta_user_agent?.trim()) {
    user.user_agent = lead.meta_user_agent.trim();
  }

  if (!em && !ph && !click.ttclid) return null;
  return user;
}

async function postTikTokEvents(
  events: Record<string, unknown>[]
): Promise<{ ok: boolean; error?: string }> {
  const pixel = pixelCode();
  const token = accessToken();
  if (!pixel || !token) {
    return {
      ok: false,
      error: "TIKTOK_PIXEL_CODE / TIKTOK_EVENTS_ACCESS_TOKEN ontbreekt",
    };
  }

  const body: Record<string, unknown> = {
    event_source: "web",
    event_source_id: pixel,
    data: events,
  };
  const testCode = process.env.TIKTOK_TEST_EVENT_CODE?.trim();
  if (testCode) body.test_event_code = testCode;

  try {
    const res = await fetch(TRACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": token,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
    };
    if (!res.ok || (typeof json.code === "number" && json.code !== 0)) {
      return {
        ok: false,
        error: json.message || `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Netwerkfout",
    };
  }
}

const LEAD_SELECT =
  "id, naam, email, telefoon, plaats, postcode, lander, status, capi_events_sent, meta_client_ip, meta_user_agent, meta_event_source_url, raw_payload";

/**
 * Stuurt de TikTok-events die bij deze status horen en nog niet verstuurd zijn.
 */
export async function syncLeadTikTokEvents(
  leadId: string,
  opts?: { forceStatus?: LeadStatus | string }
): Promise<TikTokSyncResult> {
  if (!pixelCode() || !accessToken()) {
    return {
      ok: false,
      skipped: true,
      reason: "TikTok Events API niet geconfigureerd",
      sent: [],
      already: [],
    };
  }

  const sb = getSupabaseAdmin();
  let { data: lead, error } = await sb
    .from("leads")
    .select(LEAD_SELECT)
    .eq("id", leadId)
    .single();

  if (
    error &&
    (error.message?.includes("raw_payload") || error.code === "42703")
  ) {
    ({ data: lead, error } = await sb
      .from("leads")
      .select(
        "id, naam, email, telefoon, plaats, postcode, lander, status, capi_events_sent, meta_client_ip, meta_user_agent, meta_event_source_url"
      )
      .eq("id", leadId)
      .single());
  }

  if (error || !lead) {
    return {
      ok: false,
      reason: error?.message || "Lead niet gevonden",
      sent: [],
      already: [],
    };
  }

  const row = lead as LeadRow;
  const status = (opts?.forceStatus || row.status) as LeadStatus;
  const needed = metaCapiEventsForStatus(status);
  const sentKeys = new Set((row.capi_events_sent || []).filter(Boolean));
  const already = needed.filter((e) => sentKeys.has(dedupKey(e)));
  const toSend = needed.filter((e) => !sentKeys.has(dedupKey(e)));

  if (toSend.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason:
        needed.length === 0
          ? "Status stuurt geen events"
          : "Alles al verstuurd",
      sent: [],
      already,
    };
  }

  const user = buildUser(row);
  if (!user) {
    return {
      ok: true,
      skipped: true,
      reason: "Geen e-mail, telefoon of ttclid om te matchen",
      sent: [],
      already,
    };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const url = eventSourceUrl(row);
  let purchaseValue = 0;
  if (toSend.includes("Purchase")) {
    purchaseValue = await purchaseValueForLead(leadId);
  }

  const payload = toSend.map((metaName) => {
    const event = TIKTOK_EVENT_NAME[metaName];
    const properties: Record<string, unknown> = {
      content_name: status,
      description: metaName,
    };
    if (metaName === "Purchase") {
      properties.currency = "EUR";
      properties.value = purchaseValue;
      properties.content_type = "product";
    }
    return {
      event,
      event_time: eventTime,
      event_id: `tt_${metaName.toLowerCase()}_${leadId}`,
      user,
      page: { url },
      properties,
    };
  });

  const result = await postTikTokEvents(payload);
  if (!result.ok) {
    return {
      ok: false,
      reason: result.error,
      sent: [],
      already,
      errors: [result.error || "send failed"],
    };
  }

  const { data: fresh } = await sb
    .from("leads")
    .select("capi_events_sent")
    .eq("id", leadId)
    .single();
  const prev = (
    (fresh as { capi_events_sent?: string[] | null } | null)?.capi_events_sent ||
    row.capi_events_sent ||
    []
  ).filter(Boolean);
  const nextSent = [...new Set([...prev, ...toSend.map(dedupKey)])];
  const { error: updateErr } = await sb
    .from("leads")
    .update({ capi_events_sent: nextSent })
    .eq("id", leadId);

  if (updateErr) {
    console.error("tiktok capi_events_sent update:", updateErr.message);
  }

  return { ok: true, sent: toSend, already };
}
