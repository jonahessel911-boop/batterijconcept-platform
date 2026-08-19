"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project } from "@/types/database";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort } from "@/lib/format";

export function ProjectenTable({ projecten }: { projecten: Project[] }) {
  const router = useRouter();

  if (projecten.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Nog geen backoffice items.</p>
      </div>
    );
  }

  return (
    <>
      <div className="crm-card-list flex md:hidden">
        {projecten.map((p) => (
          <article key={p.id} className="crm-card">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => router.push(`/projecten/${p.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{p.leads?.naam || "—"}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-semibold text-green-dark">
                    {p.project_nummer}
                  </p>
                </div>
                <StatusBadge kind="project" value={p.status} />
              </div>
              <p className="mt-2 text-sm text-ink">{p.titel || "Geen titel"}</p>
              <p className="mt-1 text-xs text-muted">
                Start {formatDateShort(p.startdatum)}
                {p.monteur ? ` · ${p.monteur}` : ""}
              </p>
            </button>
            <Link
              href={`/leads/${p.lead_id}`}
              className="mt-2 inline-block font-mono text-[11px] text-muted underline-offset-2 hover:text-green-dark hover:underline"
            >
              {p.leads?.lead_number || "Lead"}
            </Link>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Lead ID</th>
              <th>Klant</th>
              <th>Titel</th>
              <th>Status</th>
              <th>Start</th>
              <th>Oplevering</th>
              <th>Monteur</th>
            </tr>
          </thead>
          <tbody>
            {projecten.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer"
                onClick={() => router.push(`/projecten/${p.id}`)}
              >
                <td className="font-mono text-[11px] font-semibold text-green-dark whitespace-nowrap">
                  {p.project_nummer}
                </td>
                <td className="whitespace-nowrap">
                  <Link
                    href={`/leads/${p.lead_id}`}
                    className="font-mono text-[11px] text-muted hover:text-green-dark hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.leads?.lead_number || p.lead_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="font-medium whitespace-nowrap">
                  {p.leads?.naam || "—"}
                </td>
                <td className="whitespace-nowrap">{p.titel || "—"}</td>
                <td>
                  <StatusBadge kind="project" value={p.status} />
                </td>
                <td className="text-muted whitespace-nowrap">
                  {formatDateShort(p.startdatum)}
                </td>
                <td className="text-muted whitespace-nowrap">
                  {formatDateShort(p.opleverdatum)}
                </td>
                <td className="text-muted whitespace-nowrap">
                  {p.monteur || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
