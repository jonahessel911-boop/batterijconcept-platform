"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Adviseur, Afspraak, Lead, LeadStatus } from "@/types/database";
import { leadStatusLabel, statusTone } from "@/lib/labels";
import { formatDateTimeNl } from "@/lib/format";
import { isBellerRol, normalizeRol } from "@/lib/rollen";
import {
  afspraakSoortLabel,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import { LeadStatusSelectOptions } from "./LeadStatusSelectOptions";

const PAGE_SIZE = 20;
const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);

/** Eerstvolgende actieve afspraak voor een lead (of null). */
export function nextAfspraakForLead(
  afspraken: Afspraak[],
  leadId: string,
  now = Date.now()
): Afspraak | null {
  const list = afspraken
    .filter(
      (a) => a.lead_id === leadId && ACTIEVE_AFSPRAAK.has(a.status)
    )
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );
  if (list.length === 0) return null;
  const upcoming = list.find((a) => new Date(a.start_at).getTime() >= now);
  return upcoming || list[list.length - 1] || null;
}

function afspraakSamenvatting(
  a: Afspraak,
  adviseurNaam?: string | null
): { when: string; soort: string; adviseur: string | null } {
  const soort = afspraakSoortLabel[normalizeAfspraakSoort(a.soort)] || "Afspraak";
  return {
    when: formatDateTimeNl(a.start_at),
    soort,
    adviseur: adviseurNaam?.trim() || null,
  };
}

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

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PhoneCopyCell({ telefoon }: { telefoon: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!telefoon?.trim()) {
    return <span className="text-muted">—</span>;
  }

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    const value = telefoon!.trim();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="tabular-nums text-muted">{telefoon}</span>
      <button
        type="button"
        onClick={(e) => void copy(e)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted hover:bg-wash hover:text-green-dark"
        title={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
        aria-label={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
      >
        {copied ? (
          <CheckIcon className="text-green-dark" />
        ) : (
          <CopyIcon />
        )}
      </button>
    </span>
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

function PaginationBar({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
      <p className="text-xs text-muted">
        {from}–{to} van {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="min-h-8 border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
        >
          Vorige
        </button>
        <span className="px-1 text-xs tabular-nums text-muted">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="min-h-8 border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
        >
          Volgende
        </button>
      </div>
    </div>
  );
}

export function LeadsTable({
  leads,
  adviseurs = [],
  afspraken = [],
  statusFilter = "",
  onStatusFilterChange,
  onStatusChange,
  onBellerChange,
  showBellerColumn = false,
}: {
  leads: Lead[];
  adviseurs?: Adviseur[];
  afspraken?: Afspraak[];
  statusFilter?: LeadStatus | "";
  onStatusFilterChange?: (status: string) => void;
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
  onAdviseurChange?: (leadId: string, adviseurId: string | null) => void;
  onBellerChange?: (leadId: string, bellerId: string | null) => void;
  showBellerColumn?: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const bellers = useMemo(
    () =>
      adviseurs.filter((a) => a.actief && isBellerRol(normalizeRol(a.rol))),
    [adviseurs]
  );

  const adviseurNaamById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of adviseurs) m.set(a.id, a.naam);
    return m;
  }, [adviseurs]);

  const afspraakByLeadId = useMemo(() => {
    const m = new Map<string, Afspraak>();
    const now = Date.now();
    const seen = new Set<string>();
    for (const a of afspraken) {
      if (!ACTIEVE_AFSPRAAK.has(a.status)) continue;
      seen.add(a.lead_id);
    }
    for (const leadId of seen) {
      const next = nextAfspraakForLead(afspraken, leadId, now);
      if (next) m.set(leadId, next);
    }
    return m;
  }, [afspraken]);

  const rows = useMemo(() => {
    return [...leads].sort((a, b) => {
      const aFlag = a.terugbellen ? 1 : 0;
      const bFlag = b.terugbellen ? 1 : 0;
      if (aFlag !== bFlag) return bFlag - aFlag;
      return 0;
    });
  }, [leads]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [statusFilter, leads.length]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  const colSpan = showBellerColumn ? 10 : 9;

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
            {pageRows.map((lead) => (
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
                      <p className="font-medium text-ink">{lead.naam}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {adresRegel(lead)}
                        {lead.plaats ? ` · ${lead.plaats}` : ""}
                      </p>
                    </div>
                    {lead.terugbellen && (
                      <span className="shrink-0 rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                        Terugbellen
                      </span>
                    )}
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <PhoneCopyCell telefoon={lead.telefoon} />
                  </div>
                  {(() => {
                    const a = afspraakByLeadId.get(lead.id);
                    if (!a) return null;
                    const s = afspraakSamenvatting(
                      a,
                      adviseurNaamById.get(a.adviseur_id)
                    );
                    return (
                      <p className="text-[12px] text-ink">
                        <span className="font-semibold tabular-nums">
                          {s.when}
                        </span>
                        <span className="text-muted">
                          {" "}
                          · {s.soort}
                          {s.adviseur ? ` · ${s.adviseur}` : ""}
                        </span>
                      </p>
                    );
                  })()}
                  {showBellerColumn && onBellerChange && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Beller
                        <select
                          value={lead.beller_id || ""}
                          onChange={(e) =>
                            onBellerChange(
                              lead.id,
                              e.target.value ? e.target.value : null
                            )
                          }
                          className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-xs outline-none focus:border-green"
                        >
                          <option value="">Geen beller</option>
                          {bellers.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.naam}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  <div
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
        <PaginationBar
          page={page}
          pageCount={pageCount}
          total={rows.length}
          onPageChange={setPage}
        />
      </div>

      <div className="hidden md:block">
        <div className="overflow-x-auto">
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
                <th>Afspraak</th>
                {showBellerColumn && <th>Beller</th>}
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
                  <td colSpan={colSpan} className="!cursor-default">
                    {empty}
                  </td>
                </tr>
              ) : (
                pageRows.map((lead) => (
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <PhoneCopyCell telefoon={lead.telefoon} />
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {lead.email || "—"}
                    </td>
                    <td className="min-w-[9rem]">
                      {(() => {
                        const a = afspraakByLeadId.get(lead.id);
                        if (!a) {
                          return <span className="text-muted">—</span>;
                        }
                        const s = afspraakSamenvatting(
                          a,
                          adviseurNaamById.get(a.adviseur_id)
                        );
                        return (
                          <div className="leading-snug">
                            <p className="whitespace-nowrap font-medium tabular-nums text-ink">
                              {s.when}
                            </p>
                            <p className="truncate text-[11px] text-muted">
                              {s.soort}
                              {s.adviseur ? ` · ${s.adviseur}` : ""}
                            </p>
                          </div>
                        );
                      })()}
                    </td>
                    {showBellerColumn && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.beller_id || ""}
                          onChange={(e) =>
                            onBellerChange?.(
                              lead.id,
                              e.target.value ? e.target.value : null
                            )
                          }
                          className="max-w-[9rem] cursor-pointer border border-line bg-white px-2 py-1 text-xs outline-none focus:border-green"
                          aria-label="Beller toewijzen"
                          title={
                            bellers.length === 0
                              ? "Maak eerst een medewerker met rol Beller"
                              : "Wijs toe aan beller"
                          }
                        >
                          <option value="">—</option>
                          {bellers.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.naam}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
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
        <PaginationBar
          page={page}
          pageCount={pageCount}
          total={rows.length}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
