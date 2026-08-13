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
    <div className="overflow-x-auto">
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
  );
}
