import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZzpContractFields } from "@/lib/pdf-zzp-overeenkomst";
import {
  RELATIE_CONTRACT_BUCKET,
  ensureRelatieContractBucket,
} from "@/lib/relatie-contract";

export type ContractSignStatus = "concept" | "verzonden" | "ondertekend";

export function newContractSignToken(): string {
  return randomBytes(24).toString("hex");
}

export function fieldsFromAdviseur(row: {
  naam?: string | null;
  email?: string | null;
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  btw_nummer?: string | null;
  factuur_adres?: string | null;
  factuur_postcode?: string | null;
  factuur_plaats?: string | null;
  iban?: string | null;
}): Partial<ZzpContractFields> {
  const postcodePlaats = [row.factuur_postcode, row.factuur_plaats]
    .filter(Boolean)
    .join(" ");
  return {
    adv_naam_onderneming: row.bedrijfsnaam || row.naam || "",
    adv_handelsnaam: row.bedrijfsnaam || "",
    adv_adres: row.factuur_adres || "",
    adv_postcode_plaats: postcodePlaats,
    adv_kvk: row.kvk_nummer || "",
    adv_btw: row.btw_nummer || "",
    adv_email: row.email || "",
    adv_iban: row.iban || "",
    adv_ondertekenaar: row.naam || "",
  };
}

export async function storeSignedZzpContract(
  sb: SupabaseClient,
  adviseurId: string,
  pdfBytes: Uint8Array,
  bestandsnaam: string
): Promise<{ storage_path: string; uploaded_at: string } | { error: string }> {
  await ensureRelatieContractBucket(sb);

  const { data: existing } = await sb
    .from("adviseurs")
    .select("contract_storage_path")
    .eq("id", adviseurId)
    .maybeSingle();

  const storage_path = `adviseur/${adviseurId}/zzp-signed-${Date.now()}.pdf`;
  const { error: upErr } = await sb.storage
    .from(RELATIE_CONTRACT_BUCKET)
    .upload(storage_path, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upErr) {
    return { error: upErr.message || "Upload mislukt" };
  }

  const oldPath = (existing as { contract_storage_path?: string | null } | null)
    ?.contract_storage_path;
  if (oldPath && oldPath !== storage_path) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([oldPath]);
  }

  const uploaded_at = new Date().toISOString();
  const { error: updErr } = await sb
    .from("adviseurs")
    .update({
      contract_storage_path: storage_path,
      contract_bestandsnaam: bestandsnaam.slice(0, 180),
      contract_uploaded_at: uploaded_at,
      contract_sign_status: "ondertekend",
      contract_signed_at: uploaded_at,
      contract_bc_handtekening: null,
    })
    .eq("id", adviseurId);

  if (updErr) {
    await sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([storage_path]);
    return { error: updErr.message || "Opslaan mislukt" };
  }

  return { storage_path, uploaded_at };
}
