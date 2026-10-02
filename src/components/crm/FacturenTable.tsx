"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Factuur } from "@/types/database";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort, formatEuro } from "@/lib/format";
import { factuurIsOverdue } from "@/lib/factuur-betaling";
import { rememberCrmReturnUrl } from "./DetailChrome";

type StatusFilter = "actief" | "alles" | "betaald" | "open" | "concept";

function isCreditFactuur(f: Factuur): boolean {
  return Boolean(f.credit_van_factuur_id);
}

/** BTW-teken: credits verminderen ontvangen BTW. */
function btwSigned(f: Factuur): number {
  const btw = Number(f.btw_bedrag) || 0;
  return isCreditFactuur(f) ? -Math.abs(btw) : btw;
}

export function FacturenTable({ facturen }: { facturen: Factuur[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("actief");

  function openFactuur(id: string) {
    rememberCrmReturnUrl();
    router.push(`/facturen/${id}`);
  }

  const filtered = useMemo(() => {
    // Creditfacturen staan onder de oorspronkelijke factuur — niet als aparte rij
    const base = facturen.filter((f) => !isCreditFactuur(f));
    switch (filter) {
      case "actief":
        return base.filter((f) => f.status !== "concept");
      case "betaald":
        return base.filter((f) => f.status === "betaald");
      case "open":
        return base.filter(
          (f) => f.status === "verzonden" || f.status === "deels_betaald"
        );
      case "concept":
        return base.filter((f) => f.status === "concept");
      default:
        return base;
    }
  }, [facturen, filter]);

  const creditsByParent = useMemo(() => {
    const map = new Map<string, Factuur[]>();
    for (const f of facturen) {
      if (!f.credit_van_factuur_id) continue;
      const list = map.get(f.credit_van_factuur_id) || [];
      list.push(f);
      map.set(f.credit_van_factuur_id, list);
    }
    return map;
  }, [facturen]);

  const overview = useMemo(() => {
    let ontvangenBtw = 0;
    let openstaandeBtw = 0;
    let betaaldInc = 0;
    let openstaandInc = 0;
    let betaaldCount = 0;
    let openCount = 0;

    for (const f of facturen) {
      if (f.status === "concept" || f.status === "vervallen") continue;
      const btw = btwSigned(f);
      const inc = isCreditFactuur(f)
        ? -Math.abs(Number(f.bedrag_inc_btw) || 0)
        : Number(f.bedrag_inc_btw) || 0;

      if (f.status === "betaald") {
        ontvangenBtw += btw;
        betaaldInc += inc;
        betaaldCount += 1;
      } else if (f.status === "verzonden" || f.status === "deels_betaald") {
        openstaandeBtw += btw;
        openstaandInc += inc;
        openCount += 1;
      }
    }

    return {
      ontvangenBtw,
      openstaandeBtw,
      betaaldInc,
      openstaandInc,
      betaaldCount,
      openCount,
    };
  }, [facturen]);

  const conceptCount = facturen.filter(
    (f) => f.status === "concept" && !isCreditFactuur(f)
  ).length;

  const filters: { id: StatusFilter; label: string }[] = [
    { id: "actief", label: "Zonder concepten" },
    { id: "open", label: "Openstaand" },
    { id: "betaald", label: "Betaald" },
    {
      id: "concept",
      label: `Concepten${conceptCount ? ` (${conceptCount})` : ""}`,
    },
    { id: "alles", label: "Alles" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {[
          {
            label: "Ontvangen BTW",
            value: formatEuro(overview.ontvangenBtw),
            hint: `${overview.betaaldCount} betaald`,
            accent: true,
          },
          {
            label: "Openstaande BTW",
            value: formatEuro(overview.openstaandeBtw),
            hint: `${overview.openCount} open`,
          },
          {
            label: "Betaald (inc. btw)",
            value: formatEuro(overview.betaaldInc),
            hint: null,
          },
          {
            label: "Openstaand (inc. btw)",
            value: formatEuro(overview.openstaandInc),
            hint: null,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {kpi.label}
            </p>
            <p
              className={[
                "mt-0.5 font-display text-lg font-semibold tabular-nums",
                kpi.accent ? "text-green-deeper" : "text-ink",
              ].join(" ")}
            >
              {kpi.value}
            </p>
            {kpi.hint ? (
              <p className="mt-0.5 text-[10px] text-muted">{kpi.hint}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={[
              "px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === f.id
                ? "bg-green text-white"
                : "border border-line bg-white text-muted hover:text-ink",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
        <p className="ml-auto text-xs text-muted">
          {filtered.length} van {facturen.length}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm text-muted">
            {facturen.length === 0
              ? "Nog geen facturen."
              : "Geen facturen voor dit filter."}
          </p>
        </div>
      ) : (
        <>
          <div className="crm-card-list flex md:hidden">
            {filtered.map((f) => {
              const overdue = factuurIsOverdue(f);
              return (
                <article
                  key={f.id}
                  className={[
                    "crm-card",
                    overdue ? "border-[#C45A12]/50 bg-[#FFF0E6]" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openFactuur(f.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          {f.leads?.naam || "—"}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] font-semibold text-green-dark">
                          {f.factuur_nummer}
                          {(creditsByParent.get(f.id) || []).length > 0
                            ? " · Creditfactuur"
                            : ""}
                        </p>
                      </div>
                      <StatusBadge kind="factuur" value={f.status} />
                    </div>
                    <p className="mt-2 text-sm font-medium text-ink">
                      {formatEuro(f.bedrag_inc_btw)}
                      <span className="ml-2 text-xs font-normal text-muted">
                        BTW {formatEuro(f.btw_bedrag)}
                      </span>
                    </p>
                    <p
                      className={[
                        "mt-0.5 truncate text-xs",
                        overdue ? "font-semibold text-[#C45A12]" : "text-muted",
                      ].join(" ")}
                    >
                      {f.omschrijving || "Geen omschrijving"} ·{" "}
                      {formatDateShort(f.factuurdatum)}
                      {f.status === "betaald" && f.betaald_op
                        ? ` · Betaald ${formatDateShort(f.betaald_op)}`
                        : ""}
                      {overdue ? " · Verlopen" : ""}
                    </p>
                  </button>
                  <Link
                    href={`/leads/${f.lead_id}`}
                    className="mt-2 inline-block font-mono text-[11px] text-muted underline-offset-2 hover:text-green-dark hover:underline"
                  >
                    {f.leads?.lead_number || "Lead"}
                  </Link>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Factuur</th>
                  <th>Lead ID</th>
                  <th>Klant</th>
                  <th>Omschrijving</th>
                  <th>Status</th>
                  <th>Bedrag</th>
                  <th>BTW</th>
                  <th>Factuurdatum</th>
                  <th>Vervaldatum</th>
                  <th>Betaald op</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const overdue = factuurIsOverdue(f);
                  return (
                    <tr
                      key={f.id}
                      className={[
                        "cursor-pointer",
                        overdue ? "bg-[#FFF0E6]" : "",
                      ].join(" ")}
                      onClick={() => openFactuur(f.id)}
                    >
                      <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-green-dark">
                        {f.factuur_nummer}
                        {(creditsByParent.get(f.id) || []).length > 0 ? (
                          <span className="ml-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                            Creditfactuur
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap">
                        <Link
                          href={`/leads/${f.lead_id}`}
                          className="font-mono text-[11px] text-muted hover:text-green-dark hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {f.leads?.lead_number || f.lead_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap font-medium">
                        {f.leads?.naam || "—"}
                      </td>
                      <td className="max-w-[180px] truncate text-muted">
                        {f.omschrijving || "—"}
                      </td>
                      <td>
                        <StatusBadge kind="factuur" value={f.status} />
                      </td>
                      <td className="whitespace-nowrap font-medium">
                        {formatEuro(f.bedrag_inc_btw)}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-muted">
                        {formatEuro(f.btw_bedrag)}
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {formatDateShort(f.factuurdatum)}
                      </td>
                      <td
                        className={[
                          "whitespace-nowrap",
                          overdue
                            ? "font-semibold text-[#C45A12]"
                            : "text-muted",
                        ].join(" ")}
                      >
                        {formatDateShort(f.vervaldatum)}
                        {overdue ? " · Verlopen" : ""}
                      </td>
                      <td
                        className={[
                          "whitespace-nowrap",
                          f.status === "betaald" && f.betaald_op
                            ? "font-medium text-green-deeper"
                            : "text-muted",
                        ].join(" ")}
                      >
                        {f.status === "betaald" && f.betaald_op
                          ? formatDateShort(f.betaald_op)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
