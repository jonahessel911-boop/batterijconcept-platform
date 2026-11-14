/**
 * Persist Unite call recordings in Supabase storage so they remain
 * beluisterbaar nadat Unite ze wist.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  downloadUniteCallRecordFull,
  listUniteCallRecords,
} from "@/lib/unite";

export const CALL_RECORDINGS_BUCKET = "call-recordings";

async function ensureBucket() {
  const sb = getSupabaseAdmin();
  const { data: buckets } = await sb.storage.listBuckets();
  if ((buckets || []).some((b) => b.name === CALL_RECORDINGS_BUCKET)) return;
  await sb.storage.createBucket(CALL_RECORDINGS_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
  });
}

async function resolveTotalParts(
  callrecordkey: string,
  extensionId?: string | null
): Promise<number | null> {
  if (!extensionId) return null;
  try {
    const { items } = await listUniteCallRecords({
      extensionId,
      pageLimit: 50,
      page: 1,
    });
    const hit = items.find((i) => i.callrecordkey === callrecordkey);
    const n = Number(hit?.file_totalpart || 0);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Upload reeds gedownloade bytes naar storage. */
export async function uploadCallRecording(opts: {
  callrecordkey: string;
  leadId?: string | null;
  bytes: ArrayBuffer;
  contentType?: string;
}): Promise<string | null> {
  try {
    await ensureBucket();
    const sb = getSupabaseAdmin();
    const folder = opts.leadId || "orphan";
    const path = `${folder}/${opts.callrecordkey}.mp3`;
    const buf = Buffer.from(opts.bytes);
    const { error } = await sb.storage
      .from(CALL_RECORDINGS_BUCKET)
      .upload(path, buf, {
        contentType:
          opts.contentType && opts.contentType.includes("audio")
            ? opts.contentType
            : "audio/mpeg",
        upsert: true,
      });
    if (error) {
      console.warn("uploadCallRecording:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("uploadCallRecording:", e);
    return null;
  }
}

/** Download van Unite (alle parts) → storage. Return storage path of null. */
export async function persistUniteRecording(opts: {
  callrecordkey: string;
  extensionId?: string | null;
  leadId?: string | null;
}): Promise<string | null> {
  try {
    const totalParts = await resolveTotalParts(
      opts.callrecordkey,
      opts.extensionId
    );
    const { bytes, contentType } = await downloadUniteCallRecordFull({
      callrecordkey: opts.callrecordkey,
      extensionId: opts.extensionId,
      totalParts,
    });
    return uploadCallRecording({
      callrecordkey: opts.callrecordkey,
      leadId: opts.leadId,
      bytes,
      contentType,
    });
  } catch (e) {
    console.warn("persistUniteRecording:", e);
    return null;
  }
}

export async function signedCallRecordingUrl(
  storagePath: string,
  expiresSec = 3600
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage
    .from(CALL_RECORDINGS_BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function downloadStoredCallRecording(
  storagePath: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage
    .from(CALL_RECORDINGS_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  return {
    bytes: await data.arrayBuffer(),
    contentType: data.type || "audio/mpeg",
  };
}
