/**
 * Monteur-dossier onder installatie_partner_teamgenoten.
 * Verplicht: KvK, certificaten, foto. Optioneel: CV.
 */

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RELATIE_CONTRACT_BUCKET,
  ensureRelatieContractBucket,
  signedContractUrl,
} from "@/lib/relatie-contract";
import type { InstallatiePartnerTeamgenoot } from "@/types/database";

export type MonteurDocType =
  | "kvk_uitreksel"
  | "certificaten"
  | "cv"
  | "foto";

export const MONTEUR_DOC_REQUIRED: MonteurDocType[] = [
  "kvk_uitreksel",
  "certificaten",
  "foto",
];

export const MONTEUR_DOC_META: Record<
  MonteurDocType,
  {
    path: string;
    name: string;
    at: string;
    label: string;
    required: boolean;
    /** foto = image preferred; others pdf/image */
    imageOnly?: boolean;
  }
> = {
  kvk_uitreksel: {
    path: "kvk_uitreksel_storage_path",
    name: "kvk_uitreksel_bestandsnaam",
    at: "kvk_uitreksel_uploaded_at",
    label: "KvK-uittreksel",
    required: true,
  },
  certificaten: {
    path: "certificaten_storage_path",
    name: "certificaten_bestandsnaam",
    at: "certificaten_uploaded_at",
    label: "Certificeringen",
    required: true,
  },
  cv: {
    path: "cv_storage_path",
    name: "cv_bestandsnaam",
    at: "cv_uploaded_at",
    label: "CV",
    required: false,
  },
  foto: {
    path: "foto_storage_path",
    name: "foto_bestandsnaam",
    at: "foto_uploaded_at",
    label: "Foto monteur",
    required: true,
    imageOnly: true,
  },
};

export const TEAMGENOOT_SELECT_BASE =
  "id, partner_id, naam, email, telefoon, actief, created_at, updated_at";

export const TEAMGENOOT_SELECT_DOSSIER = [
  TEAMGENOOT_SELECT_BASE,
  "kvk_uitreksel_storage_path, kvk_uitreksel_bestandsnaam, kvk_uitreksel_uploaded_at",
  "certificaten_storage_path, certificaten_bestandsnaam, certificaten_uploaded_at",
  "cv_storage_path, cv_bestandsnaam, cv_uploaded_at",
  "foto_storage_path, foto_bestandsnaam, foto_uploaded_at",
  "dossier_compleet",
].join(", ");

export function parseMonteurDocType(
  raw: string | null | undefined
): MonteurDocType | null {
  if (
    raw === "kvk_uitreksel" ||
    raw === "certificaten" ||
    raw === "cv" ||
    raw === "foto"
  ) {
    return raw;
  }
  return null;
}

export function isMonteurDossierCompleet(row: {
  kvk_uitreksel_storage_path?: string | null;
  certificaten_storage_path?: string | null;
  foto_storage_path?: string | null;
}): boolean {
  return Boolean(
    row.kvk_uitreksel_storage_path?.trim() &&
      row.certificaten_storage_path?.trim() &&
      row.foto_storage_path?.trim()
  );
}

export function isMonteurDossierColumnError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    msg.includes("dossier_compleet") ||
    msg.includes("kvk_uitreksel_storage_path") ||
    msg.includes("certificaten_storage_path") ||
    msg.includes("foto_storage_path") ||
    msg.includes("cv_storage_path") ||
    (msg.includes("schema cache") && msg.includes("teamgenoot"))
  );
}

/** Soft-select: probeer dossier-kolommen, val terug op basis. */
export async function selectTeamgenoten(
  sb: SupabaseClient,
  partnerId: string
): Promise<{
  rows: InstallatiePartnerTeamgenoot[];
  migration_required?: boolean;
  hint?: string;
}> {
  const full = await sb
    .from("installatie_partner_teamgenoten")
    .select(TEAMGENOOT_SELECT_DOSSIER)
    .eq("partner_id", partnerId)
    .order("naam");
  if (!full.error) {
    return {
      rows: (full.data || []) as unknown as InstallatiePartnerTeamgenoot[],
    };
  }
  if (
    full.error.code === "42P01" ||
    full.error.message?.includes("installatie_partner_teamgenoten")
  ) {
    return {
      rows: [],
      migration_required: true,
      hint: "Voer supabase/migrate-partner-teamgenoten.sql uit in Supabase.",
    };
  }
  if (isMonteurDossierColumnError(full.error)) {
    const soft = await sb
      .from("installatie_partner_teamgenoten")
      .select(TEAMGENOOT_SELECT_BASE)
      .eq("partner_id", partnerId)
      .order("naam");
    if (soft.error) throw soft.error;
    return {
      rows: (
        (soft.data || []) as unknown as InstallatiePartnerTeamgenoot[]
      ).map((r) => ({
        ...r,
        dossier_compleet: false,
      })),
      migration_required: true,
      hint: "Voer supabase/migrate-partner-monteur-dossier.sql uit in Supabase.",
    };
  }
  throw full.error;
}

