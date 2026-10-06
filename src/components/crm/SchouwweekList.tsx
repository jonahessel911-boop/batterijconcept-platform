"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Project } from "@/types/database";
import { adresRegel } from "@/lib/format";
import { normalizeProjectStatus, projectStatusLabel } from "@/lib/labels";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
  schouwWeekFromDate,
  schouwWeekValue,
} from "@/lib/schouw-week";

function leadOf(p: Project) {
  return Array.isArray(p.leads) ? p.leads[0] : p.leads;
}

function partnerOf(p: Project) {
  return Array.isArray(p.installatie_partners)
    ? p.installatie_partners[0]
    : p.installatie_partners;
}

function projectTitle(p: Project): string {
  const lead = leadOf(p);
  return p.titel?.trim() || lead?.naam || p.project_nummer || "Project";
}

/** Schouwweek gepland, maar nog geen definitieve schouwdag. */
export function isOpenstaandeSchouwweek(p: Project): boolean {
  if (normalizeProjectStatus(p.status) === "annulering") return false;
  if (!p.schouw_jaar || !p.schouw_week) return false;
  return !isSchouwdagDefinitief(p);
}

function weekSortKey(p: Project): string {
  if (p.schouw_jaar && p.schouw_week) {
    return schouwWeekValue(p.schouw_jaar, p.schouw_week);
  }
  if (p.schouw_at) {
    const { jaar, week } = schouwWeekFromDate(p.schouw_at);
    return schouwWeekValue(jaar, week);
  }
  return "9999-W99";
}

export function SchouwweekList({ projecten }: { projecten: Project[] }) {
  const rows = useMemo(() => {
    return projecten
      .filter(isOpenstaandeSchouwweek)
      .sort((a, b) => {
        const ka = weekSortKey(a);
        const kb = weekSortKey(b);
        if (ka !== kb) return ka.localeCompare(kb);
        return projectTitle(a).localeCompare(projectTitle(b), "nl");
      });
  }, [projecten]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Project[] }[] = [];
    let current: (typeof out)[number] | null = null;
    for (const p of rows) {
      const key = weekSortKey(p);
      const label = formatProjectSchouwWeek(p) || key;
      if (!current || current.key !== key) {
        current = { key, label, items: [] };
        out.push(current);
      }
      current.items.push(p);
    }
    return out;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="px-5 pb-5 pt-5">
        <p className="border border-line bg-white px-4 py-10 text-center text-sm text-muted">
          Geen openstaande schouwweken. Alle geplande schouwen hebben al een
          definitieve dag, of er is nog geen schouwweek gezet.
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 pb-5 pt-5">
      <p className="mb-3 text-sm text-muted">
        {rows.length}{" "}
        {rows.length === 1 ? "order" : "orders"} met schouwweek · nog geen
        definitieve schouwdag
      </p>
      <div className="border border-line bg-white">
        <div className="divide-y divide-line">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-line bg-[#FEF9C3] px-4 py-2.5">
                <p className="text-sm font-bold text-[#854D0E]">
                  {group.label}
                </p>
                <span className="text-xs font-semibold text-[#854D0E]/80">
                  {group.items.length}×
                </span>
              </div>
              <ul className="divide-y divide-line">
                {group.items.map((p) => {
                  const lead = leadOf(p);
                  const partner = partnerOf(p);
                  const adres = lead ? adresRegel(lead) : "";
                  const status = normalizeProjectStatus(p.status);
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/projecten/${p.id}?from=schouwweek`}
                        className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 hover:bg-wash"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">
                            {projectTitle(p)}
                          </p>
                          <p className="mt-0.5 font-mono text-xs text-muted">
                            {p.project_nummer}
                          </p>
                          {adres ? (
                            <p className="mt-1 text-sm text-muted">{adres}</p>
                          ) : lead?.plaats ? (
                            <p className="mt-1 text-sm text-muted">
                              {lead.plaats}
                            </p>
                          ) : null}
                          {partner?.naam ? (
                            <p className="mt-1 text-sm text-muted">
                              Installateur: {partner.naam}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#854D0E]">
                            Schouwweek
                          </p>
                          <p className="mt-1 text-sm font-medium text-muted">
                            {projectStatusLabel[status] || status}
                          </p>
                          {lead?.telefoon ? (
                            <p className="mt-1 text-sm tabular-nums text-ink">
                              {lead.telefoon}
                            </p>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
