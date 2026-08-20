import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_BYTES = 12 * 1024 * 1024;
const BUCKET = "sollicitaties";

export type SollicitatieBestandRow = {
  id: string;
  sollicitatie_id: string;
  storage_path: string;
  bestandsnaam: string | null;
  mime_type: string | null;
  grootte_bytes: number | null;
  created_at: string;
  url: string | null;
};

type UploadOk = { bestand: SollicitatieBestandRow };
type UploadErr = { error: string; status: number; detail?: string };

function safeExt(name: string): string {
  return (
    name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin"
  );
}

export async function uploadSollicitatieBytes(
  sb: SupabaseClient,
  sollicitatieId: string,
  input: {
    bytes: Buffer | Uint8Array;
    bestandsnaam: string;
    mimeType?: string | null;
  }
): Promise<UploadOk | UploadErr> {
  const size = input.bytes.byteLength;
  if (size > MAX_BYTES) {
    return { error: "Bestand mag max. 12 MB zijn", status: 400 };
  }
  if (size <= 0) {
    return { error: "Bestand is leeg", status: 400 };
  }

  const name = input.bestandsnaam.trim() || "bestand";
  const storagePath = `${sollicitatieId}/${Date.now()}-${randomBytes(4).toString("hex")}.${safeExt(name)}`;
  const buffer = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes);

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) {
    return {
      error: "Upload mislukt",
      status: 500,
      detail: uploadErr.message,
    };
  }

  const { data: row, error: insertErr } = await sb
    .from("sollicitatie_bestanden")
    .insert({
      sollicitatie_id: sollicitatieId,
      storage_path: storagePath,
      bestandsnaam: name,
      mime_type: input.mimeType || null,
      grootte_bytes: size,
    })
    .select(
      "id, sollicitatie_id, storage_path, bestandsnaam, mime_type, grootte_bytes, created_at"
    )
    .single();

  if (insertErr || !row) {
    return {
      error: insertErr?.message || "Opslaan mislukt",
      status: 500,
    };
  }

  const { data: signed } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 6);

  return { bestand: { ...row, url: signed?.signedUrl || null } };
}

export async function uploadSollicitatieBestand(
  sb: SupabaseClient,
  sollicitatieId: string,
  file: File
): Promise<UploadOk | UploadErr> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadSollicitatieBytes(sb, sollicitatieId, {
    bytes: buffer,
    bestandsnaam: file.name || "bestand",
    mimeType: file.type || null,
  });
}

/** Alle File-objecten uit multipart FormData (ongeacht veldnaam). */
export function collectFormFiles(form: FormData): File[] {
  const files: File[] = [];
  const seen = new Set<string>();
  for (const value of form.values()) {
    if (!(value instanceof File) || value.size <= 0) continue;
    const key = `${value.name}:${value.size}:${value.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(value);
  }
  return files;
}

function pickStr(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function decodeBase64Payload(raw: string): Buffer | null {
  const trimmed = raw.trim();
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  const b64 = dataUrl ? dataUrl[2] : trimmed.replace(/\s+/g, "");
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Extra bestanden uit JSON-body: URL of base64 (veelvoorkomende form-builders).
 */
export async function filesFromJsonPayload(
  body: Record<string, unknown>
): Promise<File[]> {
  const out: File[] = [];

  const url = pickStr(
    body.file_url,
    body.cv_url,
    body.resume_url,
    body.attachment_url,
    body.bestand_url,
    body.upload_url
  );
  if (url && /^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const name =
          pickStr(body.file_name, body.filename, body.bestandsnaam) ||
          decodeURIComponent(url.split("?")[0].split("/").pop() || "bestand");
        out.push(
          new File([blob], name, {
            type: blob.type || "application/octet-stream",
          })
        );
      }
    } catch {
      /* ignore download errors — sollicitatie blijft bestaan */
    }
  }

  const b64 = pickStr(
    body.file_base64,
    body.cv_base64,
    body.resume_base64,
    body.file_data,
    body.attachment_base64
  );
  if (b64) {
    const bytes = decodeBase64Payload(b64);
    if (bytes) {
      const mime =
        /^data:([^;]+);base64,/i.exec(b64.trim())?.[1] ||
        pickStr(body.file_mime, body.mime_type) ||
        "application/octet-stream";
      const name =
        pickStr(body.file_name, body.filename, body.bestandsnaam) || "bestand";
      out.push(new File([bytes], name, { type: mime }));
    }
  }

  // Objectvorm: { name, content/base64/data/url }
  for (const key of ["file", "cv", "resume", "attachment", "bestand", "upload"]) {
    const value = body[key];
    if (!value || typeof value !== "object" || value instanceof File) continue;
    const obj = value as Record<string, unknown>;
    const objUrl = pickStr(obj.url, obj.href, obj.src);
    const objB64 = pickStr(obj.content, obj.base64, obj.data, obj.file_base64);
    const objName =
      pickStr(obj.name, obj.filename, obj.bestandsnaam) || `${key}.bin`;
    const objMime = pickStr(obj.type, obj.mime, obj.mime_type);

    if (objUrl && /^https?:\/\//i.test(objUrl)) {
      try {
        const res = await fetch(objUrl);
        if (res.ok) {
          const blob = await res.blob();
          out.push(
            new File([blob], objName, {
              type: objMime || blob.type || "application/octet-stream",
            })
          );
        }
      } catch {
        /* ignore */
      }
    } else if (objB64) {
      const bytes = decodeBase64Payload(objB64);
      if (bytes) {
        out.push(
          new File([bytes], objName, {
            type: objMime || "application/octet-stream",
          })
        );
      }
    }
  }

  return out.filter((f) => f.size > 0);
}
