import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RELATIE_CONTRACT_BUCKET = "relatie-contracten";

export type RelatieKind = "adviseur" | "partner";

function tableFor(kind: RelatieKind): string {
  return kind === "adviseur" ? "adviseurs" : "installatie_partners";
}

export async function ensureRelatieContractBucket(sb: SupabaseClient) {
  try {
    const { data } = await sb.storage.getBucket(RELATIE_CONTRACT_BUCKET);
    if (data) return;
    await sb.storage.createBucket(RELATIE_CONTRACT_BUCKET, {
      public: false,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
      ],
    });
  } catch {
    /* bucket kan al bestaan of via dashboard */
  }
}

export async function uploadRelatieContract(
  sb: SupabaseClient,
  kind: RelatieKind,
  id: string,
  file: File
): Promise<
  | {
      contract_storage_path: string;
      contract_bestandsnaam: string;
      contract_uploaded_at: string;
      url: string | null;
    }
  | { error: string; status: number }
> {
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) {
    return { error: "Alleen PDF of afbeelding toegestaan", status: 400 };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: "Bestand mag max. 20 MB zijn", status: 400 };
  }

  await ensureRelatieContractBucket(sb);

  const table = tableFor(kind);
  const { data: existing } = await sb
    .from(table)
    .select("id, contract_storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return { error: "Relatie niet gevonden", status: 404 };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (isPdf ? "pdf" : "jpg");
  const storage_path = `${kind}/${id}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await sb.storage
    .from(RELATIE_CONTRACT_BUCKET)
    .upload(storage_path, buffer, {
      contentType: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
      upsert: false,
    });
  if (upErr) {
    return { error: upErr.message || "Upload mislukt", status: 500 };
  }

  const oldPath = (existing as { contract_storage_path?: string | null })
    .contract_storage_path;
  if (oldPath) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([oldPath]);
  }

  const uploaded_at = new Date().toISOString();
  const bestandsnaam = file.name.slice(0, 180);
  const { error: updErr } = await sb
    .from(table)
    .update({
      contract_storage_path: storage_path,
      contract_bestandsnaam: bestandsnaam,
      contract_uploaded_at: uploaded_at,
    })
    .eq("id", id);

  if (updErr) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([storage_path]);
    if (
      updErr.code === "42703" ||
      updErr.message?.includes("contract_storage_path")
    ) {
      return {
        error:
          "Voer supabase/migrate-relatie-gegevens-contract.sql uit in Supabase",
        status: 503,
      };
    }
    return { error: updErr.message || "Opslaan mislukt", status: 500 };
  }

  const { data: signed } = await sb.storage
    .from(RELATIE_CONTRACT_BUCKET)
    .createSignedUrl(storage_path, 60 * 60);

  return {
    contract_storage_path: storage_path,
    contract_bestandsnaam: bestandsnaam,
    contract_uploaded_at: uploaded_at,
    url: signed?.signedUrl || null,
  };
}

export async function signedContractUrl(
  sb: SupabaseClient,
  storagePath: string | null | undefined
): Promise<string | null> {
  if (!storagePath) return null;
  const { data } = await sb.storage
    .from(RELATIE_CONTRACT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  return data?.signedUrl || null;
}
