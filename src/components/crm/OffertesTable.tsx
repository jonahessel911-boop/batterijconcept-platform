"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Offerte, OfferteStatus } from "@/types/database";
import { offerteStatusLabel } from "@/lib/labels";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort, formatEuro } from "@/lib/format";
import { rememberCrmReturnUrl } from "./DetailChrome";

const OFFERTE_STATUSES: OfferteStatus[] = [
  "concept",
  "verzonden",
  "ondertekend",
  "verlopen",
  "afgewezen",
];

export function OffertesTable({
  offertes,
  onOpenSign,
}: {
  offertes: Offerte[];
  onOpenSign?: (o: Offerte) => void;
}) {
  const router = useRouter();
  const [actieOfferte, setActieOfferte] = useState<Offerte | null>(null);
  const [statusFilter, setStatusFilter] = useState<OfferteStatus | "">("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offertes.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        o.offerte_nummer,
        o.leads?.naam,
        o.leads?.lead_number,
        o.leads?.email,
        o.leads?.telefoon,
        o.leads?.plaats,
        o.installatie_partners?.naam,
        o.titel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [offertes, statusFilter, search]);

  if (offertes.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Nog geen offertes.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative w-full sm:max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
            ⌕
          </span>
          <input
            type="search"
            inputMode="search"
            placeholder="Zoek offertenummer, klant, lead, plaats…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
          />
        </div>
        <p className="text-xs text-muted">
          {filtered.length} van {offertes.length} offerte
          {offertes.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="overflow-x-auto">
      <table className="crm-table crm-table--compact">
        <thead>
          <tr>
            <th>Offerte</th>
            <th>Klant</th>
            <th>Lead</th>
            <th>Installateur</th>
            <th>
              <div className="flex items-center gap-2">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as OfferteStatus | "")
                  }
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-[8.5rem] cursor-pointer border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ink outline-none focus:border-green"
                  aria-label="Filter op status"
                  title="Filter op status"
                >
                  <option value="">Alles</option>
                  {OFFERTE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {offerteStatusLabel[s]}
                    </option>
                  ))}
                </select>
              </div>
            </th>
            <th>Totaal</th>
            <th>Geldig tot</th>
            <th>Actie</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={8} className="!cursor-default">
                <div className="px-5 py-14 text-center">
                  <p className="font-display text-base font-semibold text-ink">
                    Geen offertes gevonden
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {search.trim()
                      ? `Geen resultaat voor “${search.trim()}”.`
                      : statusFilter
                        ? `Geen offertes met status “${offerteStatusLabel[statusFilter]}”.`
                        : "Pas je zoekopdracht of filter aan."}
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            filtered.map((o) => (
              <tr
                key={o.id}
                className="cursor-pointer"
                onClick={() => {
                  rememberCrmReturnUrl();
                  router.push(`/offertes/${o.id}`);
                }}
              >
                <td className="font-mono text-[11px] font-semibold text-green-dark whitespace-nowrap">
                  {o.offerte_nummer}
                </td>
                <td className="font-medium whitespace-nowrap">
                  {o.leads?.naam || "—"}
                </td>
                <td className="whitespace-nowrap">
                  <Link
                    href={`/leads/${o.lead_id}`}
                    className="font-mono text-[11px] text-muted hover:text-green-dark hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {o.leads?.lead_number || o.lead_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="text-muted whitespace-nowrap">
                  {o.installatie_partners?.naam || "—"}
                </td>
                <td>
                  <StatusBadge kind="offerte" value={o.status} />
                </td>
                <td className="whitespace-nowrap font-medium tabular-nums">
                  {formatEuro(o.totaal_inc_btw)}
                </td>
                <td className="text-muted whitespace-nowrap">
                  {formatDateShort(o.geldig_tot)}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {o.status === "ondertekend" ? (
                    o.actie_required ? (
                      <button
                        type="button"
                        onClick={() => setActieOfferte(o)}
                        className="border border-[#C45A12]/35 bg-[#FFF0E6] px-2 py-0.5 text-[11px] font-semibold text-[#C45A12] hover:bg-[#ffe6d4]"
                      >
                        ACTIE
                      </button>
                    ) : (
                      <span className="text-[11px] font-medium text-green-dark">
                        ✓ {o.ondertekend_naam || "Getekend"}
                      </span>
                    )
                  ) : o.sign_token ? (
                    <button
                      type="button"
                      onClick={() => onOpenSign?.(o)}
                      className="border border-orange bg-orange px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#e0651c]"
                    >
                      Open link
                    </button>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {actieOfferte && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
                  Actie vereist
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink">
                  Ondertekende offerte heeft backoffice-actie nodig
                </h3>
                <p className="mt-2 text-sm text-muted">
                  {actieOfferte.offerte_nummer} ·{" "}
                  {actieOfferte.leads?.naam || "Klant"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActieOfferte(null)}
                className="h-10 w-10 text-xl text-muted hover:bg-wash"
                aria-label="Popup sluiten"
              >
                ×
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/offertes/${actieOfferte.id}?backoffice=1`}
                onClick={() => setActieOfferte(null)}
                className="flex-1 bg-orange px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#e0651c]"
              >
                Naar back office
              </Link>
              <button
                type="button"
                onClick={() => setActieOfferte(null)}
                className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