export async function uploadMonteurDocument(
  sb: SupabaseClient,
  partnerId: string,
  teamgenootId: string,
  docType: MonteurDocType,
  file: File
): Promise<
  | {
      teamgenoot: InstallatiePartnerTeamgenoot;
      url: string | null;
      fields: Record<string, string>;
    }
  | { error: string; status: number }
> {
  const meta = MONTEUR_DOC_META[docType];
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith("image/");
  if (meta.imageOnly) {
    if (!isImage) {
      return { error: "Foto: alleen afbeelding toegestaan", status: 400 };
    }
  } else if (!isPdf && !isImage) {
    return { error: "Alleen PDF of afbeelding toegestaan", status: 400 };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: "Bestand mag max. 20 MB zijn", status: 400 };
  }

  await ensureRelatieContractBucket(sb);

  const { data: existing, error: exErr } = await sb
    .from("installatie_partner_teamgenoten")
    .select(TEAMGENOOT_SELECT_DOSSIER)
    .eq("id", teamgenootId)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (exErr) {
    if (isMonteurDossierColumnError(exErr)) {
      return {
        error:
          "Voer supabase/migrate-partner-monteur-dossier.sql uit in Supabase",
        status: 503,
      };
    }
    return { error: exErr.message, status: 500 };
  }
  if (!existing) {
    return { error: "Monteur niet gevonden", status: 404 };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (isPdf ? "pdf" : "jpg");
  const storage_path = `partner/${partnerId}/monteur/${teamgenootId}/${docType}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
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

  const row = existing as unknown as InstallatiePartnerTeamgenoot;
  const oldPath = (row as unknown as Record<string, string | null>)[meta.path];
  if (oldPath && oldPath !== storage_path) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([oldPath]);
  }

  const uploaded_at = new Date().toISOString();
  const bestandsnaam = file.name.slice(0, 180);
  const nextPartial: Record<string, string | boolean | null> = {
    [meta.path]: storage_path,
    [meta.name]: bestandsnaam,
    [meta.at]: uploaded_at,
    updated_at: uploaded_at,
  };
  const merged = {
    ...row,
    ...nextPartial,
  } as InstallatiePartnerTeamgenoot;
  nextPartial.dossier_compleet = isMonteurDossierCompleet(merged);

  const { data: updated, error: upDb } = await sb
    .from("installatie_partner_teamgenoten")
    .update(nextPartial)
    .eq("id", teamgenootId)
    .eq("partner_id", partnerId)
    .select(TEAMGENOOT_SELECT_DOSSIER)
    .single();

  if (upDb) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([storage_path]);
    return { error: upDb.message, status: 500 };
  }

  const url = await signedContractUrl(sb, storage_path);
  return {
    teamgenoot: updated as unknown as InstallatiePartnerTeamgenoot,
    url,
    fields: {
      [meta.path]: storage_path,
      [meta.name]: bestandsnaam,
      [meta.at]: uploaded_at,
      dossier_compleet: String(nextPartial.dossier_compleet),
    },
  };
}

/** Upload file to temp path then attach after insert — used for create-with-docs. */
export async function uploadMonteurFileToPath(
  sb: SupabaseClient,
  partnerId: string,
  teamgenootId: string,
  docType: MonteurDocType,
  file: File
): Promise<
  | { storage_path: string; bestandsnaam: string; uploaded_at: string }
  | { error: string; status: number }
> {
  const meta = MONTEUR_DOC_META[docType];
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith("image/");
  if (meta.imageOnly) {
    if (!isImage) {
      return { error: `${meta.label}: alleen afbeelding`, status: 400 };
    }
  } else if (!isPdf && !isImage) {
    return {
      error: `${meta.label}: alleen PDF of afbeelding`,
      status: 400,
    };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: `${meta.label}: max. 20 MB`, status: 400 };
  }

  await ensureRelatieContractBucket(sb);
  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (isPdf ? "pdf" : "jpg");
  const storage_path = `partner/${partnerId}/monteur/${teamgenootId}/${docType}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
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
  return {
    storage_path,
    bestandsnaam: file.name.slice(0, 180),
    uploaded_at: new Date().toISOString(),
  };
}
