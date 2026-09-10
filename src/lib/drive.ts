import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveBestand } from "@/lib/drive-types";

export type { DriveBestand, DriveMap } from "@/lib/drive-types";
export { formatBytes } from "@/lib/drive-types";

export const DRIVE_BUCKET = "drive";
export const DRIVE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

type UploadOk = { bestand: DriveBestand };
type UploadErr = { error: string; status: number; detail?: string };

function safeExt(name: string): string {
  return (
    name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf"
  );
}

function isPdf(mime: string | null | undefined, filename: string): boolean {
  if (mime === "application/pdf") return true;
  return filename.toLowerCase().endsWith(".pdf");
}

export async function uploadDrivePdf(
  sb: SupabaseClient,
  opts: {
    mapId: string;
    displayName: string;
    file: File;
    uploadedBy?: string | null;
  }
): Promise<UploadOk | UploadErr> {
  if (!opts.mapId) {
    return { error: "Kies eerst een map om in te uploaden", status: 400 };
  }
  const original = opts.file.name?.trim() || "document.pdf";
  if (!isPdf(opts.file.type, original)) {
    return { error: "Alleen PDF-bestanden zijn toegestaan", status: 400 };
  }
  if (opts.file.size > DRIVE_MAX_BYTES) {
    return { error: "PDF mag max. 20 MB zijn", status: 400 };
  }
  if (opts.file.size <= 0) {
    return { error: "Bestand is leeg", status: 400 };
  }

  const display =
    opts.displayName.trim().replace(/\.pdf$/i, "") ||
    original.replace(/\.pdf$/i, "") ||
    "Document";
  const storagePath = `${opts.mapId}/${Date.now()}-${randomBytes(4).toString("hex")}.${safeExt(original)}`;
  const buffer = Buffer.from(await opts.file.arrayBuffer());

  const { error: uploadErr } = await sb.storage
    .from(DRIVE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
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
    .from("drive_bestanden")
    .insert({
      map_id: opts.mapId,
      naam: display,
      storage_path: storagePath,
      bestandsnaam: original,
      mime_type: "application/pdf",
      grootte_bytes: opts.file.size,
      uploaded_by: opts.uploadedBy || null,
    })
    .select(
      "id, map_id, naam, storage_path, bestandsnaam, mime_type, grootte_bytes, uploaded_by, created_at, updated_at"
    )
    .single();

  if (insertErr || !row) {
    await sb.storage.from(DRIVE_BUCKET).remove([storagePath]);
    return {
      error: insertErr?.message || "Opslaan mislukt",
      status: 500,
    };
  }

  const { data: signed } = await sb.storage
    .from(DRIVE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 6);

  return { bestand: { ...row, url: signed?.signedUrl || null } };
}

export async function signDriveUrls(
  sb: SupabaseClient,
  bestanden: DriveBestand[]
): Promise<DriveBestand[]> {
  if (bestanden.length === 0) return [];
  const paths = bestanden.map((b) => b.storage_path);
  const { data } = await sb.storage
    .from(DRIVE_BUCKET)
    .createSignedUrls(paths, 60 * 60 * 6);
  const byPath = new Map(
    (data || []).map((d) => [d.path, d.signedUrl || null])
  );
  return bestanden.map((b) => ({
    ...b,
    url: byPath.get(b.storage_path) ?? null,
  }));
}

export async function deleteDriveBestand(
  sb: SupabaseClient,
  bestand: Pick<DriveBestand, "id" | "storage_path">
): Promise<{ error?: string }> {
  await sb.storage.from(DRIVE_BUCKET).remove([bestand.storage_path]);
  const { error } = await sb
    .from("drive_bestanden")
    .delete()
    .eq("id", bestand.id);
  if (error) return { error: error.message };
  return {};
}
