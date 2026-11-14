"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EDERGY_PER_AANVRAAG_EXCL,
  edergyBedragenVanExcl,
} from "@/lib/edergy-tarief";
import { formatEuro } from "@/lib/format";

type Props = {
  /** Optioneel: hoeveel partners het standaardtarief gebruiken. */
  partnersOpStandaard?: number;
  partnersTotaal?: number;
  onStandaardChange?: (inc: number) => void;
};

/** Admin: standaardvergoeding per WF-aanvraag (fallback als partner geen eigen tarief heeft). */
export function EdergyTariefInstelling({
  partnersOpStandaard,
  partnersTotaal,
  onStandaardChange,
}: Props) {
  const [waarde, setWaarde] = useState(String(EDERGY_PER_AANVRAAG_EXCL));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/edergy-tarief");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const excl = Number(
        data.per_aanvraag_excl ?? EDERGY_PER_AANVRAAG_EXCL
      );
      const inc = Number(data.per_aanvraag_inc);
      setWaarde(String(excl));
      if (Number.isFinite(inc) && inc > 0) onStandaardChange?.(inc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [onStandaardChange]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const split = edergyBedragenVanExcl(
    Number(waarde.replace(",", ".")) || EDERGY_PER_AANVRAAG_EXCL
  );

  async function opslaan() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/edergy-tarief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          per_aanvraag_inc: split.perAanvraagInc,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const excl = Number(
        data.per_aanvraag_excl ?? split.perAanvraagExcl
      );
      const inc = Number(data.per_aanvraag_inc ?? split.perAanvraagInc);
      setWaarde(String(excl));
      onStandaardChange?.(inc);
      setOk("Standaardtarief opgeslagen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Standaardtarief
          </p>
          <h3 className="mt-1 text-sm font-semibold text-ink">
            Vergoeding per WF-aanvraag
          </h3>
          <p className="mt-1 text-xs text-muted">
            Fallback voor partners zonder eigen tarief. Per partner kun je in
            het detail een ander bedrag zetten. Standaard €150 excl. btw.
          </p>
          {partnersTotaal != null && partnersTotaal > 0 ? (
            <p className="mt-2 text-[11px] font-medium text-muted">
              {partnersOpStandaard ?? 0} van {partnersTotaal} partner
              {(partnersTotaal || 0) === 1 ? "" : "s"} op standaard
            </p>
          ) : null}
        </div>

        {loading ? (
          <p className="text-xs text-muted">Laden…</p>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <p className="font-display text-2xl font-semibold tabular-nums text-ink">
              {formatEuro(split.perAanvraagExcl)}
              <span className="ml-1 text-sm font-medium text-muted">excl.</span>
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-[11px] font-semibold text-ink">
                Excl. btw (€)
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  value={waarde}
                  onChange={(e) => {
                    setWaarde(e.target.value);
                    setOk(null);
                  }}
                  className="mt-1 w-28 border border-line px-2.5 py-1.5 text-sm font-normal tabular-nums outline-none focus:border-green"
                />
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void opslaan()}
                className="h-[34px] bg-green px-3 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
              >
                {saving ? "…" : "Opslaan"}
              </button>
            </div>
            <p className="text-[11px] text-muted">
              BTW {formatEuro(split.perAanvraagBtw)} · incl.{" "}
              {formatEuro(split.perAanvraagInc)}
            </p>
          </div>
        )}
      </div>
      {ok ? <p className="mt-3 text-xs font-medium text-green-dark">{ok}</p> : null}
      {error ? <p className="mt-3 text-xs text-[#C45A12]">{error}</p> : null}
    </section>
  );
}
