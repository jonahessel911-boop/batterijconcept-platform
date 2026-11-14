"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateNl, formatEuro } from "@/lib/format";

type Factuur = {
  id: string;
  nummer: string;
  datum: string;
  datum_label: string;
  project_nummer: string;
  klant: string;
  bedrag_inc: number;
};

const MAAND_KORT = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
] as const;

function parseDatum(f: Factuur): Date | null {
  if (f.datum && /^\d{4}-\d{2}-\d{2}/.test(f.datum)) {
    const d = new Date(`${f.datum.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (f.datum_label) {
    const d = new Date(f.datum_label);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function jaarVan(f: Factuur): number | null {
  const d = parseDatum(f);
  return d ? d.getFullYear() : null;
}

function maandVan(f: Factuur): number | null {
  const d = parseDatum(f);
  return d ? d.getMonth() + 1 : null;
}

function kwartaalVanMaand(maand: number): number {
  return Math.ceil(maand / 3);
}

function maandenInKwartaal(q: number): number[] {
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

function datumKort(f: Factuur): string {
  if (f.datum && /^\d{4}-\d{2}-\d{2}/.test(f.datum)) {
    return formatDateNl(`${f.datum.slice(0, 10)}T12:00:00`);
  }
  return f.datum_label || "—";
}

const selectCls =
  "h-9 border border-line bg-white px-2.5 text-[13px] font-medium text-ink outline-none focus:border-green-dark";

export function WarmtefondsCreditfacturen({ token }: { token: string }) {
  const [rows, setRows] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jaar, setJaar] = useState<number | null>(null);
  const [kwartaal, setKwartaal] = useState<number | "alle">("alle");
  const [maand, setMaand] = useState<number | "alle">("alle");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/creditfacturen`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = (data.facturen || []) as Factuur[];
      setRows(list);
      const jaren = Array.from(
        new Set(list.map(jaarVan).filter((y): y is number => y != null))
      ).sort((a, b) => b - a);
      setJaar((prev) =>
        prev != null && jaren.includes(prev)
          ? prev
          : jaren[0] ?? new Date().getFullYear()
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const jaren = useMemo(() => {
    const set = new Set<number>();
    for (const f of rows) {
      const y = jaarVan(f);
      if (y != null) set.add(y);
    }
    if (jaar != null) set.add(jaar);
    return Array.from(set).sort((a, b) => b - a);
  }, [rows, jaar]);

  const inJaar = useMemo(() => {
    if (jaar == null) return [];
    return rows.filter((f) => jaarVan(f) === jaar);
  }, [rows, jaar]);

  const gefilterd = useMemo(() => {
    return inJaar
      .filter((f) => {
        const m = maandVan(f);
        if (m == null) return false;
        if (kwartaal !== "alle" && kwartaalVanMaand(m) !== kwartaal) return false;
        if (maand !== "alle" && m !== maand) return false;
        return true;
      })
      .sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  }, [inJaar, kwartaal, maand]);

  const totaalInc = useMemo(
    () => gefilterd.reduce((s, f) => s + (Number(f.bedrag_inc) || 0), 0),
    [gefilterd]
  );

  const maandOpties =
    kwartaal === "alle"
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      : maandenInKwartaal(kwartaal);

  function openPdf(id: string) {
    window.open(
      `/api/warmtefonds/${token}/creditfacturen/${id}/pdf`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function onJaarChange(y: number) {
    setJaar(y);
    setKwartaal("alle");
    setMaand("alle");
  }

  function onKwartaalChange(q: number | "alle") {
    setKwartaal(q);
    setMaand("alle");
  }

  if (loading) {
    return (
      <div className="border border-line bg-white px-5 py-12 text-center text-sm text-muted">
        Laden…
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-line bg-white px-5 py-10 text-center text-sm text-[#C45A12]">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border border-line bg-white px-5 py-12 text-center text-sm text-muted">
        Nog geen creditfacturen
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <select
          className={selectCls}
          value={jaar ?? ""}
          onChange={(e) => onJaarChange(Number(e.target.value))}
          aria-label="Jaar"
        >
          {jaren.map((y) => (
            <option key={y} value={y}>
              {String(y).slice(2)} · {y}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={kwartaal === "alle" ? "alle" : String(kwartaal)}
          onChange={(e) => {
            const v = e.target.value;
            onKwartaalChange(v === "alle" ? "alle" : Number(v));
          }}
          aria-label="Kwartaal"
        >
          <option value="alle">Heel jaar</option>
          <option value="1">Q1</option>
          <option value="2">Q2</option>
          <option value="3">Q3</option>
          <option value="4">Q4</option>
        </select>

        <select
          className={selectCls}
          value={maand === "alle" ? "alle" : String(maand)}
          onChange={(e) => {
            const v = e.target.value;
            setMaand(v === "alle" ? "alle" : Number(v));
          }}
          aria-label="Maand"
        >
          <option value="alle">Alle maanden</option>
          {maandOpties.map((m) => (
            <option key={m} value={m}>
              {MAAND_KORT[m - 1]}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-baseline gap-3 text-[13px]">
          <span className="text-muted">
            {gefilterd.length}{" "}
            {gefilterd.length === 1 ? "factuur" : "facturen"}
          </span>
          <span className="font-semibold tabular-nums text-ink">
            {formatEuro(totaalInc)}
          </span>
        </div>
      </div>

      {gefilterd.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-muted">
          Geen creditfacturen in deze periode
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold text-ink">Nummer</th>
                <th className="px-3 py-2.5 font-semibold text-ink">Datum</th>
                <th className="px-3 py-2.5 font-semibold text-ink">Project</th>
                <th className="px-3 py-2.5 font-semibold text-ink">Klant</th>
                <th className="px-3 py-2.5 text-right font-semibold text-ink">
                  Bedrag
                </th>
              </tr>
            </thead>
            <tbody>
              {gefilterd.map((f) => (
                <tr
                  key={f.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer border-b border-line last:border-b-0 hover:bg-wash/40"
                  onClick={() => openPdf(f.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openPdf(f.id);
                    }
                  }}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px] font-semibold text-green-dark">
                    {f.nummer}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[13px] text-muted">
                    {datumKort(f)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[13px] text-ink">
                    {f.project_nummer || "—"}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2.5 font-medium text-ink">
                    {f.klant || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                    {formatEuro(f.bedrag_inc)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-wash/50">
                <td
                  colSpan={4}
                  className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted"
                >
                  Totaal
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-[14px] font-semibold tabular-nums text-ink">
                  {formatEuro(totaalInc)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
