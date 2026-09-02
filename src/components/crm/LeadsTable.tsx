"use client";

import { useRouter } from "next/navigation";
import type { Adviseur, Lead, LeadStatus } from "@/types/database";
import { leadStatusLabel, statusTone } from "@/lib/labels";
import { formatDateTimeNl } from "@/lib/format";
import { LeadStatusSelectOptions } from "./LeadStatusSelectOptions";

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

function StatusFilter({
  statusFilter,
  onStatusFilterChange,
  className,
}: {
  statusFilter: LeadStatus | "";
  onStatusFilterChange?: (status: string) => void;
  className?: string;
}) {
  return (
    <select
      value={statusFilter}
      onChange={(e) => onStatusFilterChange?.(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={
        className ||
        "max-w-[8.5rem] cursor-pointer border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ink outline-none focus:border-green"
      }
      aria-label="Filter op status"
      title="Filter op status"
    >
      <option value="">Alles</option>
      <LeadStatusSelectOptions />
    </select>
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

  const empty = (
    <div className="px-5 py-14 text-center">
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
    </div>
  );

  return (
    <div>
      {/* Mobiel: kaarten */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            {rows.length} {rows.length === 1 ? "lead" : "leads"}
          </p>
          <StatusFilter
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
            className="max-w-[11rem] cursor-pointer border border-line bg-white px-2 py-1.5 text-[11px] font-semibold text-ink outline-none focus:border-green"
          />
        </div>
        {rows.length === 0 ? (
          empty
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((lead) => (
              <li key={lead.id}>
                <div
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/leads/${lead.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/leads/${lead.id}`);
                    }
                  }}
                  className={[
                    "flex w-full cursor-pointer flex-col gap-2 px-4 py-3.5 text-left active:bg-wash",
                    lead.terugbellen ? "bg-[#FFF8F3]" : "bg-white",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-semibold text-ink">
                        {lead.naam}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">
                        {lead.lead_number}
                      </p>
                    </div>
                    {lead.terugbellen && (
                      <span className="shrink-0 border border-[#C45A12]/30 bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                        Terugbellen
                      </span>
                    )}
                  </div>
                  {lead.telefoon && (
                    <a
                      href={`tel:${lead.telefoon}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-semibold text-green-dark underline-offset-2 hover:underline"
                    >
                      {lead.telefoon}
                    </a>
                  )}
                  <p className="text-sm text-muted">
                    {adresRegel(lead)}
                    {lead.plaats ? ` · ${lead.plaats}` : ""}
                  </p>
                  <div
                    className="pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <select
                      value={lead.status}
                      onChange={(e) =>
                        onStatusChange?.(
                          lead.id,
                          e.target.value as LeadStatus
                        )
                      }
                      className={`w-full cursor-pointer border bg-white px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide outline-none focus:border-green ${statusTone("lead", lead.status)}`}
                      aria-label="Lead status"
                    >
                      <LeadStatusSelectOptions />
                    </select>
                  </div>
                  <p className="text-[11px] tabular-nums text-muted">
                    {formatDateTimeNl(lead.created_at)}
                    {lead.lander ? ` · ${lead.lander}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Desktop: tabel */}
      <div className="hidden overflow-x-auto md:block">
        <table className="crm-table crm-table--compact">
          <thead>
            <tr>
              <th>Binnengekomen</th>
              <th>Naam</th>
              <th>Lander</th>
              <th>Adres</th>
              <th>Woonplaats</th>
              <th>Tel nr</th>
              <th>Email</th>
              <th>
                <div className="flex items-center gap-2">
                  <span>Status</span>
                  <StatusFilter
                    statusFilter={statusFilter}
                    onStatusFilterChange={onStatusFilterChange}
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={8} className="!cursor-default">
                  {empty}
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
                      <span className="font-medium whitespace-nowrap text-ink">
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
                  <td
                    className="max-w-[10rem] truncate text-muted"
                    title={lead.lander || undefined}
                  >
                    {lead.lander || "—"}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {adresRegel(lead)}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {lead.plaats || "—"}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {lead.telefoon || "—"}
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {lead.email || "—"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      value={lead.status}
                      onChange={(e) =>
                        onStatusChange?.(
                          lead.id,
                          e.target.value as LeadStatus
                        )
                      }
                      className={`max-w-[14rem] cursor-pointer border bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wide outline-none focus:border-green ${statusTone("lead", lead.status)}`}
                      aria-label="Lead status"
                    >
                      <LeadStatusSelectOptions />
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
