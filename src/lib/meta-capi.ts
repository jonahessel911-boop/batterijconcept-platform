import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  metaCapiEventsForStatus,
  type MetaCapiEventName,
} from "@/lib/meta-capi-config";
import type { LeadStatus } from "@/types/database";

const GRAPH_VERSION = "v19.0";

export type MetaCapiSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  sent: MetaCapiEventName[];
  already: MetaCapiEventName[];
  errors?: string[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Normaliseer + hash voor Meta user_data. */
export function hashMetaUserField(
  kind: "email" | "phone" | "name" | "city" | "zip" | "country",
  raw: string | null | undefined
): string | null {
  if (!raw?.trim()) return null;
  let v = raw.trim().toLowerCase();
  if (kind === "email") {
    v = v.replace(/\s+/g, "");
  } else if (kind === "phone") {
    let digits = v.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("0") && digits.length === 10) {
      digits = `31${digits.slice(1)}`;
    }
    if (!digits) return null;
    v = digits;
  } else if (kind === "name" || kind === "city") {
    v = v.replace(/[^a-zà-ÿ\s'-]/gi, "").replace(/\s+/g, " ").trim();
  } else if (kind === "zip") {
    v = v.replace(/\s+/g, "").toLowerCase();
  } else if (kind === "country") {
    v = v.replace(/\s+/g, "").slice(0, 2);
  }
  if (!v) return null;
  return sha256(v);
}

function splitNaam(naam: string): { fn: string | null; ln: string | null } {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  if (parts.length === 1) return { fn: parts[0], ln: null };
  return { fn: parts[0], ln: parts.slice(1).join(" ") };
}

function pixelId(): string | null {
  return process.env.META_PIXEL_ID?.trim() || null;
}

function accessToken(): string | null {
  return process.env.META_CAPI_ACCESS_TOKEN?.trim() || null;
}

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://platform.batterijconcept.nl"
  );
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

type LeadCapiRow = {
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  plaats: string | null;
  postcode: string | null;
  lander: string | null;
  status: LeadStatus;
  capi_events_sent?: string[] | null;
  meta_fbc?: string | null;
  meta_fbp?: string | null;
  meta_client_ip?: string | null;
  meta_user_agent?: string | null;
  meta_event_source_url?: string | null;
};

async function purchaseValueForLead(
  leadId: string
): Promise<number> {
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
      const ta = a.ondertekend_op
        ? new Date(a.ondertekend_op).getTime()
        : 0;
      const tb = b.ondertekend_op
        ? new Date(b.ondertekend_op).getTime()
        : 0;
      return tb - ta;
    })[0];
  const pick = signed || rows[0];
  return pick ? Number(pick.subtotaal_ex_btw) || 0 : 0;
}

function buildUserData(lead: LeadCapiRow) {
  const { fn, ln } = splitNaam(lead.naam || "");
  const user_data: Record<string, unknown> = {
    country: [hashMetaUserField("country", "nl")].filter(Boolean),
  };

  const em = hashMetaUserField("email", lead.email);
  const ph = hashMetaUserField("phone", lead.telefoon);
  const fnH = hashMetaUserField("name", fn);
  const lnH = hashMetaUserField("name", ln);
  const ct = hashMetaUserField("city", lead.plaats);
  const zp = hashMetaUserField("zip", lead.postcode);

  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];
  if (fnH) user_data.fn = [fnH];
  if (lnH) user_data.ln = [lnH];
  if (ct) user_data.ct = [ct];
  if (zp) user_data.zp = [zp];

  if (lead.meta_fbc?.trim()) user_data.fbc = lead.meta_fbc.trim();
  if (lead.meta_fbp?.trim()) user_data.fbp = lead.meta_fbp.trim();
  if (lead.meta_client_ip?.trim()) {
    user_data.client_ip_address = lead.meta_client_ip.trim();
  }
  if (lead.meta_user_agent?.trim()) {
    user_data.client_user_agent = lead.meta_user_agent.trim();
  }

  return user_data;
}

