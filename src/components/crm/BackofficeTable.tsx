"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Adviseur,
  Afspraak,
  Factuur,
  Lead,
  Project,
  ProjectStatus,
  ProjectTaak,
} from "@/types/database";
import { formatDateShort, formatTimeNl } from "@/lib/format";
import {
  normalizeProjectStatus,
  PROJECT_STATUSES,
  projectStatusLabel,
} from "@/lib/labels";
import { openBackofficeActies } from "@/lib/backoffice-acties";
import { formatInTimeZone } from "date-fns-tz";
import { isToday, isYesterday, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import { ProjectStatusSelect } from "./ProjectStatusSelect";
import { rememberCrmReturnUrl } from "./DetailChrome";

const PAGE_SIZE = 10;

function leadAdres(p: Project): string {
  const l = p.leads;
  if (!l) return "";
  const straat = [l.straat, l.huisnummer, l.toevoeging]
    .filter(Boolean)
    .join(" ")
    .trim();
  const plaats = [l.postcode, l.plaats].filter(Boolean).join(" ").trim();
  return [straat, plaats].filter(Boolean).join(", ");
}

function projectNaam(p: Project): string {
  return (
    p.titel?.trim() ||
    p.leads?.naam?.trim() ||
    p.project_nummer ||
    "Project"
  );
}

function datumbereik(p: Project): string {
  const start = p.startdatum ? formatDateShort(p.startdatum) : null;
  const eind = p.opleverdatum ? formatDateShort(p.opleverdatum) : null;
  if (start && eind && start !== "—" && eind !== "—") {
    return `${start} – ${eind}`;
  }
  if (p.schouw_at && p.installatie_at) {
    return `${formatDateShort(p.schouw_at)} – ${formatDateShort(p.installatie_at)}`;
  }
  if (p.schouw_at) return formatDateShort(p.schouw_at);
  if (p.installatie_at) return formatDateShort(p.installatie_at);
  if (p.schouw_jaar && p.schouw_week) {
    return `Week ${p.schouw_week} · ${p.schouw_jaar}`;
  }
  if (start && start !== "—") return start;
  return "—";
}

function initials(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function lidNamen(p: Project): { naam: string; rol: string }[] {
  const out: { naam: string; rol: string }[] = [];
  const adv = p.leads?.adviseurs;
  const a = Array.isArray(adv) ? adv[0] : adv;
  if (a?.naam) out.push({ naam: a.naam, rol: "Sales" });
  const v = Array.isArray(p.verantwoordelijke)
    ? p.verantwoordelijke[0]
    : p.verantwoordelijke;
  if (v?.naam) out.push({ naam: v.naam, rol: "Backoffice" });
  if (p.installatie_partners?.naam) {
    out.push({ naam: p.installatie_partners.naam, rol: "Installateur" });
  } else if (p.monteur?.trim()) {
    out.push({ naam: p.monteur.trim(), rol: "Installateur" });
  }
  return out;
}

function lidNaam(p: Project): string | null {
  return lidNamen(p)[0]?.naam || null;
}

function bijgewerktLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? parseISO(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const tijd = formatTimeNl(d);
  if (isToday(d)) return `Vandaag · ${tijd}`;
  if (isYesterday(d)) return `Gisteren · ${tijd}`;
  return `${formatInTimeZone(d, "Europe/Amsterdam", "dd-MM-yyyy", { locale: nl })} · ${tijd}`;
}

function avatarTone(naam: string): string {
  let h = 0;
  for (let i = 0; i < naam.length; i++) h = (h + naam.charCodeAt(i) * 17) % 5;
  const tones = [
    "bg-[#EDE7F6] text-[#5E35B1]",
    "bg-[#E3F2FD] text-[#1565C0]",
    "bg-[#E8F5E9] text-[#2E7D32]",
    "bg-[#FFF3E0] text-[#E65100]",
    "bg-[#FCE4EC] text-[#C2185B]",
  ];
  return tones[h];
}

type ActiefFilter = "actief" | "afgerond" | "alles" | "actie_vereist" | "annuleringen";

function ActieIcon({ title }: { title?: string }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base font-bold leading-none text-[#C62828]"
      title={title || "Openstaande actie"}
      aria-label={title || "Openstaande actie"}
    >
      !
    </span>
  );
}

export function BackofficeTable({
  projecten,
  adviseurs = [],
  facturen = [],
  leads = [],
  afspraken = [],
  onProjectUpdated,
  hideTitle = false,
}: {
  projecten: Project[];
  adviseurs?: Adviseur[];
  facturen?: Factuur[];
  leads?: Lead[];
  afspraken?: Afspraak[];
  onProjectUpdated?: (project: Project) => void;
  /** Titel staat al in BackofficePanel-subnav. */
  hideTitle?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [actief, setActief] = useState<ActiefFilter>("actief");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [medewerkerId, setMedewerkerId] = useState("");
  const [datumFilter, setDatumFilter] = useState<
    "" | "deze_week" | "deze_maand" | "gepland"
  >("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [openTaken, setOpenTaken] = useState<ProjectTaak[]>([]);

  const loadTaken = useCallback(async () => {
    try {
      const res = await fetch("/api/taken?open=1");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setOpenTaken((data.taken as ProjectTaak[]) || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadTaken());
    return () => cancelAnimationFrame(frame);
  }, [loadTaken]);

  const projectIdsWithActie = useMemo(() => {
    const ids = new Set<string>();
    for (const t of openTaken) {
      if (t.project_id) ids.add(t.project_id);
    }
    for (const a of openBackofficeActies(projecten, facturen, new Date(), {
      leads,
      afspraken,
    })) {
      if (a.projectId) ids.add(a.projectId);
    }
    return ids;
  }, [openTaken, projecten, facturen, leads, afspraken]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = projecten.filter((p) => {
      const st = normalizeProjectStatus(p.status);
      if (actief === "annuleringen") {
        if (st !== "annulering") return false;
      } else if (st === "annulering" && actief !== "alles") {
        // Actief / afgerond / actie: geen geannuleerde orders
        return false;
      } else if (
        actief === "actief" &&
        (st === "installatie_voltooid" || st === "service")
      ) {
        return false;
      } else if (
        actief === "afgerond" &&
        st !== "installatie_voltooid" &&
        st !== "service"
      ) {
        return false;
      } else if (
        actief === "actie_vereist" &&
        !projectIdsWithActie.has(p.id)
      ) {
        return false;
      }
      if (statusFilter && st !== statusFilter) return false;

      if (medewerkerId) {
        if (
          p.verantwoordelijke_id !== medewerkerId &&
          p.leads?.adviseur_id !== medewerkerId
        ) {
          return false;
        }
      }

      if (datumFilter === "gepland") {
        if (
          !p.startdatum &&
          !p.schouw_at &&
          !p.installatie_at &&
          !p.schouw_week
        ) {
          return false;
        }
      } else if (datumFilter === "deze_maand" || datumFilter === "deze_week") {
        const ref = p.updated_at || p.created_at;
        if (!ref) return false;
        const d = new Date(ref);
        const now = new Date();
        if (datumFilter === "deze_maand") {
          if (
            d.getMonth() !== now.getMonth() ||
            d.getFullYear() !== now.getFullYear()
          ) {
            return false;
          }
        } else {
          const start = new Date(now);
          start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setDate(start.getDate() + 7);
          if (d < start || d >= end) return false;
        }
      }

      if (!needle) return true;
      const hay = [
        projectNaam(p),
        p.project_nummer,
        p.leads?.naam,
        leadAdres(p),
        p.installatie_partners?.naam,
        p.monteur,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });

    list = [...list].sort((a, b) => {
      const ta = new Date(a.created_at).getTime() || 0;
      const tb = new Date(b.created_at).getTime() || 0;
      if (ta !== tb) return sortDir === "desc" ? tb - ta : ta - tb;
      return sortDir === "desc"
        ? (b.project_nummer || "").localeCompare(a.project_nummer || "")
        : (a.project_nummer || "").localeCompare(b.project_nummer || "");
    });
    return list;
  }, [
    projecten,
    q,
    actief,
    statusFilter,
    medewerkerId,
    datumFilter,
    sortDir,
    projectIdsWithActie,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage(1);
  }, [q, actief, statusFilter, medewerkerId, datumFilter, sortDir]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function openProject(id: string) {
    rememberCrmReturnUrl();
    router.push(`/projecten/${id}?from=orders`);
  }

  const filterBtn =
    "inline-flex items-center gap-1.5 border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-wash";

  function projectHref(id: string) {
    return `/projecten/${id}?from=orders`;
  }

  const actieCount = filtered.filter((p) => projectIdsWithActie.has(p.id)).length;

  return (
    <div className="mx-5 mb-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hideTitle ? (
          <span />
        ) : (
          <h2 className="font-display text-xl font-semibold text-ink">
            Projecten
          </h2>
        )}
        <button
          type="button"
          onClick={() => router.push("/?tab=offertes")}
          className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
          title="Projecten ontstaan bij ondertekende offertes"
        >
          Nieuw project
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            ⌕
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoeken op naam, adres, …"
            className="w-full border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-green"
          />
        </label>

        <select
          value={actief}
          onChange={(e) => setActief(e.target.value as ActiefFilter)}
          className={filterBtn}
          aria-label="Filter actief"
        >
          <option value="actief">Actief</option>
          <option value="actie_vereist">Actie vereist</option>
          <option value="afgerond">Afgerond</option>
          <option value="annuleringen">Annuleringen</option>
          <option value="alles">Alles</option>
        </select>

        <select
          value={datumFilter}
          onChange={(e) =>
            setDatumFilter(e.target.value as typeof datumFilter)
          }
          className={filterBtn}
          aria-label="Filter datum"
        >
          <option value="">Datum</option>
          <option value="deze_week">Deze week</option>
          <option value="deze_maand">Deze maand</option>
          <option value="gepland">Heeft planning</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as ProjectStatus | "")
          }
          className={filterBtn}
          aria-label="Filter status"
        >
          <option value="">Status</option>
          {PROJECT_STATUSES.map((st) => (
            <option key={st} value={st}>
              {projectStatusLabel[st]}
            </option>
          ))}
        </select>

        <select
          value={medewerkerId}
          onChange={(e) => setMedewerkerId(e.target.value)}
          className={filterBtn}
          aria-label="Filter medewerkers"
        >
          <option value="">Medewerkers</option>
          {adviseurs
            .filter((a) => a.actief !== false)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.naam}
              </option>
            ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-line bg-white px-6 py-14 text-center">
          <p className="text-sm text-muted">
            {projecten.length === 0
              ? "Nog geen projecten in de backoffice."
              : "Geen projecten voor deze filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden border border-line bg-white">
          {/* Mobile */}
          <div className="divide-y divide-line md:hidden">
            {pageRows.map((p) => {
              const leden = lidNamen(p);
              const hasActie = projectIdsWithActie.has(p.id);
              return (
                <div
                  key={p.id}
                  role="link"
                  tabIndex={0}
                  className="flex w-full cursor-pointer flex-col gap-2 px-4 py-3 text-left"
                  onClick={() => openProject(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openProject(p.id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold text-ink">
                        {hasActie ? <ActieIcon /> : null}
                        <span className="truncate">{projectNaam(p)}</span>
                      </p>
                      <p className="truncate text-xs text-muted">
                        {leadAdres(p) || "—"}
                      </p>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <ProjectStatusSelect
                        project={p}
                        onUpdated={onProjectUpdated}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    {p.leads?.naam || "—"} · {datumbereik(p)}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <span>{bijgewerktLabel(p.created_at)}</span>
                    {leden.length ? (
                      <span className="flex -space-x-1">
                        {leden.map((m) => (
                          <span
                            key={`${m.rol}-${m.naam}`}
                            title={`${m.rol}: ${m.naam}`}
                            className={[
                              "inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ring-1 ring-white",
                              avatarTone(m.naam),
                            ].join(" ")}
                          >
                            {initials(m.naam)}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-semibold normal-case tracking-normal text-ink">
                    Naam
                  </th>
                  <th className="px-3 py-3 font-semibold normal-case tracking-normal text-ink">
                    Nummer
                  </th>
                  <th className="px-3 py-3 font-semibold normal-case tracking-normal text-ink">
                    Status
                  </th>
                  <th className="px-3 py-3 font-semibold normal-case tracking-normal text-ink">
                    Datumbereik
                  </th>
                  <th className="px-3 py-3 font-semibold normal-case tracking-normal text-ink">
                    Klant
                  </th>
                  <th className="px-3 py-3 font-semibold normal-case tracking-normal text-ink">
                    Leden
                  </th>
                  <th className="px-3 py-3 font-semibold normal-case tracking-normal text-ink">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-green-dark"
                      onClick={() =>
                        setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                      }
                    >
                      Aangemaakt {sortDir === "desc" ? "↓" : "↑"}
                    </button>
                  </th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const lid = lidNaam(p);
                  const leden = lidNamen(p);
                  const adres = leadAdres(p);
                  const hasActie = projectIdsWithActie.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-b border-line last:border-b-0 hover:bg-wash/50"
                      onClick={() => openProject(p.id)}
                    >
                      <td className="max-w-[16rem] px-4 py-3">
                        <Link
                          href={projectHref(p.id)}
                          className="block min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="flex items-center gap-1.5 font-semibold text-ink hover:text-green-dark hover:underline">
                            {hasActie ? <ActieIcon /> : null}
                            <span className="truncate">{projectNaam(p)}</span>
                          </p>
                          <p className="truncate text-xs text-muted">
                            {adres || "—"}
                          </p>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">
                        {p.project_nummer || "—"}
                      </td>
                      <td
                        className="px-3 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ProjectStatusSelect
                          project={p}
                          onUpdated={onProjectUpdated}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink">
                        {datumbereik(p)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink">
                        {p.leads?.naam || "—"}
                      </td>
                      <td className="px-3 py-3">
                        {leden.length ? (
                          <div className="flex -space-x-1.5">
                            {leden.map((m) => (
                              <span
                                key={`${m.rol}-${m.naam}`}
                                title={`${m.rol}: ${m.naam}`}
                                className={[
                                  "inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-white",
                                  avatarTone(m.naam),
                                ].join(" ")}
                              >
                                {initials(m.naam)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="whitespace-nowrap font-medium text-ink">
                          {bijgewerktLabel(p.created_at)}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {lid || "—"}
                        </p>
                      </td>
                      <td
                        className="relative px-2 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="px-2 py-1 text-muted hover:text-ink"
                          aria-label="Acties"
                          onClick={() =>
                            setMenuId((id) => (id === p.id ? null : p.id))
                          }
                        >
                          ⋮
                        </button>
                        {menuId === p.id ? (
                          <div className="absolute right-2 z-20 mt-1 min-w-[9rem] border border-line bg-white py-1 shadow-md">
                            <button
                              type="button"
                              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-wash"
                              onClick={() => {
                                setMenuId(null);
                                openProject(p.id);
                              }}
                            >
                              Openen
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sm text-muted">
              {filtered.length} project{filtered.length === 1 ? "" : "en"}
              {actieCount > 0
                ? ` · ${actieCount} met openstaande actie`
                : ""}
              {pageCount > 1
                ? ` · pagina ${safePage} / ${pageCount}`
                : ""}
            </p>
            {pageCount > 1 ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="min-h-8 border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Vorige
                </button>
                <span className="px-1 text-xs tabular-nums text-muted">
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  className="min-h-8 border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Volgende
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
