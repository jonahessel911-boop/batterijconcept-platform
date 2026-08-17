"use client";

import { useRouter } from "next/navigation";
import type { Adviseur, Lead, LeadStatus } from "@/types/database";
import { LEAD_STATUSES, leadStatusLabel, statusTone } from "@/lib/labels";
import { formatDateTimeNl } from "@/lib/format";

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
  statusFilter = "",
  onStatusFilterChange,
  onStatusChange,
}: {
  leads: Lead[];
  adviseurs?: Adviseur[];
  statusFilter?: LeadStatus | "";
  onStatusFilterChange?: (status: string) => void;
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
  onAdviseurChange?: (leadId: string, adviseurId: string | null) => void;
}) {
  const router = useRouter();
  const rows = [...leads].sort((a, b) => {
    const aFlag = a.terugbellen ? 1 : 0;
    const bFlag = b.terugbellen ? 1 : 0;
    if (aFlag !== bFlag) return bFlag - aFlag;
    return 0;
  });

  return (
    <div className="overflow-x-auto">
      <table className="crm-table crm-table--compact">
        <thead>
          <tr>
            <th>Binnengekomen</th>
            <th>Naam</th>
            <th>Adres</th>
            <th>Woonplaats</th>
            <th>Tel nr</th>
            <th>Email</th>
            <th>
              <div className="flex items-center gap-2">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => onStatusFilterChange?.(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-[8.5rem] cursor-pointer border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ink outline-none focus:border-green"
                  aria-label="Filter op status"
                  title="Filter op status"
                >
                  <option value="">Alles</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {leadStatusLabel[s]}
                    </option>
                  ))}
                </select>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 ? (
            <tr>
              <td colSpan={7} className="!cursor-default px-6 py-14 text-center">
                <p className="font-display text-base font-semibold text-ink">
                  {statusFilter
                    ? `Geen leads met status “${leadStatusLabel[statusFilter]}”`
                    : "Nog geen leads"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {statusFilter
                    ? "Kies een andere statusfilter of zet op Alles."
                    : "Nieuwe leads komen binnen via de website-scan."}
                </p>
              </td>
            </tr>
          ) : (
            rows.map((lead) => (
              <tr
                key={lead.id}
                className={[
                  "cursor-pointer",
                  lead.terugbellen ? "bg-[#FFF8F3]" : "",
                ].join(" ")}
                onClick={() => router.push(`/leads/${lead.id}`)}
              >
                <td className="whitespace-nowrap tabular-nums text-muted">
                  {formatDateTimeNl(lead.created_at)}
                </td>
                <td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink whitespace-nowrap">
                      {lead.naam}
                    </span>
                    {lead.terugbellen && (
                      <span className="inline-flex items-center rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                        Terugbellen
                      </span>
                    )}
                  </span>
                  {lead.terugbellen && lead.terugbel_notitie?.trim() && (
                    <p className="mt-0.5 max-w-[18rem] truncate text-[11px] text-[#C45A12]">
                      {lead.terugbel_notitie}
                    </p>
                  )}
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