async function postMetaEvents(
  events: Record<string, unknown>[]
): Promise<{ ok: boolean; error?: string }> {
  const pixel = pixelId();
  const token = accessToken();
  if (!pixel || !token) {
    return { ok: false, error: "META_PIXEL_ID / META_CAPI_ACCESS_TOKEN ontbreekt" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: events }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error:
          (body as { error?: { message?: string } })?.error?.message ||
          `HTTP ${res.status}`,
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

/**
 * Cumulatieve Meta CAPI sync voor een lead.
 * Vuurt alle events t/m het hoogste bereikte niveau die nog niet verstuurd zijn.
 */
export async function syncLeadMetaCapi(
  leadId: string,
  opts?: { forceStatus?: LeadStatus | string }
): Promise<MetaCapiSyncResult> {
  const pixel = pixelId();
  const token = accessToken();
  if (!pixel || !token) {
    return {
      ok: false,
      skipped: true,
      reason: "Meta CAPI niet geconfigureerd",
      sent: [],
      already: [],
    };
  }

  const sb = getSupabaseAdmin();
  const { data: lead, error } = await sb
    .from("leads")
    .select(
      "id, naam, email, telefoon, plaats, postcode, lander, status, capi_events_sent, meta_fbc, meta_fbp, meta_client_ip, meta_user_agent, meta_event_source_url"
    )
    .eq("id", leadId)
    .single();

  if (error || !lead) {
    // Kolommen misschien nog niet gemigreerd — probeer basisselect
    if (
      error?.code === "42703" ||
      error?.message?.includes("capi_events_sent") ||
      error?.message?.includes("meta_")
    ) {
      const retry = await sb
        .from("leads")
        .select("id, naam, email, telefoon, plaats, postcode, lander, status")
        .eq("id", leadId)
        .single();
      if (retry.error || !retry.data) {
        return {
          ok: false,
          reason: "Lead niet gevonden",
          sent: [],
          already: [],
        };
      }
      return {
        ok: false,
        skipped: true,
        reason: "Run supabase/migrate-meta-capi.sql",
        sent: [],
        already: [],
      };
    }
    return {
      ok: false,
      reason: error?.message || "Lead niet gevonden",
      sent: [],
      already: [],
    };
  }

  const row = lead as LeadCapiRow;
  const status = (opts?.forceStatus || row.status) as LeadStatus;
  const needed = metaCapiEventsForStatus(status);
  const already = new Set(
    (row.capi_events_sent || []).filter(Boolean) as MetaCapiEventName[]
  );
  const toSend = needed.filter((e) => !already.has(e));

  if (toSend.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason:
        needed.length === 0
          ? "Status stuurt geen CAPI-events"
          : "Alles al verstuurd",
      sent: [],
      already: [...already],
    };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const sourceUrl = eventSourceUrl(row);
  const user_data = buildUserData(row);
  let purchaseValue = 0;
  if (toSend.includes("Purchase")) {
    purchaseValue = await purchaseValueForLead(leadId);
  }

  const payload = toSend.map((event_name) => {
    const event: Record<string, unknown> = {
      event_name,
      event_time: eventTime,
      event_id: `${event_name.toLowerCase()}_${leadId}`,
      event_source_url: sourceUrl,
      action_source: "system_generated",
      user_data,
      custom_data: {
        currency: "EUR",
        ...(event_name === "Purchase"
          ? { value: purchaseValue }
          : {}),
        content_name: status,
        status,
      },
    };
    return event;
  });

  // QualifiedLead is custom → Meta accepteert custom names via event_name
  const result = await postMetaEvents(payload);
  if (!result.ok) {
    return {
      ok: false,
      reason: result.error,
      sent: [],
      already: [...already],
      errors: [result.error || "send failed"],
    };
  }

  const nextSent = [...new Set([...already, ...toSend])];
  const { error: updateErr } = await sb
    .from("leads")
    .update({ capi_events_sent: nextSent })
    .eq("id", leadId);

  if (updateErr) {
    console.error("capi_events_sent update:", updateErr.message);
  }

  return {
    ok: true,
    sent: toSend,
    already: [...already],
  };
}

/** Fire-and-forget vanaf server routes. */
export function queueLeadMetaCapi(leadId: string): void {
  void syncLeadMetaCapi(leadId).catch((e) =>
    console.error("meta-capi:", e)
  );
}
