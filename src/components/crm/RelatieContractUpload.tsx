"use client";

import { useRef, useState } from "react";

type Props = {
  kind: "adviseur" | "partner";
  id: string;
  bestandsnaam?: string | null;
  uploadedAt?: string | null;
  onUploaded: (meta: {
    contract_bestandsnaam: string;
    contract_uploaded_at: string;
    contract_storage_path: string;
  }) => void;
  onMessage?: (msg: string, isError?: boolean) => void;
};

export function RelatieContractUpload({
  kind,
  id,
  bestandsnaam,
  uploadedAt,
  onUploaded,
  onMessage,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/relaties/${kind}/${id}/contract`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      onUploaded({
        contract_bestandsnaam: data.contract_bestandsnaam,
        contract_uploaded_at: data.contract_uploaded_at,
        contract_storage_path: data.contract_storage_path,
      });
      onMessage?.("Samenwerkingscontract geüpload.");
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : "Upload mislukt",
        true
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function openContract() {
    try {
      const res = await fetch(`/api/relaties/${kind}/${id}/contract`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Openen mislukt");
      if (!data.url) throw new Error("Geen contract gevonden");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      onMessage?.(
        e instanceof Error ? e.message : "Openen mislukt",
        true
      );
    }
  }

  return (
    <div className="border border-line p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        Samenwerkingscontract
      </p>
      <p className="mt-1 text-sm text-muted">
        Ondertekend contract (PDF of afbeelding).
      </p>
      {bestandsnaam ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void openContract()}
            className="text-sm font-semibold text-green-dark hover:underline"
          >
            {bestandsnaam}
          </button>
          {uploadedAt && (
            <span className="text-xs text-muted">
              {new Date(uploadedAt).toLocaleDateString("nl-NL")}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Nog geen contract geüpload.</p>
      )}
      <div className="mt-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash disabled:opacity-60"
        >
          {busy
            ? "Uploaden…"
            : bestandsnaam
              ? "Vervang contract"
              : "Upload contract"}
        </button>
      </div>
    </div>
  );
}
