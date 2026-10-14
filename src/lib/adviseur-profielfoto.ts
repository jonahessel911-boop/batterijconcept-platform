/**
 * Adviseur-profielfoto in public storage-bucket adviseur-fotos.
 */

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ADVISEUR_FOTO_BUCKET = "adviseur-fotos";
const MAX_BYTES = 5 * 1024 * 1024;

export function publicProfielfotoUrl(
  sb: SupabaseClient,
  path: string | null | undefined
): string | null {
  const p = path?.trim();
  if (!p) return null;
  const { data } = sb.storage.from(ADVISEUR_FOTO_BUCKET).getPublicUrl(p);
  return data?.publicUrl || null;
}

export async function uploadAdviseurProfielfoto(
  sb: SupabaseClient,
  adviseurId: string,
  file: File
): Promise<
  | { path: string; url: string }
  | { error: string; status: number; detail?: string }
> {
  if (!file.type.startsWith("image/")) {
    return { error: "Alleen afbeeldingen zijn toegestaan", status: 400 };
  }
  if (file.size > MAX_BYTES) {
    return { error: "Foto mag max. 5 MB zijn", status: 400 };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "jpg";
  const storage_path = `${adviseurId}/avatar-${Date.now()}-${randomBytes(3).toString("hex")}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { data: existing } = await sb
    .from("adviseurs")
    .select("profielfoto_path")
    .eq("id", adviseurId)
    .maybeSingle();
  const oldPath =
    typeof existing?.profielfoto_path === "string"
      ? existing.profielfoto_path
      : null;

  const { error: uploadErr } = await sb.storage
    .from(ADVISEUR_FOTO_BUCKET)
    .upload(storage_path, buffer, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (uploadErr) {
    return {
      error: "Upload mislukt",
      status: 500,
      detail: uploadErr.message,
    };
  }

  const { error: updateErr } = await sb
    .from("adviseurs")
    .update({ profielfoto_path: storage_path })
    .eq("id", adviseurId);

  if (updateErr) {
    await sb.storage.from(ADVISEUR_FOTO_BUCKET).remove([storage_path]);
    if (
      updateErr.message?.includes("profielfoto_path") ||
      updateErr.code === "42703"
    ) {
      return {
        error:
          "Kolom profielfoto_path ontbreekt — voer migrate-adviseur-profielfoto.sql uit",
        status: 500,
      };
    }
    return { error: updateErr.message || "Opslaan mislukt", status: 500 };
  }

  if (oldPath && oldPath !== storage_path) {
    await sb.storage.from(ADVISEUR_FOTO_BUCKET).remove([oldPath]).catch(() => {});
  }

  const url = publicProfielfotoUrl(sb, storage_path);
  return { path: storage_path, url: url || "" };
}

export async function clearAdviseurProfielfoto(
  sb: SupabaseClient,
  adviseurId: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const { data, error } = await sb
    .from("adviseurs")
    .select("profielfoto_path")
    .eq("id", adviseurId)
    .maybeSingle();

  if (error) {
    if (
      error.message?.includes("profielfoto_path") ||
      error.code === "42703"
    ) {
      return {
        error:
          "Kolom profielfoto_path ontbreekt — voer migrate-adviseur-profielfoto.sql uit",
        status: 500,
      };
    }
    return { error: error.message, status: 500 };
  }

  const path =
    typeof data?.profielfoto_path === "string" ? data.profielfoto_path : null;

  const { error: updateErr } = await sb
    .from("adviseurs")
    .update({ profielfoto_path: null })
    .eq("id", adviseurId);

  if (updateErr) {
    return { error: updateErr.message || "Verwijderen mislukt", status: 500 };
  }

  if (path) {
    await sb.storage.from(ADVISEUR_FOTO_BUCKET).remove([path]).catch(() => {});
  }

  return { ok: true };
}
