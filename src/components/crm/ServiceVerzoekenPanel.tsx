"use client";

import { useState } from "react";
import Link from "next/link";
import type { ServiceVerzoek } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";
import { serviceVerzoekStatusLabel } from "@/lib/labels";

export function ServiceVerzoekenPanel({
  verzoeken,
  onUpdated,
}: {
  verzoeken: ServiceVerzoek[];
  onUpdated?: () => void;
}) {
  const open = verzoeken.filter((v) => v.status === "open");
  const done = verzoeken.filter((v) => v.status === "afgehandeld");

  return (
    <div className="border-t border-line">
      <div className="flex items-end justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">
            Service verzoeken
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Open verzoeken zetten het project op status Service.
          </p>
        </div>
        <span className="text-xs font-semibold tabular-nums text-muted">
          {open.length} open
        </span>
      </div>

      {verzoeken.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-muted">
          Nog geen serviceverzoeken. Maak er een aan via een project.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="crm-table crm-table--compact">
            <thead>
              <tr>
                <th>Status</th>
                <th>Onderwerp</th>
                <th>Klant</th>
                <th>Project</th>
                <th>Ingeschoten</th>
                <th>Notitie</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...open, ...done].map((v) => (
                <ServiceRow key={v.id} verzoek={v} onUpdated={onUpdated} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ServiceRow({
  verzoek,
  onUpdated,
}: {
  verzoek: ServiceVerzoek;
  onUpdated?: () => void;
}) {
  const [note, setNote] = useState(verzoek.interne_notitie || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-verzoeken/${verzoek.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interne_notitie: note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function afhandelen() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-verzoeken/${verzoek.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "afgehandeld",
          interne_notitie: note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afhandelen mislukt");
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className={verzoek.status === "afgehandeld" ? "opacity-70" : undefined}>
      <td>
        <span
          className={[
            "inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            verzoek.status === "open"
              ? "border-[#C45A12]/25 bg-[#FFF0E6] text-[#C45A12]"
              : "border-[#0D5C32]/25 bg-[#E8F6EC] text-[#0D5C32]",
          ].join(" ")}
        >
          {serviceVerzoekStatusLabel[verzoek.status]}
        </span>
      </td>
      <td className="max-w-[14rem]">
        <p className="font-medium text-ink">{verzoek.onderwerp}</p>
        {verzoek.omschrijving && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">
            {verzoek.omschrijving}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap text-sm">
        {verzoek.leads?.naam || "—"}
        <div className="font-mono text-[10px] text-muted">
          {verzoek.leads?.lead_number}
        </div>
      </td>
      <td className="whitespace-nowrap">
        {verzoek.projecten ? (
          <Link
            href={`/projecten/${verzoek.project_id}`}
            className="font-mono text-[11px] font-semibold text-green-dark hover:underline"
          >
            {verzoek.projecten.project_nummer}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap text-muted text-[11px]">
        {formatDateTimeNl(verzoek.created_at)}
      </td>
      <td className="min-w-[12rem]" onClick={(e) => e.stopPropagation()}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Interne notitie…"
          className="w-full border border-line bg-white px-2 py-1 text-[11px] outline-none focus:border-green"
          disabled={saving}
        />
        {error && <p className="mt-0.5 text-[10px] text-[#C45A12]">{error}</p>}
      </td>
      <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={saveNote}
            className="border border-line px-2 py-1 text-[10px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Notitie opslaan
          </button>
          {verzoek.status === "open" && (
            <button
              type="button"
              disabled={saving}
              onClick={afhandelen}
              className="border border-green bg-green px-2 py-1 text-[10px] font-semibold text-white hover:bg-green-dark disabled:opacity-50"
            >
              Afhandelen
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
