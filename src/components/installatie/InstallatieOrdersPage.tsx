"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PartnerCreditFactuur, Project } from "@/types/database";
import { formatDateShort, formatDateTimeNl, formatEuro } from "@/lib/format";
import { Planbord } from "@/components/crm/Planbord";

type OrderRow = Project & {
  leads?: Project["leads"];
};

type PortalTab = "agenda" | "facturen";

type FactuurRow = Pick<
  PartnerCreditFactuur,
  | "id"
  | "factuur_nummer"
  | "status"
  | "week_jaar"
  | "week_nummer"
  | "periode_van"
  | "periode_tot"
  | "omschrijving"
  | "offerte_nummer"
  | "project_nummer"
  | "bedrag_ex_btw"
  | "bedrag_inc_btw"
  | "factuurdatum"
  | "betaald_op"
  | "goedgekeurd_op"
>;

export function InstallatieOrdersPage() {
  const { token } = useParams<{ token: string }>();

  const [tab, setTab] = useState<PortalTab>("agenda");
  const [partnerNaam, setPartnerNaam] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [facturen, setFacturen] = useState<FactuurRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [facturenLoading, setFacturenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
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

  const loadFacturen = useCallback(async () => {
    setFacturenLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}/facturen`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Facturen laden mislukt");
      if (data.partner?.naam) setPartnerNaam(data.partner.naam);
      setFacturen((data.facturen || []) as FactuurRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setFacturenLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadOrders());
    return () => cancelAnimationFrame(id);
  }, [loadOrders]);

  useEffect(() => {
    if (tab === "facturen") void loadFacturen();
  }, [tab, loadFacturen]);

  async function downloadPdf(id: string, nummer: string) {
    setPdfBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${token}/facturen/${id}/pdf`
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nummer}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setPdfBusy(null);
    }
  }

  async function goedkeuren(id: string) {
    setApproveBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}/facturen/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "goedkeuren" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Goedkeuren mislukt");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Goedkeuren mislukt");
    } finally {
      setApproveBusy(null);
    }
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
        <div className="mb-5 flex border border-line bg-white p-0.5">
          <button
            type="button"
            onClick={() => setTab("agenda")}
            className={[
              "flex-1 px-4 py-2.5 text-sm font-semibold",
              tab === "agenda"
                ? "bg-green text-white"
                : "bg-white text-muted hover:bg-wash",
            ].join(" ")}
          >
            Agenda
          </button>
          <button
            type="button"
            onClick={() => setTab("facturen")}
            className={[
              "flex-1 px-4 py-2.5 text-sm font-semibold",
              tab === "facturen"
                ? "bg-green text-white"
                : "bg-white text-muted hover:bg-wash",
            ].join(" ")}
          >
            Facturen
          </button>
        </div>

        {error && (
          <p className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
        )}

        {tab === "agenda" ? (
          loading ? (
            <p className="py-16 text-center text-sm text-muted">
              Agenda laden…
            </p>
          ) : (
            <Planbord
              projecten={orders}
              variant="portal"
              portalToken={token}
              title="Jouw agenda"
              projectHref={(id) => `/installatie/${token}/orders/${id}`}
            />
          )
        ) : facturenLoading ? (
          <p className="py-16 text-center text-sm text-muted">
            Facturen laden…
          </p>
        ) : facturen.length === 0 ? (
          <div className="border border-line bg-white px-5 py-14 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Nog geen facturen
            </p>
            <p className="mt-1 text-sm text-muted">
              Creditfacturen die Batterijconcept voor je aanmaakt verschijnen
              hier.
            </p>
          </div>
        ) : (
          <div className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="font-display text-lg font-semibold text-ink">
                Creditfacturen
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                Selfbilling · controleer en keur goed · {facturen.length}{" "}
                factuur{facturen.length === 1 ? "" : "en"}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="crm-table w-full">
                <thead>
                  <tr>
                    <th>Nummer</th>
                    <th>Datum</th>
                    <th>Omschrijving</th>
                    <th className="text-right">Bedrag</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {facturen.map((f) => (
                    <tr key={f.id}>
                      <td className="font-medium text-ink">
                        {f.factuur_nummer}
                      </td>
                      <td className="text-muted">
                        {formatDateShort(f.factuurdatum)}
                      </td>
                      <td className="max-w-[220px] truncate text-muted">
                        {[
                          f.omschrijving ||
                            (f.week_nummer != null
                              ? `Week ${f.week_nummer}`
                              : null),
                          f.offerte_nummer
                            ? `Offerte ${f.offerte_nummer}`
                            : null,
                          f.project_nummer
                            ? `Project ${f.project_nummer}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="text-right tabular-nums font-medium">
                        {formatEuro(f.bedrag_inc_btw)}
                      </td>
                      <td>
                        {(f.status === "goedgekeurd" ||
                          f.status === "betaald") &&
                        f.goedgekeurd_op ? (
                          <span className="inline-flex items-center gap-1 text-sm text-green-dark">
                            <span aria-hidden className="text-xs">
                              ✓
                            </span>
                            {f.status === "betaald"
                              ? "Betaald"
                              : "Goedgekeurd"}
                            <span className="text-xs text-muted">
                              {formatDateShort(f.goedgekeurd_op)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted">
                            {f.status === "verzonden"
                              ? "Te goedkeuren"
                              : f.status}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            disabled={pdfBusy === f.id}
                            onClick={() =>
                              void downloadPdf(f.id, f.factuur_nummer)
                            }
                            className="text-xs font-semibold text-green-dark hover:underline disabled:opacity-60"
                          >
                            {pdfBusy === f.id ? "…" : "PDF"}
                          </button>
                          {f.status === "verzonden" && (
                            <button
                              type="button"
                              disabled={approveBusy === f.id}
                              onClick={() => void goedkeuren(f.id)}
                              className="bg-green px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {approveBusy === f.id ? "…" : "Goedkeuren"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-xs text-muted sm:px-6">
        Batterijconcept · {formatDateTimeNl(new Date())}
      </footer>
    </div>
  );
}
