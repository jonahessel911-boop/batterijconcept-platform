"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BackofficeRapportageData,
  BackofficeRapportagePeriod,
} from "@/lib/backoffice-rapportage";

type Period = BackofficeRapportagePeriod;

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

/** Minuten → "2u 15m" of "45m" */
function fmtMinutes(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return "—";
  const rounded = Math.round(m);
  if (rounded < 60) return `${rounded}m`;
  const h = Math.floor(rounded / 60);
  const min = rounded % 60;
  return min === 0 ? `${h}u` : `${h}u ${min}m`;
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-line bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function BackofficeKpiDashboard() {
  const [period, setPeriod] = useState<Period>("last_14_days");
  const [data, setData] = useState<BackofficeRapportageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backoffice-rapportage?period=${period}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Laden mislukt");
      setData((body.dashboard || body) as BackofficeRapportageData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  if (loading && !data) {
    return (
      <p className="px-5 py-12 text-center text-sm text-muted">
        Backoffice-rapportage laden…
      </p>
    );
  }

  if (error && !data) {
    return (
      <p className="mx-5 my-6 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
        {error}
      </p>
    );
  }

  if (!data) return null;

  const { ttfc, actieDeadline, teamSla } = data;
  const voorBar =
    actieDeadline.voltooid > 0
      ? Math.round((actieDeadline.voorDeadline / actieDeadline.voltooid) * 100)
      : 0;
  const openVoorBar =
    actieDeadline.open > 0
      ? Math.round((actieDeadline.openOpTijd / actieDeadline.open) * 100)
      : 0;

  return (
    <div className="space-y-5 px-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Backoffice dashboard
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {data.period.label} · TTFC in werktijd 09–19 (ma–vr, Amsterdam)
          </p>
        </div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Periode
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="mt-1 block border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
          >
            <option value="this_week">Deze week</option>
            <option value="last_week">Vorige week</option>
            <option value="this_month">Deze maand</option>
            <option value="last_7_days">Laatste 7 dagen</option>
            <option value="last_14_days">Laatste 14 dagen</option>
            <option value="last_30_days">Laatste 30 dagen</option>
            <option value="this_quarter">Dit kwartaal</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Acties vóór deadline"
          value={pct(actieDeadline.voorPct)}
          hint={`${num(actieDeadline.voorDeadline)} van ${num(actieDeadline.voltooid)} voltooid in periode`}
        />
        <KpiCard
          label="Acties ná deadline"
          value={pct(actieDeadline.naPct)}
          hint={`${num(actieDeadline.naDeadline)} van ${num(actieDeadline.voltooid)} voltooid te laat`}
        />
        <KpiCard
          label="Open acties nu"
          value={num(actieDeadline.open)}
          hint={`${pct(actieDeadline.openOpTijdPct)} nog op tijd · ${pct(actieDeadline.openOverduePct)} overdue (${num(actieDeadline.openOverdue)})`}
        />
        <KpiCard
          label="TTFC mediaan"
          value={fmtMinutes(ttfc.medianMinutes)}
          hint={`${num(ttfc.count)} eerste contacten · p90 ${fmtMinutes(ttfc.p90Minutes)}`}
        />
      </div>

      <section className="border border-line bg-white px-4 py-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Actie-deadlines
        </h3>
        <p className="mt-1 text-sm text-muted">
          Voltooid in periode: {num(actieDeadline.voltooid)} · Openstaand nu:{" "}
          {num(actieDeadline.open)}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-ink">Voltooid</span>
              <span className="text-muted">
                {pct(actieDeadline.voorPct)} vóór · {pct(actieDeadline.naPct)} ná
              </span>
            </div>
            <div className="flex h-3 overflow-hidden bg-wash">
              {actieDeadline.voltooid === 0 ? (
                <div className="h-full w-full bg-line/40" />
              ) : (
                <>
                  <div
                    className="bg-[#1f6b3a]"
                    style={{ width: `${voorBar}%` }}
                    title={`Vóór deadline: ${actieDeadline.voorDeadline}`}
                  />
                  <div
                    className="bg-[#C45A12]"
                    style={{ width: `${100 - voorBar}%` }}
                    title={`Ná deadline: ${actieDeadline.naDeadline}`}
                  />
                </>
              )}
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-ink">Openstaand</span>
              <span className="text-muted">
                {pct(actieDeadline.openOpTijdPct)} op tijd ·{" "}
                {pct(actieDeadline.openOverduePct)} overdue
              </span>
            </div>
            <div className="flex h-3 overflow-hidden bg-wash">
              {actieDeadline.open === 0 ? (
                <div className="h-full w-full bg-line/40" />
              ) : (
                <>
                  <div
                    className="bg-[#1f6b3a]"
                    style={{ width: `${openVoorBar}%` }}
                    title={`Nog op tijd: ${actieDeadline.openOpTijd}`}
                  />
                  <div
                    className="bg-[#C45A12]"
                    style={{ width: `${100 - openVoorBar}%` }}
                    title={`Overdue: ${actieDeadline.openOverdue}`}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Schouw-SLA {pct(teamSla.schouw.pct)} ({num(teamSla.schouw.onTime)}/
          {num(teamSla.schouw.eligible)}) · Aanbetaling-SLA{" "}
          {pct(teamSla.aanbetaling.pct)} ({num(teamSla.aanbetaling.onTime)}/
          {num(teamSla.aanbetaling.eligible)})
        </p>
      </section>

      {data.ttfcPerBeller.length > 0 ? (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Time to first contact per beller
          </h3>
          <div className="mt-2 overflow-x-auto border border-line">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-line bg-wash text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Beller</th>
                  <th className="px-3 py-2 font-semibold">Contacten</th>
                  <th className="px-3 py-2 font-semibold">Mediaan</th>
                  <th className="px-3 py-2 font-semibold">P90</th>
                  <th className="px-3 py-2 font-semibold">Gemiddeld</th>
                </tr>
              </thead>
              <tbody>
                {data.ttfcPerBeller.map((row) => (
                  <tr key={row.adviseurId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">{row.naam}</td>
                    <td className="px-3 py-2 text-muted">{num(row.count)}</td>
                    <td className="px-3 py-2 text-ink">
                      {fmtMinutes(row.medianMinutes)}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {fmtMinutes(row.p90Minutes)}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {fmtMinutes(row.avgMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Taken voltooid per medewerker
        </h3>
        {data.takenPerMedewerker.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Geen voltooide taken in deze periode.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto border border-line">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-line bg-wash text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Medewerker</th>
                  <th className="px-3 py-2 font-semibold">Voltooid</th>
                  <th className="px-3 py-2 font-semibold">Vóór deadline</th>
                  <th className="px-3 py-2 font-semibold">On-time %</th>
                </tr>
              </thead>
              <tbody>
                {data.takenPerMedewerker.map((row) => (
                  <tr
                    key={row.adviseurId}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-3 py-2 font-medium text-ink">{row.naam}</td>
                    <td className="px-3 py-2 text-muted">{num(row.voltooid)}</td>
                    <td className="px-3 py-2 text-muted">
                      {num(row.voorDeadline)} / {num(row.metDeadline)}
                    </td>
                    <td className="px-3 py-2 text-ink">{pct(row.onTimePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Acties voltooid per medewerker
        </h3>
        {data.actiesPerMedewerker.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nog geen gelogde actie-voltooiingen in deze periode. Voltooien vanaf
            de actielijst wordt voortaan bijgehouden.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto border border-line">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-line bg-wash text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Medewerker</th>
                  <th className="px-3 py-2 font-semibold">Voltooid</th>
                  <th className="px-3 py-2 font-semibold">Vóór deadline</th>
                  <th className="px-3 py-2 font-semibold">On-time %</th>
                </tr>
              </thead>
              <tbody>
                {data.actiesPerMedewerker.map((row) => (
                  <tr
                    key={row.adviseurId}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-3 py-2 font-medium text-ink">{row.naam}</td>
                    <td className="px-3 py-2 text-muted">{num(row.voltooid)}</td>
                    <td className="px-3 py-2 text-muted">
                      {num(row.voorDeadline)} / {num(row.metDeadline)}
                    </td>
                    <td className="px-3 py-2 text-ink">{pct(row.onTimePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
