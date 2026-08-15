"use client";

import { useRouter } from "next/navigation";
import type { Adviseur, Lead, LeadStatus } from "@/types/database";
import { LEAD_STATUSES, leadStatusLabel, statusTone } from "@/lib/labels";

function adresRegel(lead: Lead): string {
  const parts = [
    lead.straat,
    [lead.huisnummer, lead.toevoeging].filter(Boolean).join(""),
  ].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return (
    [lead.postcode, lead.huisnummer, lead.toevoeging]
      .filter(Boolean)
      .join(" ") || "—"
  );
}

export function LeadsTable({
  leads,
  onStatusChange,
}: {
  leads: Lead[];
  adviseurs?: Adviseur[];
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
  onAdviseurChange?: (leadId: string, adviseurId: string | null) => void;
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
      <table className="crm-table crm-table--compact">
        <thead>
          <tr>
            <th>Naam</th>
            <th>Adres</th>
            <th>Woonplaats</th>
            <th>Tel nr</th>
            <th>Email</th>
            <th>Status</th>
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
                <span className="font-medium text-ink whitespace-nowrap">
                  {lead.naam}
                </span>
              </td>
              <td className="text-muted whitespace-nowrap">
                {adresRegel(lead)}
              </td>
              <td className="text-muted whitespace-nowrap">
                {lead.plaats || "—"}
              </td>
              <td className="text-muted whitespace-nowrap">
                {lead.telefoon || "—"}
              </td>
              <td className="text-muted whitespace-nowrap">
                {lead.email || "—"}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <select
                  value={lead.status}
                  onChange={(e) =>
                    onStatusChange?.(lead.id, e.target.value as LeadStatus)
                  }
                  className={`max-w-[9.5rem] cursor-pointer border bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wide outline-none focus:border-green ${statusTone("lead", lead.status)}`}
                  aria-label="Lead status"
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {leadStatusLabel[s]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
