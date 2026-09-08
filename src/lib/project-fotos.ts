import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export { SCHOUW_FORMULIER_OMSCHRIJVING, isSchouwFormulier } from "@/lib/project-documenten";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;

function isAllowedFile(file: File, allowPdf: boolean): boolean {
  if (file.type.startsWith("image/")) return true;
  if (allowPdf && (file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
    return true;
  }
  return false;
}

export async function uploadProjectFotoFile(
  sb: SupabaseClient,
  projectId: string,
  file: File,
  omschrijving?: string | null,
  opts?: { allowPdf?: boolean }
): Promise<{
  foto: {
    id: string;
    project_id: string;
    storage_path: string;
    bestandsnaam: string | null;
    omschrijving: string | null;
    created_at: string;
    url: string | null;
  };
} | { error: string; status: number; detail?: string }> {
  const allowPdf = Boolean(opts?.allowPdf);
  if (!isAllowedFile(file, allowPdf)) {
    return {
      error: allowPdf
        ? "Alleen afbeeldingen of PDF zijn toegestaan"
        : "Alleen afbeeldingen zijn toegestaan",
      status: 400,
    };
  }

  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const maxBytes = isPdf ? MAX_DOC_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return {
      error: `Bestand mag max. ${Math.round(maxBytes / (1024 * 1024))} MB zijn`,
      status: 400,
    };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (isPdf ? "pdf" : "jpg");
  const storage_path = `${projectId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType =
    file.type || (isPdf ? "application/pdf" : "application/octet-stream");

  const { error: uploadErr } = await sb.storage
    .from("project-fotos")
    .upload(storage_path, buffer, {
      contentType,
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
    .from("project_fotos")
    .insert({
      project_id: projectId,
      storage_path,
      bestandsnaam: file.name,
      omschrijving: omschrijving?.trim() || null,
    })
    .select(
      "id, project_id, storage_path, bestandsnaam, omschrijving, created_at"
    )
    .single();

  if (insertErr || !row) {
    return {
      error: insertErr?.message || "Opslaan mislukt",
      status: 500,
    };
  }

  const { data: signed } = await sb.storage
    .from("project-fotos")
    .createSignedUrl(storage_path, 60 * 60 * 6);

  return { foto: { ...row, url: signed?.signedUrl || null } };
}
