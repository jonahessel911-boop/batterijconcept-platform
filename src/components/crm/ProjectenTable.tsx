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
        <p className="text-sm text-muted">Nog geen projecten.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
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
              <td className="text-muted whitespace-nowrap">{p.monteur || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
