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
    <div className="overflow-x-auto">
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
  );
}
