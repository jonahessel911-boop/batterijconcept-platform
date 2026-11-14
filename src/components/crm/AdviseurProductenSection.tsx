"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";

type ProductRegel = {
  naam: string;
  inkoopExcl: number;
  verkoopIncl: number;
};

export function AdviseurProductenSection({
  adviseurId,
  adviseurNaam,
}: {
  adviseurId: string;
  adviseurNaam: string;
}) {
  const [aan, setAan] = useState(false);
  const [producten, setProducten] = useState<ProductRegel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adviseurs/warmtepompen?adviseur_id=${encodeURIComponent(adviseurId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        aan?: boolean;
        producten?: ProductRegel[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setAan(Boolean(json.aan));
      setProducten(json.producten || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [adviseurId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function zetAan(next: boolean) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/adviseurs/warmtepompen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adviseur_id: adviseurId, aan: next }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        aan?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setAan(Boolean(json.aan));
      setMsg(json.message || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      <p className="text-sm text-ink">
        Thuisbatterij staat standaard aan voor {adviseurNaam}. Warmtepompen
        komen alleen in dit account.
      </p>
      <label className="flex items-center justify-between gap-3 border border-line px-3 py-2.5">
        <span className="text-sm text-ink">Thuisbatterij</span>
        <span className="text-xs font-semibold text-green-dark">Aan</span>
      </label>
      <label className="flex items-center justify-between gap-3 border border-line px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium text-ink">Warmtepompen</span>
          <span className="block text-xs text-muted">
            TC Swiss · verkoopprijs = adviesprijs + €1.500 incl. btw
          </span>
        </span>
        <input
          type="checkbox"
          checked={aan}
          disabled={loading || busy}
          onChange={(e) => void zetAan(e.target.checked)}
          className="h-4 w-4 accent-green"
        />
      </label>
      {loading ? <p className="text-xs text-muted">Laden…</p> : null}
      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}
      {msg ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
          {msg}
        </p>
      ) : null}
      {producten.length > 0 ? (
        <ul className="divide-y divide-line border border-line text-xs">
          {producten.map((p) => (
            <li key={p.naam} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="text-ink">{p.naam}</span>
              <span className="shrink-0 tabular-nums text-muted">
                inkoop {formatEuro(p.inkoopExcl)} · verkoop {formatEuro(p.verkoopIncl)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
