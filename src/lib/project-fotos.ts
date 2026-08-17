import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_BYTES = 8 * 1024 * 1024;

export async function uploadProjectFotoFile(
  sb: SupabaseClient,
  projectId: string,
  file: File,
  omschrijving?: string | null
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
  if (!file.type.startsWith("image/")) {
    return { error: "Alleen afbeeldingen zijn toegestaan", status: 400 };
  }
  if (file.size > MAX_BYTES) {
    return { error: "Bestand mag max. 8 MB zijn", status: 400 };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "jpg";
  const storage_path = `${projectId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await sb.storage
    .from("project-fotos")
    .upload(storage_path, buffer, {
      contentType: file.type,
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
