"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Offerte } from "@/types/database";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort, formatEuro } from "@/lib/format";

export function OffertesTable({
  offertes,
  onOpenSign,
}: {
  offertes: Offerte[];
  onOpenSign?: (o: Offerte) => void;
}) {
  const router = useRouter();

  if (offertes.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Nog geen offertes.</p>
      </div>
    );
  }

  return (
    <>
      <div className="crm-card-list md:hidden">
        {offertes.map((o) => (
          <article key={o.id} className="crm-card">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => router.push(`/offertes/${o.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {o.leads?.naam || "—"}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] font-semibold text-green-dark">
                    {o.offerte_nummer}
                  </p>
                </div>
                <StatusBadge kind="offerte" value={o.status} />
              </div>
              <p className="mt-2 text-sm font-medium text-ink">
                {formatEuro(o.totaal_inc_btw)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Geldig tot {formatDateShort(o.geldig_tot)}
              </p>
            </button>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={`/leads/${o.lead_id}`}
                className="font-mono text-[11px] text-muted underline-offset-2 hover:text-green-dark hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {o.leads?.lead_number || "Lead"}
              </Link>
              {o.status !== "ondertekend" && o.sign_token && (
                <button
                  type="button"
                  onClick={() => onOpenSign?.(o)}
                  className="ml-auto min-h-10 border border-orange bg-orange px-3 py-2 text-sm font-semibold text-white"
                >
                  Open link
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Offerte</th>
              <th>Lead ID</th>
              <th>Klant</th>
              <th>Status</th>
              <th>Totaal</th>
              <th>Geldig tot</th>
              <th>Ondertekenen</th>
            </tr>
          </thead>
          <tbody>
            {offertes.map((o) => (
              <tr
                key={o.id}
                onClick={() => router.push(`/offertes/${o.id}`)}
              >
                <td className="font-mono text-[11px] font-semibold text-green-dark whitespace-nowrap">
                  {o.offerte_nummer}
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
                <td className="font-medium whitespace-nowrap">
                  {o.leads?.naam || "—"}
                </td>
                <td>
                  <StatusBadge kind="offerte" value={o.status} />
                </td>
                <td className="whitespace-nowrap font-medium">
                  {formatEuro(o.totaal_inc_btw)}
                </td>
                <td className="text-muted whitespace-nowrap">
                  {formatDateShort(o.geldig_tot)}
                </td>
                <td>
                  {o.status === "ondertekend" ? (
                    <span className="text-[11px] font-medium text-green-dark">
                      ✓ {o.ondertekend_naam || "Getekend"}
                    </span>
                  ) : o.sign_token ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSign?.(o);
                      }}
                      className="border border-orange bg-orange px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[#e0651c]"
                    >
                      Open link →
                    </button>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
