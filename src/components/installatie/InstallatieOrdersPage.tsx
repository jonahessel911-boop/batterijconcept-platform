"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Project } from "@/types/database";
import { projectStatusLabel } from "@/lib/labels";
import {
  adresRegel,
  formatDateTimeLongNl,
  formatDateTimeNl,
} from "@/lib/format";

type OrderRow = Project & {
  leads?: Project["leads"];
};

export function InstallatieOrdersPage() {
  const { token } = useParams<{ token: string }>();
  const [partnerNaam, setPartnerNaam] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setPartnerNaam(data.partner?.naam || "");
      setOrders(data.orders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  return (
    <div className="min-h-screen bg-wash">
      <header className="border-b border-line bg-green-dark px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <p className="font-display text-lg font-bold text-white">
            Batterij<span className="text-orange">concept</span>
          </p>
          <h1 className="mt-2 font-display text-xl font-semibold text-white sm:text-2xl">
            Installatieportaal
          </h1>
          {partnerNaam && (
            <p className="mt-1 text-sm text-white/70">{partnerNaam}</p>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted">Orders laden…</p>
        ) : error ? (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
        ) : (
          <>
            <div className="mb-5 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Orders
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {orders.length}{" "}
                  {orders.length === 1 ? "order" : "orders"} gekoppeld
                </p>
              </div>
            </div>

            {orders.length === 0 ? (
              <p className="border border-line bg-white px-4 py-10 text-center text-sm text-muted">
                Nog geen orders. Zodra Batterijconcept een schouw inplant,
                verschijnt die hier.
              </p>
            ) : (
              <ul className="space-y-3">
                {orders.map((o) => {
                  const lead = Array.isArray(o.leads) ? o.leads[0] : o.leads;
                  const adres = lead ? adresRegel(lead) : "—";
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/installatie/${token}/orders/${o.id}`}
                        className="block border border-line bg-white p-4 transition hover:border-green/40 hover:shadow-[0_1px_4px_rgba(13,92,50,0.08)]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-mono text-xs font-semibold text-green-dark">
                              {o.project_nummer}
                            </p>
                            <p className="mt-0.5 text-base font-semibold text-ink">
                              {lead?.naam || o.titel || "Order"}
                            </p>
                          </div>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {projectStatusLabel[o.status] || o.status}
                          </span>
                        </div>
                        {o.schouw_at && (
                          <p className="mt-2 text-sm text-ink">
                            <span className="text-muted">Schouw · </span>
                            {formatDateTimeLongNl(o.schouw_at)}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-muted">{adres}</p>
                        {lead?.telefoon && (
                          <p className="mt-1 text-sm text-muted">{lead.telefoon}</p>
                        )}
                        <p className="mt-3 text-xs font-semibold text-orange">
                          Bekijk order →
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-8 text-center text-xs text-muted sm:px-6">
        Batterijconcept · {formatDateTimeNl(new Date())}
      </footer>
    </div>
  );
}
