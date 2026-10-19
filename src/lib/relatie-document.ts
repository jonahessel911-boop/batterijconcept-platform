import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RELATIE_CONTRACT_BUCKET,
  ensureRelatieContractBucket,
  type RelatieKind,
} from "@/lib/relatie-contract";

export type RelatieDocType = "kvk_uitreksel" | "certificaten";

const DOC_META: Record<
  RelatieDocType,
  {
    path: string;
    name: string;
    at: string;
    label: string;
    partnerOnly?: boolean;
  }
> = {
  kvk_uitreksel: {
    path: "kvk_uitreksel_storage_path",
    name: "kvk_uitreksel_bestandsnaam",
    at: "kvk_uitreksel_uploaded_at",
    label: "KvK-uittreksel",
  },
  certificaten: {
    path: "certificaten_storage_path",
    name: "certificaten_bestandsnaam",
    at: "certificaten_uploaded_at",
    label: "Certificaten",
    partnerOnly: true,
  },
};

function tableFor(kind: RelatieKind): string {
  return kind === "adviseur" ? "adviseurs" : "installatie_partners";
}

export function relatieDocMeta(docType: RelatieDocType) {
  return DOC_META[docType];
}

export function parseRelatieDocType(
  raw: string | null | undefined
): RelatieDocType | null {
  if (raw === "kvk_uitreksel" || raw === "certificaten") return raw;
  return null;
}

export async function uploadRelatieDocument(
  sb: SupabaseClient,
  kind: RelatieKind,
  id: string,
  docType: RelatieDocType,
  file: File
): Promise<
  | {
      storage_path: string;
      bestandsnaam: string;
      uploaded_at: string;
      url: string | null;
      fields: Record<string, string>;
    }
  | { error: string; status: number }
> {
  const meta = DOC_META[docType];
  if (meta.partnerOnly && kind !== "partner") {
    return { error: "Certificaten alleen voor monteurs", status: 400 };
  }

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
  const { data: existing, error: exErr } = await sb
    .from(table)
    .select("id, " + meta.path)
    .eq("id", id)
    .maybeSingle();
  if (exErr) {
    if (exErr.code === "42703" || exErr.message?.includes(meta.path)) {
      return {
        error:
          "Voer supabase/migrate-relatie-onboarding.sql uit in Supabase",
        status: 503,
      };
    }
    return { error: exErr.message, status: 500 };
  }
  if (!existing) {
    return { error: "Relatie niet gevonden", status: 404 };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (isPdf ? "pdf" : "jpg");
  const storage_path = `${kind}/${id}/${docType}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
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

  const oldPath = (existing as unknown as Record<string, string | null>)[
    meta.path
  ];
  if (oldPath) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([oldPath]);
  }

  const uploaded_at = new Date().toISOString();
  const bestandsnaam = file.name.slice(0, 180);
  const fields = {
    [meta.path]: storage_path,
    [meta.name]: bestandsnaam,
    [meta.at]: uploaded_at,
  };
  const { error: updErr } = await sb.from(table).update(fields).eq("id", id);

  if (updErr) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([storage_path]);
    if (updErr.code === "42703" || updErr.message?.includes(meta.path)) {
      return {
        error:
          "Voer supabase/migrate-relatie-onboarding.sql uit in Supabase",
        status: 503,
      };
    }
    return { error: updErr.message || "Opslaan mislukt", status: 500 };
  }

  const { data: signed } = await sb.storage
    .from(RELATIE_CONTRACT_BUCKET)
    .createSignedUrl(storage_path, 60 * 60);

  return {
    storage_path,
    bestandsnaam,
    uploaded_at,
    url: signed?.signedUrl || null,
    fields,
  };
}
