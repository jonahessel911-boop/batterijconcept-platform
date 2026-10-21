import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAudioFilename } from "@/lib/voice-ai";

export const VOICE_NOTES_BUCKET = "voice-notes";
const BUCKET = VOICE_NOTES_BUCKET;
/** Geen harde limiet meer — transcriptie kan bij extreem grote files falen. */
export const VOICE_MAX_BYTES = Number.POSITIVE_INFINITY;

const ALLOWED_PREFIXES = ["audio/", "video/mp4", "video/webm"];

function isAllowedAudio(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (ALLOWED_PREFIXES.some((p) => t.startsWith(p) || t === p)) return true;
  return /\.(mp3|m4a|wav|webm|ogg|flac|mp4|mpeg|mpga)$/i.test(file.name || "");
}

export async function uploadVoiceNoteAudio(
  sb: SupabaseClient,
  afspraakId: string,
  file: File
): Promise<
  | { storage_path: string; bestandsnaam: string; content_type: string }
  | { error: string; status: number; detail?: string }
> {
  if (!isAllowedAudio(file)) {
    return {
      error: "Alleen audio-bestanden (mp3, m4a, wav, webm, …)",
      status: 400,
    };
  }
  if (file.size === 0) {
    return { error: "Leeg bestand", status: 400 };
  }

  const bestandsnaam = normalizeAudioFilename(file.name, file.type || "");
  const ext =
    bestandsnaam.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "webm";
  const storage_path = `${afspraakId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const content_type = file.type || "audio/webm";

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storage_path, buffer, {
      contentType: content_type,
      upsert: false,
    });

  if (uploadErr) {
    return {
      error: "Upload mislukt",
      status: 500,
      detail: uploadErr.message,
    };
  }

  return { storage_path, bestandsnaam, content_type };
}

export async function signedVoiceNoteUrl(
  sb: SupabaseClient,
  storagePath: string,
  expiresSec = 60 * 60 * 6
): Promise<string | null> {
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export function buildVoiceStoragePath(
  afspraakId: string,
  bestandsnaam: string
): string {
  const ext =
    bestandsnaam.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "webm";
  return `${afspraakId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
}

export function validateVoiceMeta(opts: {
  bestandsnaam: string;
  content_type: string;
  size: number;
}): { ok: true; bestandsnaam: string } | { ok: false; error: string; status: number } {
  const fake = {
    name: opts.bestandsnaam,
    type: opts.content_type,
  } as File;
  if (!isAllowedAudio(fake)) {
    return {
      ok: false,
      error: "Alleen audio-bestanden (mp3, m4a, wav, webm, …)",
      status: 400,
    };
  }
  if (!opts.size || opts.size <= 0) {
    return { ok: false, error: "Leeg bestand", status: 400 };
  }
  return {
    ok: true,
    bestandsnaam: normalizeAudioFilename(opts.bestandsnaam, opts.content_type),
  };
}

/** Signed upload URL — browser uploadt direct naar Storage (geen FormData via Next). */
export async function createVoiceSignedUpload(
  sb: SupabaseClient,
  afspraakId: string,
  bestandsnaam: string,
  contentType: string
): Promise<
  | {
      storage_path: string;
      bestandsnaam: string;
      content_type: string;
      signedUrl: string;
      token: string;
    }
  | { error: string; status: number; detail?: string }
> {
  const name = normalizeAudioFilename(bestandsnaam, contentType);
  const storage_path = buildVoiceStoragePath(afspraakId, name);
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(storage_path);

  if (error || !data?.signedUrl || !data.token) {
    return {
      error: "Upload-URL maken mislukt",
      status: 500,
      detail: error?.message,
    };
  }

  return {
    storage_path,
    bestandsnaam: name,
    content_type: contentType || "audio/webm",
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

export async function downloadVoiceNoteBuffer(
  sb: SupabaseClient,
  storagePath: string
): Promise<Buffer | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
