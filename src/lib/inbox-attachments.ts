/**
 * Bijlagen van info@-mails in Supabase storage.
 */

import { getSupabaseAdmin } from "@/lib/supabase";

export const INBOX_ATTACHMENTS_BUCKET = "inbox-attachments";

export type InboxAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
  isImage?: boolean;
};

async function ensureBucket() {
  const sb = getSupabaseAdmin();
  const { data: buckets } = await sb.storage.listBuckets();
  if ((buckets || []).some((b) => b.name === INBOX_ATTACHMENTS_BUCKET)) return;
  await sb.storage.createBucket(INBOX_ATTACHMENTS_BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
  });
}

function safeFilename(name: string): string {
  const base = (name || "bijlage").replace(/[^\w.\- ()[\]]+/g, "_").trim();
  return base.slice(0, 120) || "bijlage";
}

/** Upload één bijlage; return meta of null bij falen. */
export async function uploadInboxAttachment(opts: {
  mailKey: string;
  filename: string;
  contentType?: string | null;
  bytes: Buffer;
}): Promise<InboxAttachmentMeta | null> {
  try {
    if (!opts.bytes?.length) return null;
    // Skip inline tiny images / huge files
    if (opts.bytes.length > 20 * 1024 * 1024) return null;
    await ensureBucket();
    const sb = getSupabaseAdmin();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = safeFilename(opts.filename);
    const path = `${opts.mailKey}/${id}-${filename}`;
    const contentType =
      (opts.contentType || "").trim() || "application/octet-stream";
    const { error } = await sb.storage
      .from(INBOX_ATTACHMENTS_BUCKET)
      .upload(path, opts.bytes, { contentType, upsert: true });
    if (error) {
      console.warn("uploadInboxAttachment:", error.message);
      return null;
    }
    const isImage =
      contentType.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(filename);
    return {
      id,
      filename,
      contentType,
      size: opts.bytes.length,
      storagePath: path,
      isImage,
    };
  } catch (e) {
    console.warn("uploadInboxAttachment:", e);
    return null;
  }
}

export async function downloadInboxAttachment(
  storagePath: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const path = (storagePath || "").trim();
  if (!path) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage
    .from(INBOX_ATTACHMENTS_BUCKET)
    .download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, contentType: data.type || "application/octet-stream" };
}
