"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project, ProjectTaak } from "@/types/database";
import { formatDateShort } from "@/lib/format";
import { projectStatusLabel, normalizeProjectStatus } from "@/lib/labels";
import { StatusBadge } from "./StatusBadge";

function openTakenCountByProject(taken: ProjectTaak[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of taken) {
    if (t.status === "done") continue;
    map.set(t.project_id, (map.get(t.project_id) || 0) + 1);
  }
  return map;
}

export function BackofficeTable({
  projecten,
}: {
  projecten: Project[];
  adviseurs?: unknown[];
  facturen?: unknown[];
  onProjectUpdated?: (project: Project) => void;
}) {
  const router = useRouter();
  const [taken, setTaken] = useState<ProjectTaak[]>([]);
  const [loadingTaken, setLoadingTaken] = useState(true);

  const loadTaken = useCallback(async () => {
    setLoadingTaken(true);
    try {
      const res = await fetch("/api/taken?open=1");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setTaken((data.taken as ProjectTaak[]) || []);
    } catch {
      /* ignore */
    } finally {
      setLoadingTaken(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadTaken());
    return () => cancelAnimationFrame(frame);
  }, [loadTaken]);

  const openByProject = useMemo(
    () => openTakenCountByProject(taken),
    [taken]
  );

  const withOpenTaak = useMemo(
    () => projecten.filter((p) => (openByProject.get(p.id) || 0) > 0).length,
    [projecten, openByProject]
  );

  function openProject(id: string) {
    router.push(`/projecten/${id}?from=orders`);
  }

  if (projecten.length === 0) {
    return (
      <div className="mx-5 mb-5 border border-line bg-white px-6 py-14 text-center">
        <p className="text-sm text-muted">Nog geen projecten in de backoffice.</p>
      </div>
    );
  }

  return (
    <div className="mx-5 mb-5 space-y-3">
      <p className="text-sm text-muted">
        {projecten.length} project
        {projecten.length === 1 ? "" : "en"}
        {!loadingTaken && withOpenTaak > 0
          ? ` · ${withOpenTaak} met openstaande taak`
          : ""}
      </p>

      {/* Mobile */}
      <div className="flex flex-col gap-2 md:hidden">
        {projecten.map((p) => {
          const openCount = openByProject.get(p.id) || 0;
          return (
            <article
              key={p.id}
              className="border border-line bg-white px-4 py-3"
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => openProject(p.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {p.leads?.naam || p.titel || "—"}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] font-semibold text-green-dark">
                      {p.project_nummer}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {openCount > 0 ? (
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center border border-[#1A4A6E] bg-[#E8F0F6] text-sm font-bold text-[#1A4A6E]"
                        title={`${openCount} openstaande taak${openCount === 1 ? "" : "en"}`}
                        aria-label="Openstaande taak — open project"
                      >
                        I
                      </span>
                    ) : null}
                    <StatusBadge kind="project" value={p.status} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {projectStatusLabel[normalizeProjectStatus(p.status)] ||
                    p.status}
                  {p.installatie_partners?.naam
                    ? ` · ${p.installatie_partners.naam}`
                    : p.monteur
                      ? ` · ${p.monteur}`
                      : ""}
                </p>
              </button>
            </article>
          );
        })}
      </div>

      {/* Desktop */}
      <div className="hidden overflow-x-auto border border-line bg-white md:block">
        <table className="crm-table w-full">
          <thead>
            <tr>
              <th className="w-14">Actie</th>
              <th>Project</th>
              <th>Klant</th>
              <th>Status</th>
              <th>Installateur</th>
              <th>Start</th>
            </tr>
          </thead>
          <tbody>
            {projecten.map((p) => {
              const openCount = openByProject.get(p.id) || 0;
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => openProject(p.id)}
                >
                  <td className="whitespace-nowrap">
                    {openCount > 0 ? (
                      <button
                        type="button"
                        title={`${openCount} openstaande taak${openCount === 1 ? "" : "en"} — open project`}
                        aria-label="Openstaande taak — open project"
                        onClick={(e) => {
                          e.stopPropagation();
                          openProject(p.id);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center border border-[#1A4A6E] bg-[#E8F0F6] text-sm font-bold text-[#1A4A6E] hover:bg-[#d5e4ef]"
                      >
                        I
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="font-mono text-[11px] font-semibold text-green-dark whitespace-nowrap">
                    {p.project_nummer}
                  </td>
                  <td className="font-medium whitespace-nowrap">
                    {p.leads?.naam || "—"}
                    {p.leads?.lead_number ? (
                      <Link
                        href={`/leads/${p.lead_id}`}
                        className="mt-0.5 block font-mono text-[10px] font-normal text-muted hover:text-green-dark hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.leads.lead_number}
                      </Link>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge kind="project" value={p.status} />
                  </td>
                  <td className="text-sm text-ink whitespace-nowrap">
                    {p.installatie_partners?.naam || p.monteur || "—"}
                  </td>
                  <td className="text-muted whitespace-nowrap">
                    {formatDateShort(p.startdatum)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
