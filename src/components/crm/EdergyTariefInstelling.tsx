"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";

/** Admin: Edergy-vergoeding per Warmtefonds-aanvraag (niet zichtbaar in WF-portaal). */
export function EdergyTariefInstelling() {
  const [waarde, setWaarde] = useState("375");
  const [excl, setExcl] = useState<number | null>(296.25);
  const [btw, setBtw] = useState<number | null>(78.75);
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
      setWaarde(String(data.per_aanvraag_inc ?? 375));
      setExcl(
        typeof data.per_aanvraag_excl === "number"
          ? data.per_aanvraag_excl
          : null
      );
      setBtw(
        typeof data.per_aanvraag_btw === "number"
          ? data.per_aanvraag_btw
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function opslaan() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/edergy-tarief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          per_aanvraag_inc: Number(waarde.replace(",", ".")),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setWaarde(String(data.per_aanvraag_inc ?? waarde));
      setExcl(
        typeof data.per_aanvraag_excl === "number"
          ? data.per_aanvraag_excl
          : null
      );
      setBtw(
        typeof data.per_aanvraag_btw === "number"
          ? data.per_aanvraag_btw
          : null
      );
      setOk("Opgeslagen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">
            Edergy-vergoeding per aanvraag
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Standaardtarief als een WF-persoon geen eigen bedrag heeft. Iedereen
            kan het ook zelf aanpassen onder Account in het portaal.
          </p>
        </div>
        {loading ? (
          <p className="text-xs text-muted">Laden…</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-[11px] font-semibold text-ink">
              Bedrag incl. btw (€)
              <input
                type="number"
                min={1}
                step={0.01}
                value={waarde}
                onChange={(e) => {
                  setWaarde(e.target.value);
                  setOk(null);
                }}
                className="mt-1 w-28 border border-line px-2.5 py-1.5 text-sm font-normal outline-none focus:border-green"
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
        )}
      </div>
      {!loading && (excl != null || btw != null) ? (
        <p className="mt-2 text-[11px] text-muted">
          Excl. {excl != null ? formatEuro(excl) : "—"} · BTW{" "}
          {btw != null ? formatEuro(btw) : "—"}
        </p>
      ) : null}
      {ok ? <p className="mt-2 text-xs text-green-dark">{ok}</p> : null}
      {error ? <p className="mt-2 text-xs text-[#C45A12]">{error}</p> : null}
    </section>
  );
}
