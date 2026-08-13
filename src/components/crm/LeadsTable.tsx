"use client";

import { useRouter } from "next/navigation";
import type { Lead, LeadStatus } from "@/types/database";
import { LEAD_STATUSES, leadStatusLabel, statusTone } from "@/lib/labels";
import { formatDateShort, formatDateTimeNl } from "@/lib/format";

export function LeadsTable({
  leads,
  onStatusChange,
}: {
  leads: Lead[];
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
}) {
  const router = useRouter();

  if (leads.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-display text-base font-semibold text-ink">
          Nog geen leads
        </p>
        <p className="mt-1 text-sm text-muted">
          Nieuwe leads komen binnen via de website-scan.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="crm-table">
        <thead>
          <tr>
            <th>Lead ID</th>
            <th>Naam</th>
            <th>Contact</th>
            <th>Adres</th>
            <th>UTM</th>
            <th>Status</th>
            <th>Aangemaakt</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="cursor-pointer"
              onClick={() => router.push(`/leads/${lead.id}`)}
            >
              <td>
                <span className="font-mono text-[11px] font-semibold text-green-dark">
                  {lead.lead_number}
                </span>
              </td>
              <td>
                <span className="font-medium text-ink">{lead.naam}</span>
              </td>
              <td className="text-muted">
                <div className="whitespace-nowrap">{lead.email || "—"}</div>
                <div className="whitespace-nowrap text-[11px] opacity-80">
                  {lead.telefoon || ""}
                </div>
              </td>
              <td className="text-muted whitespace-nowrap">
                {[lead.postcode, lead.huisnummer, lead.toevoeging]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </td>
              <td>
                {lead.utm_source ? (
                  <span className="inline-flex border border-green/25 bg-green-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-dark">
                    {lead.utm_source}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <select
                  value={lead.status}
                  onChange={(e) =>
                    onStatusChange?.(lead.id, e.target.value as LeadStatus)
                  }
                  className={`cursor-pointer border bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide outline-none focus:border-green ${statusTone("lead", lead.status)}`}
                  aria-label="Lead status"
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {leadStatusLabel[s]}
                    </option>
                  ))}
                </select>
              </td>
              <td
                className="text-muted whitespace-nowrap"
                title={formatDateTimeNl(lead.created_at)}
              >
                {formatDateShort(lead.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
