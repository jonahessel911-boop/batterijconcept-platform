"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ServiceVerzoek } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";
import {
  dagenOpen,
  SERVICE_TICKET_STATUS_CLASS,
  SERVICE_TICKET_STATUS_LABEL,
  serviceTicketDisplayStatus,
} from "@/lib/service-verzoek-ui";

type Filter = "open" | "afgehandeld" | "alles";

export function ServiceVerzoekenPanel() {
  const router = useRouter();
  const [verzoeken, setVerzoeken] = useState<ServiceVerzoek[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/service-verzoeken");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setVerzoeken((data.verzoeken as ServiceVerzoek[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setVerzoeken([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return verzoeken.filter((v) => {
      if (filter === "open" && v.status !== "open") return false;
      if (filter === "afgehandeld" && v.status !== "afgehandeld") return false;
      if (!needle) return true;
      const hay = [
        v.onderwerp,
        v.omschrijving,
        v.klant_email,
        v.leads?.naam,
        v.leads?.lead_number,
        v.leads?.plaats,
        v.leads?.telefoon,
        v.projecten?.project_nummer,
        v.projecten?.titel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [verzoeken, filter, q]);

  const counts = useMemo(() => {
    const open = verzoeken.filter((v) => v.status === "open");
    return {
      open: open.length,
      urgent: open.filter((v) => dagenOpen(v.created_at) >= 3).length,
      gepland: open.filter((v) => Boolean(v.projecten?.service_at)).length,
      afgehandeld: verzoeken.filter((v) => v.status === "afgehandeld").length,
      alles: verzoeken.length,
    };
  }, [verzoeken]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border border-line bg-white">
          {(
            [
              ["open", "Open", counts.open],
              ["afgehandeld", "Afgehandeld", counts.afgehandeld],
              ["alles", "Alles", counts.alles],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={[
                "px-3.5 py-2 text-xs font-semibold",
                filter === id
                  ? "bg-[#0a4727] text-white"
                  : "text-muted hover:bg-wash hover:text-ink",
              ].join(" ")}
            >
              {label}
              <span
                className={[
                  "ml-1.5 tabular-nums",
                  filter === id ? "text-white/70" : "text-muted",
                ].join(" ")}
              >
                {n}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.urgent > 0 ? (
            <span className="text-xs font-semibold text-[#C45A12]">
              {counts.urgent} urgent
            </span>
          ) : null}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek klant, project, plaats…"
            className="w-full max-w-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green sm:w-72"
          />
        </div>
      </div>

      {error ? (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto border border-line bg-white">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-wash/60 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-semibold">Ticket</th>
              <th className="px-3 py-3 font-semibold">Klant</th>
              <th className="px-3 py-3 font-semibold">Project</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Service</th>
              <th className="px-3 py-3 font-semibold">Aangemaakt</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-16 text-center text-sm text-muted"
                >
                  Laden…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-16 text-center text-sm text-muted"
                >
                  {filter === "open"
                    ? "Geen open tickets."
                    : "Geen tickets in deze filter."}
                </td>
              </tr>
            ) : (
              filtered.map((v) => {
                const status = serviceTicketDisplayStatus(v);
                const href = `/service/${v.id}`;
                return (
                  <tr
                    key={v.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(href);
                      }
                    }}
                    className="cursor-pointer border-b border-line last:border-b-0 hover:bg-wash/50"
                  >
                    <td className="max-w-[18rem] px-4 py-3">
                      <Link
                        href={href}
                        className="font-semibold text-ink hover:text-green-dark hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v.onderwerp}
                      </Link>
                      {v.omschrijving?.trim() ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                          {v.omschrijving.trim()}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-ink">{v.leads?.naam || "—"}</p>
                      <p className="text-xs text-muted">
                        {[v.leads?.plaats, v.leads?.telefoon]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">
                      {v.projecten?.project_nummer || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={[
                          "inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          SERVICE_TICKET_STATUS_CLASS[status],
                        ].join(" ")}
                      >
                        {SERVICE_TICKET_STATUS_LABEL[status]}
                        {status === "urgent"
                          ? ` · ${dagenOpen(v.created_at)}d`
                          : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
                      {v.projecten?.service_at
                        ? formatDateTimeNl(v.projecten.service_at)
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
                      {formatDateTimeNl(v.created_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
