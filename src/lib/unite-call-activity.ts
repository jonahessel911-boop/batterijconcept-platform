/**
 * Unite CDR / webhook → lead_events (soort bel) + gestempelde lead-notities.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { logLeadEvent } from "@/lib/lead-events";
import { upsertStampedNotitieChronological } from "@/lib/lead-notitie";
import { phoneMatchVariants, toE164Nl } from "@/lib/fonio";
import {
  findUniteExtension,
  findUniteRecordingForCall,
  formatDurationNl,
  listUniteCdrLogs,
  parseUniteCalltime,
  type UniteCdrLog,
  uniteConfigured,
} from "@/lib/unite";

export type UniteCallActivityInput = {
  uniqueid: string;
  callAt: Date;
  direction: "in" | "out" | string;
  durationSeconds: number;
  fromLabel: string | null;
  fromNumber: string | null;
  toLabel: string | null;
  toNumber: string | null;
  /** Extern nummer om aan lead te koppelen */
  matchPhone: string | null;
  /** DID van de beller (085…), als bekend */
  agentDid?: string | null;
  agentExtensionId?: string | null;
  callrecordkey?: string | null;
};

function digitsOnly(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

function isInternalExt(num: string | null | undefined): boolean {
  const d = digitsOnly(num);
  return d.length > 0 && d.length <= 5;
}

function formatNlDisplay(raw: string | null | undefined): string | null {
  const e164 = toE164Nl(raw);
  if (!e164) return raw?.trim() || null;
  const d = e164.replace(/\D/g, "");
  if (!d.startsWith("31") || d.length < 11) return e164;
  const national = `0${d.slice(2)}`;
  // 06xxxxxxxx → 06 xxxxxxxx · 085xxxxxxx → 085 xxx xxxx
  if (national.startsWith("06") && national.length === 10) {
    return `${national.slice(0, 2)} ${national.slice(2)}`;
  }
  if (national.length === 10) {
    return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  }
  return national;
}

export function cdrLogToActivity(log: UniteCdrLog): UniteCallActivityInput | null {
  const chain = log.call_chain || [];
  if (!log.uniqueid || !log.calltime) return null;

  const dir = (log.direction || "out").toLowerCase();
  const duration = Number(log.billsecond ?? log.duration ?? 0) || 0;

  let fromLabel: string | null = null;
  let fromNumber: string | null = null;
  let toLabel: string | null = null;
  let toNumber: string | null = null;
  let matchPhone: string | null = null;

  if (chain.length >= 2) {
    const a = chain[0];
    const b = chain[chain.length - 1];
    fromNumber = a.number || null;
    fromLabel = (a.desc || "").trim() || a.number_formatted || a.number || null;
    toNumber = b.number || null;
    toLabel = (b.desc || "").trim() || b.number_formatted || b.number || null;
  } else if (chain.length === 1) {
    toNumber = chain[0].number || null;
    toLabel = chain[0].desc || chain[0].number_formatted || toNumber;
  }

  for (const leg of chain) {
    const n = leg.number || "";
    if (!n || isInternalExt(n)) continue;
    const e164 = toE164Nl(n);
    if (e164) {
      matchPhone = e164;
      break;
    }
  }

  return {
    uniqueid: log.uniqueid,
    callAt: parseUniteCalltime(log.calltime),
    direction: dir,
    durationSeconds: duration,
    fromLabel,
    fromNumber,
    toLabel,
    toNumber,
    matchPhone,
  };
}

/** "Rik · 085 800 2409" — naam + nummer. */
function formatAgentLine(
  name: string | null | undefined,
  numberRaw: string | null | undefined,
  extFallback?: string | null
): string | null {
  const naam = (name || "").trim() || null;
  const num =
    formatNlDisplay(numberRaw) ||
    (extFallback && !isInternalExt(extFallback)
      ? formatNlDisplay(extFallback)
      : null) ||
    (extFallback && isInternalExt(extFallback) ? extFallback : null);
  if (naam && num && naam !== num) return `${naam} · ${num}`;
  return naam || num || null;
}

export function formatCallActivityText(act: UniteCallActivityInput): {
  titel: string;
  detail: string;
  notitie: string;
  author: string | null;
} {
  const dirLabel =
    act.direction === "in"
      ? "inkomend"
      : act.direction === "out"
        ? "uitgaand"
        : act.direction;
  const durLabel = formatDurationNl(act.durationSeconds);

  const agentName =
    act.direction === "out" ? act.fromLabel : act.toLabel;
  const agentNum =
    act.agentDid ||
    (act.direction === "out" ? act.fromNumber : act.toNumber);
  const agentExt =
    act.direction === "out" ? act.fromNumber : act.toNumber;
  const door = formatAgentLine(agentName, agentNum, agentExt);

  const naarRaw =
    act.direction === "out"
      ? act.toNumber || act.matchPhone
      : act.fromNumber || act.matchPhone;
  const naar = formatNlDisplay(naarRaw) || naarRaw || "onbekend";
  const van = formatNlDisplay(
    act.direction === "in" ? act.fromNumber : act.fromNumber
  );

  const unanswered = act.durationSeconds <= 0;
  const titel = unanswered
    ? `Niet opgenomen · ${dirLabel}`
    : `Gesprek · ${dirLabel} · ${durLabel}`;

  const detailParts = [
    door ? `Gebeld door: ${door}` : null,
    act.direction === "out"
      ? `Naar: ${naar}`
      : `Van: ${van || naar}`,
    unanswered ? "Niet opgenomen" : `Duur: ${durLabel} (${act.durationSeconds}s)`,
  ].filter(Boolean);

  const notitie = [
    titel,
    door ? `Gebeld door: ${door}` : null,
    act.direction === "out" ? `Naar: ${naar}` : `Van: ${van || naar}`,
    unanswered ? "Niet opgenomen" : `Duur: ${durLabel}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    titel,
    detail: detailParts.join("\n"),
    notitie,
    author: (agentName || "").trim() || door || null,
  };
}

/** Vul agent DID + eventuele opname bij (best-effort). */
export async function enrichUniteCallActivity(
  act: UniteCallActivityInput,
  opts?: { skipRecording?: boolean }
): Promise<UniteCallActivityInput> {
  const next = { ...act };
  const extRaw =
    act.direction === "out" ? act.fromNumber : act.toNumber;
  try {
    const ext = await findUniteExtension(extRaw);
    if (ext) {
      next.agentExtensionId = ext.id;
      next.agentDid = ext.callerid || next.agentDid || null;
      if (ext.name?.trim()) {
        if (act.direction === "out") next.fromLabel = ext.name.trim();
        else next.toLabel = ext.name.trim();
      }
    }
  } catch {
    /* ignore */
  }

  // Opname-lookup is traag (Unite rate-limit). Cron-sync slaat dit over;
  // reattachMissingRecordings haalt opnames later bij.
  if (
    !opts?.skipRecording &&
    next.durationSeconds > 0 &&
    next.agentExtensionId &&
    next.matchPhone &&
    !next.callrecordkey
  ) {
    try {
      const rec = await findUniteRecordingForCall({
        extensionId: next.agentExtensionId,
        externalPhone: next.matchPhone,
        callAt: next.callAt,
        durationSeconds: next.durationSeconds,
      });
      if (rec?.callrecordkey) next.callrecordkey = rec.callrecordkey;
    } catch {
      /* geen opname */
    }
  }
  return next;
}

async function leadIdForPhone(phone: string): Promise<string | null> {
  const e164 = toE164Nl(phone);
  if (!e164) return null;
  const variants = phoneMatchVariants(e164);
  if (variants.length === 0) return null;

  const sb = getSupabaseAdmin();
  const { data: leads } = await sb
    .from("leads")
    .select("id, telefoon, status, created_at")
    .or(variants.map((v) => `telefoon.eq.${v}`).join(","))
    .order("created_at", { ascending: false })
    .limit(12);

  const candidates = (leads || []).filter(
    (l) => toE164Nl(l.telefoon) === e164
  );
  const pool = candidates.length > 0 ? candidates : leads || [];
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!.id;

  // Meerdere leads op zelfde nr → prefer project → deal → overige
  const ids = pool.map((l) => l.id);
  const { data: projects } = await sb
    .from("projecten")
    .select("lead_id, created_at")
    .in("lead_id", ids)
    .order("created_at", { ascending: false });
  const withProject = new Set(
    (projects || []).map((p) => p.lead_id as string)
  );
  const preferred =
    pool.find((l) => withProject.has(l.id)) ||
    pool.find((l) => String((l as { status?: string }).status || "").toLowerCase() === "deal") ||
    pool.find(
      (l) =>
        !["gegevens_niet_overeen", "afgewezen", "spam"].includes(
          String((l as { status?: string }).status || "").toLowerCase()
        )
    ) ||
    pool[0]!;
  return preferred.id;
}

async function alreadyLogged(
  leadId: string,
  uniqueid: string
): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("lead_events")
    .select("id")
    .eq("lead_id", leadId)
    .eq("soort", "bel")
    .contains("meta", { uniqueid })
    .limit(1);
  return Boolean(data?.length);
}

/** Schrijf één Unite-gesprek naar lead_events + lead.notities (idempotent op uniqueid). */
export async function logUniteCallActivity(
  act: UniteCallActivityInput,
  opts?: { leadId?: string | null; skipRecording?: boolean }
): Promise<{ ok: boolean; leadId: string | null; skipped?: string }> {
  const leadId =
    opts?.leadId ||
    (act.matchPhone ? await leadIdForPhone(act.matchPhone) : null);
  if (!leadId) {
    return { ok: false, leadId: null, skipped: "geen_lead" };
  }
  if (await alreadyLogged(leadId, act.uniqueid)) {
    return { ok: true, leadId, skipped: "dubbel" };
  }

  const enriched = await enrichUniteCallActivity(act, {
    skipRecording: opts?.skipRecording,
  });
  const formatted = formatCallActivityText(enriched);

  let storagePath: string | null = null;
  if (enriched.callrecordkey) {
    try {
      const { persistUniteRecording } = await import(
        "@/lib/call-recording-storage"
      );
      storagePath = await persistUniteRecording({
        callrecordkey: enriched.callrecordkey,
        extensionId: enriched.agentExtensionId,
        leadId,
      });
    } catch {
      /* best-effort */
    }
  }

  await logLeadEvent({
    leadId,
    soort: "bel",
    titel: formatted.titel,
    detail: formatted.detail,
    createdAt: enriched.callAt.toISOString(),
    meta: {
      bron: "unite",
      uniqueid: enriched.uniqueid,
      direction: enriched.direction,
      duration_seconds: enriched.durationSeconds,
      from: enriched.fromNumber,
      from_label: enriched.fromLabel,
      to: enriched.toNumber,
      to_label: enriched.toLabel,
      match_phone: enriched.matchPhone,
      agent_did: enriched.agentDid || null,
      extension_id: enriched.agentExtensionId || null,
      callrecordkey: enriched.callrecordkey || null,
      recording_storage_path: storagePath,
      recording_complete: Boolean(storagePath),
      recording_unavailable: enriched.durationSeconds <= 0,
      answered: enriched.durationSeconds > 0,
    },
  });

  const sb = getSupabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("notities")
    .eq("id", leadId)
    .maybeSingle();

  const merged = upsertStampedNotitieChronological(
    lead?.notities,
    formatted.notitie,
    enriched.callAt,
    formatted.author,
    {
      // Uniek genoeg: titel + naar/van + duur (uniqueid zit in lead_events)
      dedupeKey: formatted.notitie.split("\n").slice(0, 3).join("\n"),
    }
  );
  await sb.from("leads").update({ notities: merged }).eq("id", leadId);

  return { ok: true, leadId };
}

/** Sync CDR-venster → lead activiteiten. */
export async function syncUniteCdrToLeads(opts: {
  dateStart: string;
  dateEnd: string;
  maxPages?: number;
  onlyPhones?: string[] | null;
  /**
   * true (default bij cron): geen Unite-opname-API per gesprek.
   * Voorkomt Vercel-timeout / rate-limit waardoor bel-events uitblijven.
   */
  skipRecording?: boolean;
  /** Alleen popups voor gesprekken jonger dan dit (ms). Default 45 min. */
  popupMaxAgeMs?: number;
}): Promise<{
  scanned: number;
  logged: number;
  skipped: number;
  unmatched: number;
}> {
  if (!uniteConfigured()) {
    throw new Error("Unite niet geconfigureerd");
  }

  const phoneSet = new Set(
    (opts.onlyPhones || [])
      .map((p) => toE164Nl(p)?.replace(/\D/g, ""))
      .filter(Boolean) as string[]
  );
  const skipRecording = opts.skipRecording !== false;
  const popupMaxAgeMs = opts.popupMaxAgeMs ?? 45 * 60_000;
  const nowMs = Date.now();

  let scanned = 0;
  let logged = 0;
  let skipped = 0;
  let unmatched = 0;

  const first = await listUniteCdrLogs({
    dateStart: opts.dateStart,
    dateEnd: opts.dateEnd,
    page: 1,
  });
  const maxPages = Math.min(
    first.pagecount,
    opts.maxPages ?? first.pagecount
  );

  for (let page = 1; page <= maxPages; page++) {
    const batch =
      page === 1
        ? first
        : await listUniteCdrLogs({
            dateStart: opts.dateStart,
            dateEnd: opts.dateEnd,
            page,
          });

    for (const log of batch.items) {
      scanned += 1;
      const act = cdrLogToActivity(log);
      if (!act?.matchPhone) {
        unmatched += 1;
        continue;
      }
      if (phoneSet.size > 0) {
        const dig = act.matchPhone.replace(/\D/g, "");
        if (!phoneSet.has(dig)) continue;
      }
      const res = await logUniteCallActivity(act, { skipRecording });
      if (res.skipped === "dubbel") skipped += 1;
      else if (res.skipped === "geen_lead") unmatched += 1;
      else if (res.ok) logged += 1;
      else unmatched += 1;

      // Nagesprek-popup alleen voor verse gesprekken (niet bij backfill)
      const ageMs = nowMs - act.callAt.getTime();
      if (
        res.skipped !== "dubbel" &&
        ageMs >= 0 &&
        ageMs <= popupMaxAgeMs
      ) {
        try {
          const { emitEndedPopupFromActivity } = await import(
            "@/lib/call-popups"
          );
          await emitEndedPopupFromActivity({
            uniqueid: act.uniqueid,
            callAt: act.callAt,
            direction: act.direction,
            durationSeconds: act.durationSeconds,
            fromNumber: act.fromNumber,
            toNumber: act.toNumber,
          });
        } catch {
          /* best-effort */
        }
      }
    }

    if (page < maxPages) {
      await new Promise((r) => setTimeout(r, 2100));
    }
  }

  // Tweede pass: opname-inhaal voor recente beantwoorde gesprekken
  try {
    await reattachMissingRecordings({ hours: 48, limit: 30 });
  } catch (e) {
    console.warn("reattachMissingRecordings:", e);
  }

  return { scanned, logged, skipped, unmatched };
}

/** Zoek + persist opnames voor bel-events die nog geen callrecordkey hebben. */
export async function reattachMissingRecordings(opts?: {
  hours?: number;
  limit?: number;
}): Promise<{ checked: number; attached: number }> {
  if (!uniteConfigured()) return { checked: 0, attached: 0 };
  const hours = opts?.hours ?? 48;
  const limit = opts?.limit ?? 40;
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const sb = getSupabaseAdmin();
  const { data: events, error } = await sb
    .from("lead_events")
    .select("id, lead_id, created_at, meta")
    .eq("soort", "bel")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  let checked = 0;
  let attached = 0;
  for (const ev of events || []) {
    const meta = (ev.meta || {}) as {
      callrecordkey?: string;
      recording_storage_path?: string;
      recording_unavailable?: boolean;
      direction?: string;
      from?: string;
      to?: string;
      match_phone?: string;
      duration_seconds?: number;
      extension_id?: string;
    };
    const duration = Number(meta.duration_seconds) || 0;
    if (duration <= 0) continue;
    if (meta.callrecordkey && meta.recording_storage_path) continue;
    // Premature unavailable-flags wél opnieuw proberen binnen retentie
    const ageMs = Date.now() - new Date(ev.created_at).getTime();
    if (meta.recording_unavailable && ageMs > 14 * 24 * 3600_000) continue;
    checked += 1;

    const dir = (meta.direction || "out").toLowerCase();
    const phone =
      meta.match_phone || (dir === "out" ? meta.to : meta.from) || null;
    if (!phone) continue;

    let extensionId = meta.extension_id || null;
    if (!extensionId) {
      const extRaw = dir === "out" ? meta.from : meta.to;
      try {
        const ext = await findUniteExtension(extRaw);
        extensionId = ext?.id || null;
      } catch {
        continue;
      }
    }
    if (!extensionId) continue;

    try {
      const rec = await findUniteRecordingForCall({
        extensionId,
        externalPhone: phone,
        callAt: new Date(ev.created_at),
        durationSeconds:
          meta.duration_seconds != null
            ? Number(meta.duration_seconds)
            : undefined,
      });
      if (!rec?.callrecordkey) continue;

      const { persistUniteRecording } = await import(
        "@/lib/call-recording-storage"
      );
      const path = await persistUniteRecording({
        callrecordkey: rec.callrecordkey,
        extensionId,
        leadId: ev.lead_id,
      });
      await sb
        .from("lead_events")
        .update({
          meta: {
            ...meta,
            callrecordkey: rec.callrecordkey,
            extension_id: extensionId,
            recording_storage_path: path,
            recording_complete: Boolean(path),
            recording_unavailable: false,
          },
        })
        .eq("id", ev.id);
      attached += 1;
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      /* skip */
    }
  }
  return { checked, attached };
}
