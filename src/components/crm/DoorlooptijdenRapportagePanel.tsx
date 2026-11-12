"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDateShort } from "@/lib/format";

type Segment = {
  id: string;
  label: string;
  n: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  meanDays: number | null;
};

type Row = {
  projectId: string;
  projectNummer: string | null;
  klant: string | null;
  ondertekendOp: string;
  warmtefondsUitbetaaldAt: string | null;
  materiaalLeverdatum: string | null;
  installatieAt: string | null;
  daysOndertekenTotUitbetaald: number | null;
  daysOndertekenTotInstallatie: number | null;
  daysUitbetaaldTotInstallatie: number | null;
  daysOndertekenTotLevering: number | null;
};

type Payload = {
  ok?: boolean;
  fallbackDays: number;
  empiricalWfDays: number;
  empiricalWfWeeks: number;
  sampleSizeWf: number;
  segments: Segment[];
  recent: Row[];
  error?: string;
};

function daysLabel(n: number | null): string {
  if (n == null) return "—";
  return `${n}d`;
}

export function DoorlooptijdenRapportagePanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rapportage/doorlooptijden");
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <p className="px-4 py-10 text-center text-sm text-muted">Laden…</p>;
  }

  if (error && !data) {
    return (
      <p className="px-4 py-6 text-sm text-[#C45A12]">
        {error}{" "}
        <button
          type="button"
          onClick={() => void load()}
          className="font-semibold underline"
        >
          Opnieuw
        </button>
      </p>
    );
  }

  if (!data) return null;

  const empirical = data.sampleSizeWf >= 5;

  return (
    <div className="space-y-5 px-4 py-5 sm:px-5">
      <div className="border border-line bg-white px-4 py-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Capaciteitsbasis · Warmtefonds
        </p>
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
          {data.empiricalWfDays} dagen
          <span className="ml-2 text-base font-medium text-muted">
            (~{data.empiricalWfWeeks} weken)
          </span>
        </p>
        <p className="mt-1 text-sm text-muted">
          {empirical
            ? `Mediaan offerte → WF uitbetaald op ${data.sampleSizeWf} afgeronde cases. Forecasts gebruiken dit i.p.v. vaste ${data.fallbackDays} dagen.`
            : `Nog te weinig uitbetaalde cases (${data.sampleSizeWf}). Zolang blijft fallback ${data.fallbackDays} dagen (~5 weken). Vul warmtefonds_uitbetaald_at in bij elke WF-uitbetaling.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.segments.map((s) => (
          <div key={s.id} className="border border-line bg-white px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {s.label}
            </p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
              {s.medianDays != null ? `${s.medianDays}d` : "—"}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-muted">
              n={s.n}
              {s.p25Days != null && s.p75Days != null
                ? ` · p25–p75 ${s.p25Days}–${s.p75Days}d`
                : ""}
              {s.meanDays != null ? ` · μ ${s.meanDays}d` : ""}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-wash text-[10px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Getekend</th>
              <th className="px-3 py-2">WF uit</th>
              <th className="px-3 py-2">Levering</th>
              <th className="px-3 py-2">Installatie</th>
              <th className="px-3 py-2 tabular-nums">→ WF</th>
              <th className="px-3 py-2 tabular-nums">→ Inst.</th>
              <th className="px-3 py-2 tabular-nums">WF→Inst.</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-sm text-muted"
                >
                  Nog geen WF-projecten met meetbare timestamps.
                </td>
              </tr>
            ) : (
              data.recent.map((r) => (
                <tr key={r.projectId} className="border-b border-line/70">
                  <td className="px-3 py-2">
                    <Link
                      href={`/projecten/${r.projectId}`}
                      className="font-semibold text-green-dark hover:underline"
                    >
                      {r.projectNummer || "Project"}
                    </Link>
                    {r.klant ? (
                      <p className="text-xs text-muted">{r.klant}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {formatDateShort(r.ondertekendOp)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {r.warmtefondsUitbetaaldAt
                      ? formatDateShort(r.warmtefondsUitbetaaldAt)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {r.materiaalLeverdatum
                      ? formatDateShort(r.materiaalLeverdatum)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {r.installatieAt ? formatDateShort(r.installatieAt) : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {daysLabel(r.daysOndertekenTotUitbetaald)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {daysLabel(r.daysOndertekenTotInstallatie)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {daysLabel(r.daysUitbetaaldTotInstallatie)}
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
