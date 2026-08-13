"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Factuur } from "@/types/database";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort, formatEuro } from "@/lib/format";

export function FacturenTable({ facturen }: { facturen: Factuur[] }) {
  const router = useRouter();

  if (facturen.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Nog geen facturen.</p>
      </div>
    );
  }

  return (
    <>
      <div className="crm-card-list flex md:hidden">
        {facturen.map((f) => (
          <article key={f.id} className="crm-card">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => router.push(`/facturen/${f.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{f.leads?.naam || "—"}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-semibold text-green-dark">
                    {f.factuur_nummer}
                  </p>
                </div>
                <StatusBadge kind="factuur" value={f.status} />
              </div>
              <p className="mt-2 text-sm font-medium text-ink">
                {formatEuro(f.bedrag_inc_btw)}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {f.omschrijving || "Geen omschrijving"} ·{" "}
                {formatDateShort(f.factuurdatum)}
              </p>
            </button>
            <Link
              href={`/leads/${f.lead_id}`}
              className="mt-2 inline-block font-mono text-[11px] text-muted underline-offset-2 hover:text-green-dark hover:underline"
            >
              {f.leads?.lead_number || "Lead"}
            </Link>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Factuur</th>
              <th>Lead ID</th>
              <th>Klant</th>
              <th>Omschrijving</th>
              <th>Status</th>
              <th>Bedrag</th>
              <th>Factuurdatum</th>
              <th>Vervaldatum</th>
            </tr>
          </thead>
          <tbody>
            {facturen.map((f) => (
              <tr
                key={f.id}
                className="cursor-pointer"
                onClick={() => router.push(`/facturen/${f.id}`)}
              >
                <td className="font-mono text-[11px] font-semibold text-green-dark whitespace-nowrap">
                  {f.factuur_nummer}
                </td>
                <td className="whitespace-nowrap">
                  <Link
                    href={`/leads/${f.lead_id}`}
                    className="font-mono text-[11px] text-muted hover:text-green-dark hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {f.leads?.lead_number || f.lead_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="font-medium whitespace-nowrap">
                  {f.leads?.naam || "—"}
                </td>
                <td className="max-w-[180px] truncate text-muted">
                  {f.omschrijving || "—"}
                </td>
                <td>
                  <StatusBadge kind="factuur" value={f.status} />
                </td>
                <td className="whitespace-nowrap font-medium">
                  {formatEuro(f.bedrag_inc_btw)}
                </td>
                <td className="text-muted whitespace-nowrap">
                  {formatDateShort(f.factuurdatum)}
                </td>
                <td className="text-muted whitespace-nowrap">
                  {formatDateShort(f.vervaldatum)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
