"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { Project } from "@/types/database";
import { projectStatusLabel } from "@/lib/labels";
import {
  adresRegel,
  formatDateTimeNl,
} from "@/lib/format";
import { InstallatieSchouwAgenda } from "./InstallatieSchouwAgenda";

type OrderRow = Project & {
  leads?: Project["leads"];
};

function leadOf(o: OrderRow) {
  return Array.isArray(o.leads) ? o.leads[0] : o.leads;
}

export function InstallatieOrdersPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "agenda" ? "agenda" : "orders";

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

  function setTab(next: "orders" | "agenda") {
    const url =
      next === "agenda"
        ? `/installatie/${token}?tab=agenda`
        : `/installatie/${token}`;
    router.replace(url);
  }

  return (
    <div className="min-h-screen bg-wash">
      <header className="border-b border-line bg-green-dark px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
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

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted">Orders laden…</p>
        ) : error ? (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  {tab === "agenda" ? "Agenda" : "Orders"}
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {orders.length}{" "}
                  {orders.length === 1 ? "order" : "orders"} gekoppeld
                </p>
              </div>
              <div className="flex rounded-full border border-line bg-white p-1 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => setTab("orders")}
                  className={[
                    "rounded-full px-4 py-1.5",
                    tab === "orders"
                      ? "bg-green text-white"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                >
                  Orders
                </button>
                <button
                  type="button"
                  onClick={() => setTab("agenda")}
                  className={[
                    "rounded-full px-4 py-1.5",
                    tab === "agenda"
                      ? "bg-green text-white"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                >
                  Agenda
                </button>
              </div>
            </div>

            {tab === "agenda" ? (
              <InstallatieSchouwAgenda token={token} orders={orders} />
            ) : orders.length === 0 ? (
              <p className="border border-line bg-white px-4 py-10 text-center text-sm text-muted">
                Nog geen orders. Zodra Batterijconcept een schouw inplant,
                verschijnt die hier.
              </p>
            ) : (
              <div className="overflow-x-auto border border-line bg-white">
                <table className="crm-table crm-table--compact min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Klant</th>
                      <th>Adres</th>
                      <th>Schouw</th>
                      <th>Status</th>
                      <th>Tel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const lead = leadOf(o);
                      const adres = lead ? adresRegel(lead) : "—";
                      return (
                        <tr
                          key={o.id}
                          onClick={() =>
                            router.push(
                              `/installatie/${token}/orders/${o.id}`
                            )
                          }
                        >
                          <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-green-dark">
                            {o.project_nummer}
                          </td>
                          <td className="font-medium text-ink whitespace-nowrap">
                            {lead?.naam || o.titel || "—"}
                          </td>
                          <td className="text-muted whitespace-nowrap">
                            {adres}
                          </td>
                          <td className="whitespace-nowrap tabular-nums">
                            {o.schouw_at
                              ? formatDateTimeNl(o.schouw_at)
                              : "—"}
                          </td>
                          <td className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {projectStatusLabel[o.status] || o.status}
                          </td>
                          <td className="whitespace-nowrap text-muted">
                            {lead?.telefoon ? (
                              <Link
                                href={`tel:${lead.telefoon}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:text-green"
                              >
                                {lead.telefoon}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-xs text-muted sm:px-6">
        Batterijconcept · {formatDateTimeNl(new Date())}
      </footer>
    </div>
  );
}
