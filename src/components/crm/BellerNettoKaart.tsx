"use client";

import { useEffect, useState } from "react";
import { formatDateShort, formatEuro, formatTimeNl } from "@/lib/format";
import type { BellerWeekCommissie } from "@/lib/beller-commissie";

type Props = {
  bellerId: string;
  /** compact = één regel boven de wachtrij */
  compact?: boolean;
};

type ApiData = {
  perAfspraak: number;
  weeks: BellerWeekCommissie[];
};

export function BellerNettoKaart({ bellerId, compact = false }: Props) {
  const [week, setWeek] = useState<BellerWeekCommissie | null>(null);
  const [perAfspraak, setPerAfspraak] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ beller_id: bellerId, weeks: "2" });
    void fetch(`/api/rapportage/beller-commissie?${qs}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as ApiData & {
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "Laden mislukt");
        if (cancelled) return;
        setPerAfspraak(json.perAfspraak || 10);
        setWeek(json.weeks?.find((w) => w.isVorigeWeek) || null);
      })
      .catch((e) => {
        if (!cancelled) {
          setWeek(null);
          setError(e instanceof Error ? e.message : "Fout");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bellerId]);

  if (loading) {
    return (
      <p className={compact ? "text-[11px] text-muted" : "text-sm text-muted"}>
        Netto vorige week laden…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[11px] text-[#C45A12]">{error}</p>
    );
  }
  if (!week) return null;

  const bedrag = formatEuro(week.bedragExBtw);

  if (compact) {
    return (
      <p className="text-xs text-ink">
        <span className="font-semibold">Vorige week</span>
        <span className="text-muted">
          {" "}
          · {week.afspraken} netto
          {week.afspraken === 1 ? " afspraak" : " afspraken"} · {bedrag}
        </span>
      </p>
    );
  }

  return (
    <section className="mx-auto mt-8 max-w-2xl border border-line bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Jouw netto · vorige week
          </p>
          <p className="mt-1 font-display text-lg font-semibold text-ink">
            {week.van} – {week.tot}
          </p>
          <p className="mt-1 text-xs text-muted">
            Ingepland die week en nu nog niet afgezegd. Niet-gekwalificeerd en deur-niet-open tellen niet mee. × €{perAfspraak}.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-semibold tabular-nums text-ink">
            {week.afspraken}
          </p>
          <p className="text-sm font-semibold tabular-nums text-green-dark">
            {bedrag}
          </p>
        </div>
      </div>
      {week.regels.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-green-dark hover:bg-[#F7FBF8]"
          >
            {open ? "Verberg afspraken" : "Toon alle afspraken"}
            <span className="text-muted">{week.regels.length}</span>
          </button>
          {open ? (
            <ul className="max-h-72 overflow-auto border-t border-line">
              {week.regels.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 text-sm last:border-b-0"
                >
                  <span className="font-medium text-ink">{r.leadNaam}</span>
                  <span className="shrink-0 text-xs text-muted">
                    gepland {formatDateShort(r.geplandOp)}
                    {r.startAt
                      ? ` · afspraak ${formatDateShort(r.startAt)} ${formatTimeNl(r.startAt)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">
          Geen netto afspraken in deze week.
        </p>
      )}
    </section>
  );
}
