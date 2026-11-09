/**
 * GET /api/unite/recording?key=…&extensionid=…
 * GET /api/unite/recording?eventId=…
 * Stream callrecording: eerst uit Supabase storage, anders Unite live.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  downloadStoredCallRecording,
  persistUniteRecording,
  uploadCallRecording,
} from "@/lib/call-recording-storage";
import {
  downloadUniteCallRecordFull,
  findUniteExtension,
  findUniteRecordingForCall,
  listUniteCallRecords,
  listUniteExtensions,
  UNITE_RECORDING_PART_SIZE,
  uniteConfigured,
} from "@/lib/unite";

export const runtime = "nodejs";
export const maxDuration = 60;

type ResolvedRecording = {
  key: string | null;
  extensionId: string | null;
  storagePath: string | null;
  leadId: string | null;
  recordingComplete: boolean;
};

async function resolveFromEvent(
  eventId: string
): Promise<ResolvedRecording | null> {
  const sb = getSupabaseAdmin();
  const { data: ev, error } = await sb
    .from("lead_events")
    .select("id, lead_id, created_at, meta")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !ev) return null;

  const meta = (ev.meta || {}) as {
    callrecordkey?: string;
    extension_id?: string;
    recording_storage_path?: string;
    recording_complete?: boolean;
    recording_unavailable?: boolean;
    from?: string;
    to?: string;
    match_phone?: string;
    direction?: string;
    duration_seconds?: number;
  };

  const base = {
    leadId: ev.lead_id as string | null,
    recordingComplete: meta.recording_complete === true,
  };

  const durationSec = Number(meta.duration_seconds) || 0;
  const ageMs = Date.now() - new Date(ev.created_at).getTime();
  const pastRetention = ageMs > 14 * 24 * 3600_000;
  // Te vroeg gemarkeerd als unavailable → opnieuw proberen binnen retentie
  if (meta.recording_unavailable && (durationSec <= 0 || pastRetention)) {
    return {
      ...base,
      key: null,
      extensionId: null,
      storagePath: null,
    };
  }

  if (meta.recording_storage_path?.trim()) {
    return {
      ...base,
      key: meta.callrecordkey?.trim() || null,
      extensionId: meta.extension_id?.trim() || null,
      storagePath: meta.recording_storage_path.trim(),
    };
  }

  if (meta.callrecordkey?.trim()) {
    return {
      ...base,
      key: meta.callrecordkey.trim(),
      extensionId: meta.extension_id?.trim() || null,
      storagePath: null,
    };
  }

  if (!uniteConfigured()) {
    return {
      ...base,
      key: null,
      extensionId: null,
      storagePath: null,
    };
  }

  const dir = (meta.direction || "out").toLowerCase();
  const extRaw = dir === "out" ? meta.from : meta.to;
  const phone = meta.match_phone || (dir === "out" ? meta.to : meta.from);
  if (!phone) {
    return { ...base, key: null, extensionId: null, storagePath: null };
  }

  let extensionId = meta.extension_id?.trim() || null;
  if (!extensionId && extRaw) {
    const ext = await findUniteExtension(extRaw);
    extensionId = ext?.id || null;
  }
  const tryIds: string[] = [];
  if (extensionId) tryIds.push(extensionId);
  for (const hint of ["0200", "0201", "0202", "0203"]) {
    const e = await findUniteExtension(hint);
    if (e?.id && !tryIds.includes(e.id)) tryIds.push(e.id);
  }
  // DID/agent niet gevonden → alle extensies proberen (max 8, rate-limit)
  if (tryIds.length <= 1) {
    try {
      const all = await listUniteExtensions();
      for (const e of all) {
        if (e?.id && !tryIds.includes(e.id)) tryIds.push(e.id);
        if (tryIds.length >= 8) break;
      }
    } catch {
      /* ignore */
    }
  }

  for (const eid of tryIds) {
    const rec = await findUniteRecordingForCall({
      extensionId: eid,
      externalPhone: phone,
      callAt: new Date(ev.created_at),
      durationSeconds:
        meta.duration_seconds != null
          ? Number(meta.duration_seconds)
          : undefined,
    });
    if (rec?.callrecordkey) {
      const storagePath = await persistUniteRecording({
        callrecordkey: rec.callrecordkey,
        extensionId: eid,
        leadId: ev.lead_id,
      });
      await sb
        .from("lead_events")
        .update({
          meta: {
            ...meta,
            callrecordkey: rec.callrecordkey,
            extension_id: eid,
            recording_storage_path: storagePath,
            recording_complete: Boolean(storagePath),
            recording_unavailable: false,
          },
        })
        .eq("id", eventId);
      return {
        ...base,
        key: rec.callrecordkey,
        extensionId: eid,
        storagePath,
        recordingComplete: Boolean(storagePath),
      };
    }
  }

  // Pas na Unite-retentie (~14d) permanent markeren — niet na 2 uur
  if (pastRetention || durationSec <= 0) {
    await sb
      .from("lead_events")
      .update({
        meta: {
          ...meta,
          recording_unavailable: true,
        },
      })
      .eq("id", eventId);
  } else if (meta.recording_unavailable) {
    // Wis premature flag zodat volgende poging opnieuw mag
    await sb
      .from("lead_events")
      .update({
        meta: {
          ...meta,
          recording_unavailable: false,
        },
      })
      .eq("id", eventId);
  }

  return { ...base, key: null, extensionId: null, storagePath: null };
}

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let key = req.nextUrl.searchParams.get("key")?.trim() || null;
    let extensionId =
      req.nextUrl.searchParams.get("extensionid")?.trim() || null;
    let storagePath: string | null = null;
    let leadId: string | null = null;
    let recordingComplete = false;
    const eventId = req.nextUrl.searchParams.get("eventId")?.trim() || null;
    const part = Number(req.nextUrl.searchParams.get("part") || 1) || 1;

    if (eventId) {
      const resolved = await resolveFromEvent(eventId);
      if (!resolved) {
        return NextResponse.json(
          { error: "Gesprek niet gevonden" },
          { status: 404 }
        );
      }
      key = resolved.key || key;
      extensionId = resolved.extensionId || extensionId;
      storagePath = resolved.storagePath;
      leadId = resolved.leadId;
      recordingComplete = resolved.recordingComplete;
    }

    // Ook bij alleen ?key= : zoek of we 'm al in storage hebben
    if (!storagePath && key) {
      const sb = getSupabaseAdmin();
      const { data: hit } = await sb
        .from("lead_events")
        .select("meta, lead_id")
        .eq("soort", "bel")
        .contains("meta", { callrecordkey: key })
        .limit(1)
        .maybeSingle();
      const meta = (hit?.meta || {}) as { recording_storage_path?: string };
      if (meta.recording_storage_path?.trim()) {
        storagePath = meta.recording_storage_path.trim();
        leadId = hit?.lead_id || leadId;
      } else if (hit?.lead_id) {
        // Verwacht pad uit eerdere persist
        storagePath = `${hit.lead_id}/${key}.mp3`;
        leadId = hit.lead_id;
      }
    }

    // 1) Uit eigen storage — tenzij precies 1 MiB zonder complete-flag (oude truncated uploads)
    if (storagePath) {
      const stored = await downloadStoredCallRecording(storagePath);
      const incomplete =
        !recordingComplete &&
        stored != null &&
        stored.bytes.byteLength === UNITE_RECORDING_PART_SIZE &&
        Boolean(key) &&
        uniteConfigured();
      if (stored && stored.bytes.byteLength > 0 && !incomplete) {
        return new NextResponse(stored.bytes, {
          status: 200,
          headers: {
            "Content-Type": stored.contentType.includes("audio")
              ? stored.contentType
              : "audio/mpeg",
            "Content-Length": String(stored.bytes.byteLength),
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
      // incomplete of leeg → live Unite hieronder
      if (!incomplete) storagePath = null;
    }

    // 2) Live uit Unite
    if (!key) {
      return NextResponse.json(
        {
          error:
            "Geen opname beschikbaar voor dit gesprek (niet opgenomen of verlopen in Unite)",
        },
        { status: 404 }
      );
    }

    if (!uniteConfigured()) {
      return NextResponse.json(
        { error: "Unite niet geconfigureerd (UNITE_LOGIN_TOKEN)" },
        { status: 503 }
      );
    }

    let totalParts: number | null = null;
    if (extensionId) {
      try {
        const { items } = await listUniteCallRecords({
          extensionId,
          pageLimit: 50,
          page: 1,
        });
        const hit = items.find((i) => i.callrecordkey === key);
        const n = Number(hit?.file_totalpart || 0);
        if (n > 0) totalParts = n;
      } catch {
        /* ignore */
      }
    }

    const { bytes, contentType } = await downloadUniteCallRecordFull({
      callrecordkey: key,
      extensionId,
      totalParts: part > 1 ? part : totalParts,
    });

    // Cache volledige file (zelfde bytes, geen tweede Unite-download)
    const path = await uploadCallRecording({
      callrecordkey: key,
      leadId,
      bytes,
      contentType,
    });
    if (path && eventId) {
      const sb = getSupabaseAdmin();
      const { data: ev } = await sb
        .from("lead_events")
        .select("meta")
        .eq("id", eventId)
        .maybeSingle();
      if (ev) {
        await sb
          .from("lead_events")
          .update({
            meta: {
              ...((ev.meta as object) || {}),
              recording_storage_path: path,
              callrecordkey: key,
              extension_id: extensionId,
              recording_complete: true,
              recording_bytes: bytes.byteLength,
              file_totalpart: totalParts,
            },
          })
          .eq("id", eventId);
      }
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType.includes("audio")
          ? contentType
          : "audio/mpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="gesprek-${key.slice(0, 8)}.mp3"`,
      },
    });
  } catch (e) {
    const raw = errMessage(e, "Opname downloaden mislukt");
    const friendly = /user verified|401|403|auth|token/i.test(raw)
      ? "Geen opname (niet beschikbaar of verlopen in Unite)"
      : raw;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
