import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_BYTES = 12 * 1024 * 1024;

export async function uploadSollicitatieBestand(
  sb: SupabaseClient,
  sollicitatieId: string,
  file: File
): Promise<
  | {
      bestand: {
        id: string;
        sollicitatie_id: string;
        storage_path: string;
        bestandsnaam: string | null;
        mime_type: string | null;
        grootte_bytes: number | null;
        created_at: string;
        url: string | null;
      };
    }
  | { error: string; status: number; detail?: string }
> {
  if (file.size > MAX_BYTES) {
    return { error: "Bestand mag max. 12 MB zijn", status: 400 };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "bin";
  const storagePath = `${sollicitatieId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await sb.storage
    .from("sollicitaties")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
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
      bestandsnaam: file.name,
      mime_type: file.type || null,
      grootte_bytes: file.size,
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
    .from("sollicitaties")
    .createSignedUrl(storagePath, 60 * 60 * 6);

  return { bestand: { ...row, url: signed?.signedUrl || null } };
}
