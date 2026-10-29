"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Factuur, Project } from "@/types/database";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort, formatEuro } from "@/lib/format";
import {
  factuurBtwBuckets,
  factuurDisplayStatus,
  factuurIsOverdue,
} from "@/lib/factuur-betaling";
import {
  factuurSoortHint,
  factuurSoortLabel,
  factuurSoortTone,
  isFactuurWfLaterBetaald,
  isWarmtefondsFactuurContext,
  resolveFactuurSoort,
} from "@/lib/factuur-soort";
import { rememberCrmReturnUrl } from "./DetailChrome";

type StatusFilter = "actief" | "alles" | "betaald" | "open" | "concept";

type BtwKwartaal = {
  key: string;
  jaar: number;
  kwartaal: number;
  label: string;
  btw: number;
  count: number;
};

function isCreditFactuur(f: Factuur): boolean {
  return Boolean(f.credit_van_factuur_id);
}

/** Amsterdam-kalenderdag → ISO yyyy-mm-dd. */
function factuurDayAms(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) {
    const s = String(iso).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function kwartaalVanDag(day: string): { jaar: number; kwartaal: number } | null {
  const m = day.match(/^(\d{4})-(\d{2})-/);
  if (!m) return null;
  const jaar = Number(m[1]);
  const maand = Number(m[2]);
  if (!jaar || !(maand >= 1 && maand <= 12)) return null;
  return { jaar, kwartaal: Math.ceil(maand / 3) };
}

function currentKwartaalKey(now = new Date()): string {
  const day = factuurDayAms(now.toISOString());
  if (!day) return "";
  const k = kwartaalVanDag(day);
  return k ? `${k.jaar}-Q${k.kwartaal}` : "";
}

export function FacturenTable({
  facturen,
  projecten = [],
  /** BTW-/betalings-KPI's alleen voor admin */
  showFinanceKpis = false,
}: {
  facturen: Factuur[];
  /** Voor WF/EM-soortbadges */
  projecten?: Project[];
  showFinanceKpis?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("actief");
  const [search, setSearch] = useState("");

  function openFactuur(id: string) {
    rememberCrmReturnUrl();
    router.push(`/facturen/${id}`);
  }

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projecten) map.set(p.id, p);
    return map;
  }, [projecten]);

  const projectByOfferte = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projecten) {
      if (p.offerte_id) map.set(p.offerte_id, p);
    }
    return map;
  }, [projecten]);

  const projectByLead = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projecten) {
      if (p.lead_id && !map.has(p.lead_id)) map.set(p.lead_id, p);
    }
    return map;
  }, [projecten]);

  function projectVoorFactuur(f: Factuur): Project | null {
    if (f.project_id && projectById.has(f.project_id)) {
      return projectById.get(f.project_id) || null;
    }
    if (f.offerte_id && projectByOfferte.has(f.offerte_id)) {
      return projectByOfferte.get(f.offerte_id) || null;
    }
    if (f.lead_id && projectByLead.has(f.lead_id)) {
      return projectByLead.get(f.lead_id) || null;
    }
    return null;
  }

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

  function factuurMeta(f: Factuur) {
    const project = projectVoorFactuur(f);
    const isWf = isWarmtefondsFactuurContext({ project });
    const soort = resolveFactuurSoort(f, { isWarmtefonds: isWf });
    const wfLater = isFactuurWfLaterBetaald(f, { isWarmtefonds: isWf });
    const heeftCredit = (creditsByParent.get(f.id) || []).length > 0;
    const overdueRaw = factuurIsOverdue({ ...f, heeftCredit });
    // WF-intern/declaratie: geen verlopen-alarm (betaling via fonds)
    const overdue = overdueRaw && !wfLater;
    return { soort, wfLater, heeftCredit, overdue };
  }

  const filtered = useMemo(() => {
    // Creditfacturen staan onder de oorspronkelijke factuur — niet als aparte rij
    let base = facturen.filter((f) => !isCreditFactuur(f));
    switch (filter) {
      case "actief":
        // Standaard: geen concepten, geen gecrediteerde facturen
        base = base.filter(
          (f) => f.status !== "concept" && !creditsByParent.has(f.id)
        );
        break;
      case "betaald":
        base = base.filter((f) => f.status === "betaald");
        break;
      case "open":
        base = base.filter(
          (f) =>
            (f.status === "verzonden" || f.status === "deels_betaald") &&
            !creditsByParent.has(f.id)
        );
        break;
      case "concept":
        base = base.filter((f) => f.status === "concept");
        break;
      default:
        break;
    }
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((f) => {
        const lead = f.leads;
        const hay = [
          f.factuur_nummer,
          f.omschrijving,
          lead?.naam,
          lead?.email,
          lead?.telefoon,
          lead?.lead_number,
          f.offertes?.offerte_nummer,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    // Verlopen bovenaan (excl. WF-intern/declaratie), daarna nieuwste factuurdatum
    return [...base].sort((a, b) => {
      const aOver = factuurMeta(a).overdue;
      const bOver = factuurMeta(b).overdue;
      if (aOver !== bOver) return aOver ? -1 : 1;
      return (b.factuurdatum || "").localeCompare(a.factuurdatum || "");
    });
  }, [facturen, filter, search, creditsByParent, projecten]);

  const overview = useMemo(() => {
    let ontvangenBtw = 0;
    let openstaandeBtw = 0;
    let betaaldInc = 0;
    let openstaandInc = 0;
    let betaaldCount = 0;
    let openCount = 0;
    const perKwartaal = new Map<
      string,
      { jaar: number; kwartaal: number; btw: number; count: number }
    >();

    for (const f of facturen) {
      const b = factuurBtwBuckets(f);
      ontvangenBtw += b.ontvangenBtw;
      openstaandeBtw += b.openstaandeBtw;
      betaaldInc += b.betaaldInc;
      openstaandInc += b.openstaandInc;
      if (b.betaald) betaaldCount += 1;
      if (b.open) openCount += 1;

      // Af te dragen per kwartaal op factuurdatum (betaald + credits die verlagen)
      if (b.ontvangenBtw !== 0) {
        const day = factuurDayAms(f.factuurdatum);
        const k = day ? kwartaalVanDag(day) : null;
        if (k) {
          const key = `${k.jaar}-Q${k.kwartaal}`;
          const cur = perKwartaal.get(key) || {
            jaar: k.jaar,
            kwartaal: k.kwartaal,
            btw: 0,
            count: 0,
          };
          cur.btw += b.ontvangenBtw;
          cur.count += 1;
          perKwartaal.set(key, cur);
        }
      }
    }

    const huidigeKey = currentKwartaalKey();
    const jaren = [
      ...new Set([...perKwartaal.values()].map((v) => v.jaar)),
    ].sort((a, b) => a - b);
    // Toon minstens het lopende jaar (Q1–Q4), plus eerdere jaren met data
    const nowYear = Number(huidigeKey.slice(0, 4)) || new Date().getFullYear();
    if (!jaren.includes(nowYear)) jaren.push(nowYear);
    jaren.sort((a, b) => a - b);

    const kwartalen: BtwKwartaal[] = [];
    for (const jaar of jaren) {
      for (let q = 1; q <= 4; q += 1) {
        const key = `${jaar}-Q${q}`;
        const cur = perKwartaal.get(key);
        // Sla lege kwartalen over behalve het lopende jaar
        if (!cur && jaar !== nowYear) continue;
        kwartalen.push({
          key,
          jaar,
          kwartaal: q,
          label: `Q${q} ${jaar}`,
          btw: Math.round((cur?.btw || 0) * 100) / 100,
          count: cur?.count || 0,
        });
      }
    }

    return {
      ontvangenBtw,
      openstaandeBtw,
      betaaldInc,
      openstaandInc,
      betaaldCount,
      openCount,
      kwartalen,
      huidigeKwartaalKey: huidigeKey,
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
      {showFinanceKpis ? (
        <>
          <div className="border-b border-line bg-white px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Af te dragen BTW per kwartaal
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Op factuurdatum · betaald (credits verlagen) ·{" "}
                  {overview.betaaldCount} betaald
                </p>
              </div>
              <p className="text-[11px] text-muted">
                Totaal{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {formatEuro(overview.ontvangenBtw)}
                </span>
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {overview.kwartalen.map((k) => {
                const current = k.key === overview.huidigeKwartaalKey;
                return (
                  <div
                    key={k.key}
                    className={[
                      "border px-3 py-2.5",
                      current
                        ? "border-green/40 bg-green-soft/40"
                        : "border-line bg-wash/40",
                    ].join(" ")}
                  >
                    <p
                      className={[
                        "text-[10px] font-semibold uppercase tracking-wide",
                        current ? "text-green-deeper" : "text-muted",
                      ].join(" ")}
                    >
                      {k.label}
                      {current ? " · nu" : ""}
                    </p>
                    <p
                      className={[
                        "mt-0.5 font-display text-lg font-semibold tabular-nums",
                        k.btw < 0
                          ? "text-[#C45A12]"
                          : current
                            ? "text-green-deeper"
                            : "text-ink",
                      ].join(" ")}
                    >
                      {formatEuro(k.btw)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted">
                      {k.count
                        ? `${k.count} factuur${k.count === 1 ? "" : "en"}`
                        : "geen"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3">
            {[
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
                <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-ink">
                  {kpi.value}
                </p>
                {kpi.hint ? (
                  <p className="mt-0.5 text-[10px] text-muted">{kpi.hint}</p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative min-w-0 flex-1 sm:max-w-sm">
          <span className="sr-only">Zoek facturen</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op naam, nr, e-mail…"
            className="w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-green"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
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
          <p className="text-xs text-muted sm:ml-1">
            {filtered.length} van {facturen.length}
          </p>
        </div>
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
              const { soort, heeftCredit, overdue } = factuurMeta(f);
              const displayStatus = factuurDisplayStatus(f, {
                heeftCredit,
              });
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
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge kind="factuur" value={displayStatus} />
                        {soort !== "credit" ? (
                          <span
                            title={factuurSoortHint[soort]}
                            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${factuurSoortTone(soort)}`}
                          >
                            {factuurSoortLabel[soort]}
                          </span>
                        ) : null}
                      </div>
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
                      {!overdue &&
                      f.status !== "betaald" &&
                      f.afgesproken_betaaldatum
                        ? ` · Betaalt ${formatDateShort(f.afgesproken_betaaldatum)}`
                        : ""}
                      {overdue ? (
                        <span className="ml-1.5 inline-block border border-[#C45A12]/40 bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                          Verlopen
                        </span>
                      ) : null}
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
                  <th>Betaaldatum</th>
                  <th>Betaald op</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const { soort, heeftCredit, overdue } = factuurMeta(f);
                  const displayStatus = factuurDisplayStatus(f, {
                    heeftCredit,
                  });
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge kind="factuur" value={displayStatus} />
                          {soort !== "credit" ? (
                            <span
                              title={factuurSoortHint[soort]}
                              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${factuurSoortTone(soort)}`}
                            >
                              {factuurSoortLabel[soort]}
                            </span>
                          ) : null}
                          {overdue ? (
                            <span className="border border-[#C45A12]/40 bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                              Verlopen
                            </span>
                          ) : null}
                        </div>
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
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {f.afgesproken_betaaldatum
                          ? formatDateShort(f.afgesproken_betaaldatum)
                          : "—"}
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
