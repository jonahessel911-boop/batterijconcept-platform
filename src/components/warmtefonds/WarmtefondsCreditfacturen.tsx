"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";

type Factuur = {
  id: string;
  nummer: string;
  datum_label: string;
  project_nummer: string;
  klant: string;
  bedrag_inc: number;
};

export function WarmtefondsCreditfacturen({ token }: { token: string }) {
  const [rows, setRows] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/creditfacturen`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setRows(data.facturen || []);
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

  return (
    <section className="border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-semibold text-ink">
          Creditfacturen
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Edergy, €375 per aanvraag. Wordt aangemaakt zodra de aanvraag op
          In behandeling staat.
        </p>
      </div>
      {loading ? (
        <p className="px-5 py-14 text-center text-sm text-muted">Laden…</p>
      ) : error ? (
        <p className="px-5 py-10 text-center text-sm text-[#C45A12]">{error}</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          Nog geen creditfacturen.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-wash/80 text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Nummer</th>
                <th className="px-4 py-2.5 font-medium">Datum</th>
                <th className="px-4 py-2.5 font-medium">Aanvraag</th>
                <th className="px-4 py-2.5 font-medium">Bedrag</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">
                    {f.nummer}
                  </td>
                  <td className="px-4 py-3 text-ink">{f.datum_label}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{f.klant}</p>
                    <p className="text-xs text-muted">{f.project_nummer}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink">
                    {formatEuro(f.bedrag_inc)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/api/warmtefonds/${token}/creditfacturen/${f.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                    >
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
